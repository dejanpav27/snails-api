require('dotenv').config();
const db = require('./index');

async function migrate() {
  console.log('Running notifications migration…');
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type       TEXT NOT NULL,
        booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
        client_name TEXT,
        service_label TEXT,
        booked_at  TIMESTAMPTZ,
        read       BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✓ notifications table ready');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (read, created_at DESC);
    `);
    console.log('✓ Index created');

    console.log('\nNotifications migration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await db.end?.();
    process.exit(0);
  }
}

migrate();
