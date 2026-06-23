const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const result = await db.query(`SELECT id, name, category, duration_mins, price, image_url FROM services WHERE active = TRUE ORDER BY category, created_at ASC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/all', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM services ORDER BY category, created_at ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', requireAuth, async (req, res) => {
  const { name, category, duration_mins, price } = req.body;
  if (!name || !category || !duration_mins || price == null) return res.status(400).json({ error: 'name, category, duration_mins and price are required' });
  try {
    const result = await db.query(`INSERT INTO services (name, category, duration_mins, price) VALUES ($1, $2, $3, $4) RETURNING *`, [name, category, parseInt(duration_mins), parseFloat(price)]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id', requireAuth, async (req, res) => {
  const { name, category, duration_mins, price, active } = req.body;
  try {
    const result = await db.query(
      `UPDATE services SET name=COALESCE($1,name), category=COALESCE($2,category), duration_mins=COALESCE($3,duration_mins), price=COALESCE($4,price), active=COALESCE($5,active) WHERE id=$6 RETURNING *`,
      [name, category, duration_mins, price, active, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Service not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE services SET active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ message: 'Service deactivated' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id/permanent', requireAuth, async (req, res) => {
  try {
    const bookings = await db.query(
      `SELECT COUNT(*) FROM booking_services WHERE service_id = $1`,
      [req.params.id]
    );
    if (parseInt(bookings.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete a service that has bookings. Disable it instead.' });
    }
    await db.query('DELETE FROM services WHERE id = $1', [req.params.id]);
    res.json({ message: 'Service deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
