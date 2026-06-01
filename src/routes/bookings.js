const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendBookingConfirmation, sendCancellationEmail } = require('../utils/email');

// Helper — create a notification for an event
async function createNotification({ type, bookingId, clientName, serviceLabel, bookedAt }) {
  try {
    await db.query(
      `INSERT INTO notifications (type, booking_id, client_name, service_label, booked_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [type, bookingId, clientName, serviceLabel, bookedAt]
    );
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

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

    // Create notification for admin
    const serviceLabel = services.map(s => s.name).join(' + ');
    await createNotification({
      type: 'new_booking',
      bookingId: booking.id,
      clientName: client.name,
      serviceLabel,
      bookedAt: booked_at,
    });

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
  if (!['pending','confirmed','cancelled','no_show'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const result = await db.query(`UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];

    // Fetch client and services for emails + notifications
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [booking.client_id]);
    const services = await getBookingServices(booking.id);
    const serviceLabel = services.map(s => s.name).join(' + ') || 'appointment';
    const clientName = clientResult.rows[0]?.name || 'Client';

    if (status === 'confirmed') {
      // Send confirmation email to client
      if (clientResult.rowCount > 0) {
        const totalDuration = booking.total_duration_mins || services.reduce((s, x) => s + x.duration_mins, 0);
        const totalPrice    = booking.total_price    || services.reduce((s, x) => s + Number(x.price), 0);
        sendBookingConfirmation({
          client: clientResult.rows[0],
          services,
          totalDuration,
          totalPrice,
          booking,
          cancelToken: booking.cancel_token,
        }).catch(err => console.error('Confirmation email error:', err));
      }
      await createNotification({ type: 'confirmed', bookingId: booking.id, clientName, serviceLabel, bookedAt: booking.booked_at });
    }

    if (status === 'cancelled') {
      if (clientResult.rowCount > 0) {
        sendCancellationEmail({
          client: clientResult.rows[0],
          services: services.length > 0 ? services : null,
          booking,
        }).catch(err => console.error('Cancellation email error:', err));
      }
      await createNotification({ type: 'cancelled', bookingId: booking.id, clientName, serviceLabel, bookedAt: booking.booked_at });
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

// GET /bookings/:token/cancel — client self-cancel via token
router.get('/:token/cancel', async (req, res) => {
  const { token } = req.params;
  const BOOKING_URL = process.env.BOOKING_URL || process.env.FRONTEND_URL || 'https://snails-booking.vercel.app';

  try {
    const result = await db.query(
      `SELECT b.*, c.name AS client_name, c.email AS client_email
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       WHERE b.cancel_token = $1`,
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(404).send(cancelPage('Invalid link', 'This cancel link is not valid.', BOOKING_URL));
    }

    const booking = result.rows[0];

    if (booking.status === 'cancelled') {
      return res.send(cancelPage('Already cancelled', 'This booking has already been cancelled.', BOOKING_URL));
    }

    // Check 3-hour window
    const now = new Date();
    const appt = new Date(booking.booked_at);
    const hoursUntil = (appt - now) / (1000 * 60 * 60);

    if (hoursUntil < 3) {
      return res.send(cancelPage('Too late to cancel', 'Bookings can only be cancelled up to 3 hours before the appointment. Please contact Sara directly.', BOOKING_URL));
    }

    // Cancel it
    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [booking.id]);

    // Send cancellation email
    const { sendCancellationEmail } = require('../utils/email');
    const services = await db.query(
      `SELECT s.name, s.duration_mins, s.price FROM booking_services bs
       JOIN services s ON s.id = bs.service_id WHERE bs.booking_id = $1 ORDER BY bs.sort_order`,
      [booking.id]
    );
    sendCancellationEmail({
      client: { name: booking.client_name, email: booking.client_email },
      services: services.rows.length > 0 ? services.rows : null,
      booking,
    }).catch(err => console.error('Cancel email error:', err));

    return res.send(cancelPage('Booking cancelled', 'Your booking has been cancelled. We hope to see you again soon!', BOOKING_URL));

  } catch (err) {
    console.error('Cancel token error:', err);
    res.status(500).send(cancelPage('Error', 'Something went wrong. Please try again or contact Sara directly.', BOOKING_URL));
  }
});

function cancelPage(title, message, bookingUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Snails</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff8fb; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border: 1px solid #ffd6e7; border-radius: 16px; padding: 40px 32px; max-width: 420px; width: 100%; text-align: center; }
    .logo { font-size: 22px; color: #72243E; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 500; color: #72243E; margin-bottom: 12px; }
    p { font-size: 14px; color: #993556; line-height: 1.6; margin-bottom: 28px; }
    a { display: inline-block; padding: 10px 24px; background: #d4537e; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Snails ✦</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${bookingUrl}">Book again</a>
  </div>
</body>
</html>`;
}

module.exports = router;
