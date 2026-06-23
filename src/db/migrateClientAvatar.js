const db = require('./index');
async function migrate() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  console.log('avatar_url added to clients');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
