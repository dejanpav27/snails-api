const db = require('./index');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date         DATE NOT NULL,
      is_full_day  BOOLEAN NOT NULL DEFAULT FALSE,
      start_time   TIME,
      end_time     TIME,
      reason       TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS blocked_slots_date_idx ON blocked_slots(date);
  `);
  console.log('blocked_slots table ready');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
