require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes         = require('./routes/auth');
const servicesRoutes     = require('./routes/services');
const availabilityRoutes = require('./routes/availability');
const bookingsRoutes     = require('./routes/bookings');
const clientsRoutes      = require('./routes/clients');
const scheduleRoutes     = require('./routes/schedule');
const notificationsRoutes = require('./routes/notifications');
const blockedSlotsRoutes  = require('./routes/blockedSlots');
const { runReminders }   = require('./utils/scheduler');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
  next();
});

// Rate limit public booking endpoint — 5 requests per IP per hour
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many booking requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'Snails API', time: new Date().toISOString() }));

app.use('/auth',         authRoutes);
app.use('/services',     servicesRoutes);
app.use('/availability', availabilityRoutes);
app.post('/bookings',    bookingLimiter);
app.use('/bookings',     bookingsRoutes);
app.use('/clients',      clientsRoutes);
app.use('/schedule',     scheduleRoutes);
app.use('/notifications',   notificationsRoutes);
app.use('/blocked-slots',   blockedSlotsRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, _req, res, _next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nSnails API running on port ${PORT}`);
  const INTERVAL_MS = 60 * 60 * 1000;
  console.log('Reminder scheduler started — runs every hour');
  runReminders().catch(err => console.error('Initial reminder run failed:', err.message));
  setInterval(() => { runReminders().catch(err => console.error('Reminder run failed:', err.message)); }, INTERVAL_MS);
});

module.exports = app;
