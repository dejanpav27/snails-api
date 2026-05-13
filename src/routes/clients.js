const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { search } = req.query;
  let query = `SELECT c.*, COUNT(b.id) AS total_bookings, MAX(b.booked_at) AS last_booking FROM clients c LEFT JOIN bookings b ON b.client_id = c.id AND b.status != 'cancelled'`;
  const params = [];
  if (search) { params.push(`%${search}%`); query += ` WHERE c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1`; }
  query += ' GROUP BY c.id ORDER BY c.name ASC';
  try {
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (clientResult.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const bookingsResult = await db.query(`SELECT b.id, b.booked_at, b.status, b.client_notes, s.name AS service_name, s.duration_mins, s.price FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.client_id = $1 ORDER BY b.booked_at DESC`, [req.params.id]);
    res.json({ ...clientResult.rows[0], bookings: bookingsResult.rows });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', async (req, res) => {
  const { name, phone, email, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.query(`INSERT INTO clients (name, phone, email, notes) VALUES ($1, $2, $3, $4) RETURNING *`, [name, phone || null, email || null, notes || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id', async (req, res) => {
  const { name, phone, email, notes } = req.body;
  try {
    const result = await db.query(`UPDATE clients SET name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email), notes=COALESCE($4,notes) WHERE id=$5 RETURNING *`, [name, phone, email, notes, req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
