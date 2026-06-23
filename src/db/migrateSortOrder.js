const db = require('./index');
async function migrate() {
  await db.query(`
    ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
    UPDATE services SET sort_order = 0 WHERE sort_order IS NULL;
  `);
  console.log('sort_order added to services');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
