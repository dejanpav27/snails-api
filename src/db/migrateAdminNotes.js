const db = require('./index');
async function migrate() {
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS admin_notes TEXT`);
  console.log('admin_notes column added');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
