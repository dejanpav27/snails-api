const db = require('./index');
async function migrate() {
  await db.query(`
    ALTER TABLE schedule ADD COLUMN IF NOT EXISTS break_start TIME;
    ALTER TABLE schedule ADD COLUMN IF NOT EXISTS break_end TIME;
  `);
  console.log('break_start and break_end columns added to schedule');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
