require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes         = require('./routes/auth');
const servicesRoutes     = require('./routes/services');
const availabilityRoutes = require('./routes/availability');
const bookingsRoutes     = require('./routes/bookings');
const clientsRoutes      = require('./routes/clients');
const { runReminders }   = require('./scheduler');

const app = express();

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Snails API', time: new Date().toISOString() });
});

// Manual trigger — useful for testing: GET /admin/send-reminders
app.get('/admin/send-reminders', async (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.JWT_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await runReminders();
    res.json({ message: 'Reminder job complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/auth',         authRoutes);
app.use('/services',     servicesRoutes);
app.use('/availability', availabilityRoutes);
app.use('/bookings',     bookingsRoutes);
app.use('/clients',      clientsRoutes);

// ── 404 & error handlers ──────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nSnails API running on port ${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health\n`);

  // ── Reminder scheduler ─────────────────────────────────
  // Run immediately on startup, then every hour
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  console.log('Reminder scheduler started — runs every hour');
  runReminders().catch(err => console.error('Initial reminder run failed:', err.message));
  setInterval(() => {
    runReminders().catch(err => console.error('Reminder run failed:', err.message));
  }, INTERVAL_MS);
});

module.exports = app;
