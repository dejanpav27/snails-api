const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /gallery — public
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const result = category
      ? await db.query('SELECT * FROM gallery WHERE category = $1 ORDER BY sort_order, created_at DESC', [category])
      : await db.query('SELECT * FROM gallery ORDER BY sort_order, created_at DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /gallery — admin
router.post('/', requireAuth, async (req, res) => {
  const { image_url, category, caption } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });
  try {
    const result = await db.query(
      'INSERT INTO gallery (image_url, category, caption) VALUES ($1, $2, $3) RETURNING *',
      [image_url, category || null, caption || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /gallery/:id — admin
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM gallery WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /services/:id/image — save image_url to service
router.patch('/service-image/:id', requireAuth, async (req, res) => {
  const { image_url } = req.body;
  try {
    const result = await db.query(
      'UPDATE services SET image_url = $1 WHERE id = $2 RETURNING *',
      [image_url || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
