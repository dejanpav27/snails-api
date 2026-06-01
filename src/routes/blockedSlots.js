const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /blocked-slots?date=YYYY-MM-DD  (public — used by availability)
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    const result = date
      ? await db.query('SELECT * FROM blocked_slots WHERE date = $1 ORDER BY start_time', [date])
      : await db.query('SELECT * FROM blocked_slots ORDER BY date, start_time');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /blocked-slots  (admin)
router.post('/', requireAuth, async (req, res) => {
  const { date, is_full_day, start_time, end_time, reason } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!is_full_day && (!start_time || !end_time)) {
    return res.status(400).json({ error: 'start_time and end_time required for partial block' });
  }
  try {
    const result = await db.query(
      `INSERT INTO blocked_slots (date, is_full_day, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [date, !!is_full_day, is_full_day ? null : start_time, is_full_day ? null : end_time, reason || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /blocked-slots/:id  (admin)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM blocked_slots WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
