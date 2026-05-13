require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  console.log('Running schedule migration…');
  try {
    // Create schedule table — one row per day of week (0=Sun, 1=Mon ... 6=Sat)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule (
        day_of_week  INT PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
        is_open      BOOLEAN DEFAULT TRUE,
        open_time    TIME DEFAULT '09:00',
        close_time   TIME DEFAULT '18:00'
      );
    `);
    console.log('✓ schedule table ready');

    // Seed default schedule Mon–Sat open, Sun closed
    await pool.query(`
      INSERT INTO schedule (day_of_week, is_open, open_time, close_time) VALUES
        (0, FALSE, '09:00', '18:00'),
        (1, TRUE,  '09:00', '18:00'),
        (2, TRUE,  '09:00', '18:00'),
        (3, TRUE,  '09:00', '18:00'),
        (4, TRUE,  '09:00', '18:00'),
        (5, TRUE,  '09:00', '18:00'),
        (6, TRUE,  '09:00', '14:00')
      ON CONFLICT (day_of_week) DO NOTHING;
    `);
    console.log('✓ default schedule seeded');
    console.log('\nSchedule migration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
