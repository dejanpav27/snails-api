const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendBookingConfirmation, sendCancellationEmail } = require('../utils/email');

// Helper — get all services for a booking
async function getBookingServices(bookingId, client) {
  const result = await (client || db).query(
    `SELECT s.* FROM booking_services bs
     JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = $1
     ORDER BY bs.sort_order`,
    [bookingId]
  );
  return result.rows;
}

// POST /bookings — create booking with multiple services (public)
router.post('/', async (req, res) => {
  const { service_ids, booked_at, client_notes, client } = req.body;

  // Support both single service_id (backwards compat) and array
  const serviceIds = service_ids || (req.body.service_id ? [req.body.service_id] : []);

  if (!serviceIds.length || !booked_at || !client?.name) {
    return res.status(400).json({ error: 'service_ids, booked_at and client.name are required' });
  }

  const dbClient = await db.getClient();
  try {
    await dbClient.query('BEGIN');

    // Get all selected services
    const placeholders = serviceIds.map((_, i) => `$${i + 1}`).join(',');
    const servicesResult = await dbClient.query(
      `SELECT * FROM services WHERE id IN (${placeholders}) AND active = TRUE ORDER BY duration_mins DESC`,
      serviceIds
    );
    if (servicesResult.rowCount !== serviceIds.length) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'One or more services not found' });
    }
    const services = servicesResult.rows;

    // Calculate total duration and price
    const totalDuration = services.reduce((sum, s) => sum + s.duration_mins, 0);
    const totalPrice    = services.reduce((sum, s) => sum + Number(s.price), 0);

    // Check availability for the combined duration
    const reqStart = new Date(booked_at).getTime();
    const reqEnd   = reqStart + totalDuration * 60 * 1000;

    const conflictResult = await dbClient.query(
      `SELECT b.id FROM bookings b
       WHERE b.status != 'cancelled'
         AND b.booked_at < $1
         AND (b.booked_at + ((COALESCE(b.total_duration_mins, (
           SELECT SUM(s2.duration_mins) FROM booking_services bs2
           JOIN services s2 ON s2.id = bs2.service_id
           WHERE bs2.booking_id = b.id
         ))) || ' minutes')::interval) > $2`,
      [new Date(reqEnd).toISOString(), new Date(reqStart).toISOString()]
    );
    if (conflictResult.rowCount > 0) {
      await dbClient.query('ROLLBACK');
      return res.status(409).json({ error: 'This time slot is no longer available' });
    }

    // Upsert client
    let clientId;
    if (client.phone || client.email) {
      const existing = await dbClient.query(
        `SELECT id FROM clients WHERE (phone=$1 AND $1 IS NOT NULL) OR (email=$2 AND $2 IS NOT NULL) LIMIT 1`,
        [client.phone || null, client.email || null]
      );
      if (existing.rowCount > 0) {
        clientId = existing.rows[0].id;
        await dbClient.query(
          `UPDATE clients SET name=$1, phone=COALESCE($2,phone), email=COALESCE($3,email) WHERE id=$4`,
          [client.name, client.phone, client.email, clientId]
        );
      }
    }
    if (!clientId) {
      const newClient = await dbClient.query(
        `INSERT INTO clients (name, phone, email) VALUES ($1, $2, $3) RETURNING id`,
        [client.name, client.phone || null, client.email || null]
      );
      clientId = newClient.rows[0].id;
    }

    // Create booking (service_id kept for backwards compat = first service)
    const bookingResult = await dbClient.query(
      `INSERT INTO bookings (client_id, service_id, booked_at, status, client_notes, total_duration_mins, total_price)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6) RETURNING *`,
      [clientId, services[0].id, booked_at, client_notes || null, totalDuration, totalPrice]
    );
    const booking = bookingResult.rows[0];

    // Insert booking_services rows
    for (let i = 0; i < services.length; i++) {
      await dbClient.query(
        `INSERT INTO booking_services (booking_id, service_id, sort_order) VALUES ($1, $2, $3)`,
        [booking.id, services[i].id, i]
      );
    }

    await dbClient.query('COMMIT');

    // Send confirmation email
    const clientRow = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    sendBookingConfirmation({
      client: clientRow.rows[0],
      services,
      totalDuration,
      totalPrice,
      booking,
    }).catch(err => console.error('Email error:', err));

    res.status(201).json({
      message: 'Booking created',
      booking: {
        id: booking.id,
        booked_at: booking.booked_at,
        status: booking.status,
        services: services.map(s => ({ name: s.name, duration_mins: s.duration_mins, price: s.price })),
        total_duration_mins: totalDuration,
        total_price: totalPrice,
      },
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('Create booking error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    dbClient.release();
  }
});

// GET /bookings — list all bookings (admin)
router.get('/', requireAuth, async (req, res) => {
  const { date, status } = req.query;
  let query = `
    SELECT b.id, b.booked_at, b.status, b.client_notes, b.created_at,
           b.total_duration_mins, b.total_price,
           c.id AS client_id, c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
           s.id AS service_id, s.name AS service_name, s.duration_mins, s.price
    FROM bookings b
    JOIN clients c ON c.id = b.client_id
    LEFT JOIN services s ON s.id = b.service_id
    WHERE 1=1
  `;
  const params = [];
  if (date)   { params.push(date);   query += ` AND b.booked_at::date = $${params.length}`; }
  if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
  query += ' ORDER BY b.booked_at ASC';

  try {
    const result = await db.query(query, params);

    // For each booking, get all its services
    const bookings = await Promise.all(result.rows.map(async (row) => {
      const allServices = await getBookingServices(row.id);
      return {
        id: row.id,
        booked_at: row.booked_at,
        status: row.status,
        client_notes: row.client_notes,
        created_at: row.created_at,
        total_duration_mins: row.total_duration_mins || row.duration_mins,
        total_price: row.total_price || row.price,
        client: { id: row.client_id, name: row.client_name, phone: row.client_phone, email: row.client_email },
        service: { id: row.service_id, name: row.service_name, duration_mins: row.duration_mins, price: row.price },
        services: allServices.length > 0 ? allServices : [{ id: row.service_id, name: row.service_name, duration_mins: row.duration_mins, price: row.price }],
      };
    }));

    res.json(bookings);
  } catch (err) {
    console.error('Get bookings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /bookings/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
              c.id AS client_id, s.name AS service_name, s.duration_mins, s.price
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    const services = await getBookingServices(booking.id);
    res.json({
      ...booking,
      services: services.length > 0 ? services : [{ name: booking.service_name, duration_mins: booking.duration_mins, price: booking.price }],
      total_duration_mins: booking.total_duration_mins || booking.duration_mins,
      total_price: booking.total_price || booking.price,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /bookings/:id/status
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['pending','confirmed','cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const result = await db.query(`UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];

    if (status === 'cancelled') {
      // FIX: fetch all services from booking_services for cancellation email
      const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [booking.client_id]);
      const services = await getBookingServices(booking.id);

      if (clientResult.rowCount > 0) {
        sendCancellationEmail({
          client: clientResult.rows[0],
          services: services.length > 0 ? services : null,
          booking,
        }).catch(err => console.error('Cancellation email error:', err));
      }
    }

    res.json({ message: `Booking ${status}`, booking });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /bookings/:id — only cancelled bookings
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const check = await db.query('SELECT status FROM bookings WHERE id = $1', [req.params.id]);
    if (check.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    if (check.rows[0].status !== 'cancelled') return res.status(400).json({ error: 'Only cancelled bookings can be deleted' });
    await db.query('DELETE FROM bookings WHERE id = $1', [req.params.id]);
    res.json({ message: 'Booking deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /bookings/admin — manual booking (admin)
router.post('/admin', requireAuth, async (req, res) => {
  const { client_id, service_ids, service_id, booked_at, client_notes, status } = req.body;
  const serviceIds = service_ids || (service_id ? [service_id] : []);
  if (!client_id || !serviceIds.length || !booked_at) return res.status(400).json({ error: 'client_id, service_ids and booked_at are required' });

  const dbClient = await db.getClient();
  try {
    await dbClient.query('BEGIN');
    const placeholders = serviceIds.map((_, i) => `$${i + 1}`).join(',');
    const servicesResult = await dbClient.query(`SELECT * FROM services WHERE id IN (${placeholders})`, serviceIds);
    const services = servicesResult.rows;
    const totalDuration = services.reduce((sum, s) => sum + s.duration_mins, 0);
    const totalPrice    = services.reduce((sum, s) => sum + Number(s.price), 0);

    const result = await dbClient.query(
      `INSERT INTO bookings (client_id, service_id, booked_at, status, client_notes, total_duration_mins, total_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client_id, services[0].id, booked_at, status || 'confirmed', client_notes || null, totalDuration, totalPrice]
    );
    const booking = result.rows[0];
    for (let i = 0; i < services.length; i++) {
      await dbClient.query(`INSERT INTO booking_services (booking_id, service_id, sort_order) VALUES ($1, $2, $3)`, [booking.id, services[i].id, i]);
    }
    await dbClient.query('COMMIT');
    res.status(201).json({ ...booking, services });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    dbClient.release();
  }
});

module.exports = router;
