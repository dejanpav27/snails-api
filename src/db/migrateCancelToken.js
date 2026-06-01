require('dotenv').config();
const db = require('./index');

async function migrate() {
  console.log('Running cancel token migration…');
  try {
    await db.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS cancel_token UUID DEFAULT uuid_generate_v4();
    `);
    console.log('✓ cancel_token column added to bookings');

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_cancel_token
        ON bookings (cancel_token);
    `);
    console.log('✓ Unique index created');

    console.log('\nCancel token migration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

migrate();
