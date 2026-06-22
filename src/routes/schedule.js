const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM schedule ORDER BY day_of_week');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:day', requireAuth, async (req, res) => {
  const day = parseInt(req.params.day);
  if (isNaN(day) || day < 0 || day > 6) return res.status(400).json({ error: 'Day must be 0-6' });
  const { is_open, open_time, close_time, break_start, break_end } = req.body;
  try {
    const result = await db.query(
      `UPDATE schedule
       SET is_open=COALESCE($1,is_open),
           open_time=COALESCE($2,open_time),
           close_time=COALESCE($3,close_time),
           break_start=$4,
           break_end=$5
       WHERE day_of_week=$6 RETURNING *`,
      [is_open, open_time, close_time, break_start || null, break_end || null, day]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Day not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
