const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendBookingConfirmation, sendCancellationEmail } = require('../utils/email');

router.post('/', async (req, res) => {
  const { service_id, booked_at, client_notes, client } = req.body;
  if (!service_id || !booked_at || !client?.name) return res.status(400).json({ error: 'service_id, booked_at and client.name are required' });

  const dbClient = await db.getClient();
  try {
    await dbClient.query('BEGIN');
    const serviceResult = await dbClient.query('SELECT * FROM services WHERE id = $1 AND active = TRUE', [service_id]);
    if (serviceResult.rowCount === 0) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Service not found' }); }
    const service = serviceResult.rows[0];

    const reqStart = new Date(booked_at).getTime();
    const reqEnd   = reqStart + service.duration_mins * 60 * 1000;
    const conflictResult = await dbClient.query(
      `SELECT b.id FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.status != 'cancelled' AND b.booked_at < $1 AND (b.booked_at + (s.duration_mins || ' minutes')::interval) > $2`,
      [new Date(reqEnd).toISOString(), new Date(reqStart).toISOString()]
    );
    if (conflictResult.rowCount > 0) { await dbClient.query('ROLLBACK'); return res.status(409).json({ error: 'This time slot is no longer available' }); }

    let clientId;
    if (client.phone || client.email) {
      const existing = await dbClient.query(`SELECT id FROM clients WHERE (phone=$1 AND $1 IS NOT NULL) OR (email=$2 AND $2 IS NOT NULL) LIMIT 1`, [client.phone || null, client.email || null]);
      if (existing.rowCount > 0) {
        clientId = existing.rows[0].id;
        await dbClient.query(`UPDATE clients SET name=$1, phone=COALESCE($2,phone), email=COALESCE($3,email) WHERE id=$4`, [client.name, client.phone, client.email, clientId]);
      }
    }
    if (!clientId) {
      const newClient = await dbClient.query(`INSERT INTO clients (name, phone, email) VALUES ($1, $2, $3) RETURNING id`, [client.name, client.phone || null, client.email || null]);
      clientId = newClient.rows[0].id;
    }

    const bookingResult = await dbClient.query(
      `INSERT INTO bookings (client_id, service_id, booked_at, status, client_notes) VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [clientId, service_id, booked_at, client_notes || null]
    );
    const booking = bookingResult.rows[0];
    await dbClient.query('COMMIT');

    const clientRow = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    sendBookingConfirmation({ client: clientRow.rows[0], service, booking }).catch(err => console.error('Email error:', err));

    res.status(201).json({ message: 'Booking created', booking: { id: booking.id, booked_at: booking.booked_at, status: booking.status, service: { name: service.name, duration_mins: service.duration_mins, price: service.price } } });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('Create booking error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    dbClient.release();
  }
});

router.get('/', requireAuth, async (req, res) => {
  const { date, status } = req.query;
  let query = `SELECT b.id, b.booked_at, b.status, b.client_notes, b.created_at, c.id AS client_id, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, s.id AS service_id, s.name AS service_name, s.duration_mins, s.price FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id WHERE 1=1`;
  const params = [];
  if (date)   { params.push(date);   query += ` AND b.booked_at::date = $${params.length}`; }
  if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
  query += ' ORDER BY b.booked_at ASC';
  try {
    const result = await db.query(query, params);
    res.json(result.rows.map(row => ({ id: row.id, booked_at: row.booked_at, status: row.status, client_notes: row.client_notes, created_at: row.created_at, client: { id: row.client_id, name: row.client_name, phone: row.client_phone, email: row.client_email }, service: { id: row.service_id, name: row.service_name, duration_mins: row.duration_mins, price: row.price } })));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`SELECT b.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, c.id AS client_id, s.name AS service_name, s.duration_mins, s.price FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id WHERE b.id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['pending','confirmed','cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const result = await db.query(`UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *`, [status, req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (status === 'cancelled') {
      const details = await db.query(`SELECT c.*, s.name AS service_name, s.duration_mins FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id WHERE b.id = $1`, [booking.id]);
      if (details.rowCount > 0) {
        const row = details.rows[0];
        sendCancellationEmail({ client: row, service: { name: row.service_name, duration_mins: row.duration_mins }, booking }).catch(err => console.error('Cancellation email error:', err));
      }
    }
    res.json({ message: `Booking ${status}`, booking });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/admin', requireAuth, async (req, res) => {
  const { client_id, service_id, booked_at, client_notes, status } = req.body;
  if (!client_id || !service_id || !booked_at) return res.status(400).json({ error: 'client_id, service_id and booked_at are required' });
  try {
    const result = await db.query(`INSERT INTO bookings (client_id, service_id, booked_at, status, client_notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [client_id, service_id, booked_at, status || 'confirmed', client_notes || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
