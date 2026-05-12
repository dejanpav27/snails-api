require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  console.log('Running Phase 4 migration…');
  try {
    // Add reminder_sent column if it doesn't exist
    await pool.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;
    `);
    console.log('✓ reminder_sent column added to bookings');

    // Index so the scheduler query is fast
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_reminder
        ON bookings (booked_at, status, reminder_sent);
    `);
    console.log('✓ Index created');

    console.log('\nMigration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
