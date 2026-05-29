const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /notifications — last 30 notifications, unread first
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications ORDER BY read ASC, created_at DESC LIMIT 30`
    );
    const unreadCount = result.rows.filter(n => !n.read).length;
    res.json({ notifications: result.rows, unread_count: unreadCount });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /notifications/read-all — mark all as read
router.patch('/read-all', async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET read = TRUE WHERE read = FALSE`);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /notifications/:id/read — mark one as read
router.patch('/:id/read', async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET read = TRUE WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
