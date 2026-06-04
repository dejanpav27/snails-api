const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /clients/lookup?phone=... — public, returns name+email only for pre-fill
router.get('/lookup', async (req, res) => {
  const { phone } = req.query;
  if (!phone || phone.trim().length < 5) return res.json(null);
  try {
    const result = await db.query(
      `SELECT name, email FROM clients WHERE phone = $1 LIMIT 1`,
      [phone.trim()]
    );
    res.json(result.rowCount > 0 ? result.rows[0] : null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

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

    // FIX: use total_price and total_duration_mins; also fetch booking_services for each booking
    const bookingsResult = await db.query(
      `SELECT b.id, b.booked_at, b.status, b.client_notes,
              b.total_price, b.total_duration_mins,
              s.name AS service_name, s.duration_mins, s.price
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.client_id = $1
       ORDER BY b.booked_at DESC`,
      [req.params.id]
    );

    // For each booking, get all services from booking_services
    const bookings = await Promise.all(bookingsResult.rows.map(async (row) => {
      const servicesResult = await db.query(
        `SELECT s.id, s.name, s.duration_mins, s.price
         FROM booking_services bs
         JOIN services s ON s.id = bs.service_id
         WHERE bs.booking_id = $1
         ORDER BY bs.sort_order`,
        [row.id]
      );
      const services = servicesResult.rows.length > 0
        ? servicesResult.rows
        : [{ name: row.service_name, duration_mins: row.duration_mins, price: row.price }];

      const serviceLabel = services.map(s => s.name).join(' + ');
      const totalPrice    = row.total_price    ?? row.price;
      const totalDuration = row.total_duration_mins ?? row.duration_mins;

      return {
        id:            row.id,
        booked_at:     row.booked_at,
        status:        row.status,
        client_notes:  row.client_notes,
        service_name:  serviceLabel,
        duration_mins: totalDuration,
        price:         totalPrice,
        services,
      };
    }));

    res.json({ ...clientResult.rows[0], bookings });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', async (req, res) => {
  const { name, phone, email, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.query(
      `INSERT INTO clients (name, phone, email, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, phone || null, email || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id', async (req, res) => {
  const { name, phone, email, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE clients SET name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email), notes=COALESCE($4,notes) WHERE id=$5 RETURNING *`,
      [name, phone, email, notes, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

// DELETE /clients/:id — admin only, blocks if client has non-cancelled bookings
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const bookings = await db.query(
      `SELECT COUNT(*) FROM bookings WHERE client_id = $1 AND status NOT IN ('cancelled', 'no_show')`,
      [req.params.id]
    );
    if (parseInt(bookings.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete a client with active or confirmed bookings. Cancel their bookings first.' });
    }
    await db.query('DELETE FROM bookings WHERE client_id = $1', [req.params.id]);
    await db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

