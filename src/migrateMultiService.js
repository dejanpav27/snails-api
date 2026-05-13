require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  console.log('Running multi-service migration…');
  try {
    // New table — one row per service per booking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_services (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
        service_id UUID REFERENCES services(id) ON DELETE SET NULL,
        sort_order INT DEFAULT 0
      );
    `);
    console.log('✓ booking_services table ready');

    // Add total_duration and total_price columns to bookings
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_duration_mins INT;`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_price DECIMAL(8,2);`);
    console.log('✓ total_duration_mins and total_price columns added');

    // Index for fast lookups
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_services_booking ON booking_services(booking_id);`);
    console.log('✓ Index created');

    console.log('\nMulti-service migration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
