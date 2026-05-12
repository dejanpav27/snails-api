require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes         = require('./routes/auth');
const servicesRoutes     = require('./routes/services');
const availabilityRoutes = require('./routes/availability');
const bookingsRoutes     = require('./routes/bookings');
const clientsRoutes      = require('./routes/clients');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json());

// Request logger (simple, no extra deps)
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Snails API', time: new Date().toISOString() });
});

app.use('/auth',         authRoutes);
app.use('/services',     servicesRoutes);
app.use('/availability', availabilityRoutes);
app.use('/bookings',     bookingsRoutes);
app.use('/clients',      clientsRoutes);

// ── 404 & error handlers ─────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nSnails API running on port ${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health\n`);
});

module.exports = app;
