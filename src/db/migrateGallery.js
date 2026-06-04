const db = require('./index');
async function migrate() {
  await db.query(`
    ALTER TABLE services ADD COLUMN IF NOT EXISTS image_url TEXT;
    CREATE TABLE IF NOT EXISTS gallery (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      image_url  TEXT NOT NULL,
      category   TEXT,
      caption    TEXT,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS gallery_category_idx ON gallery(category);
  `);
  console.log('gallery migration done');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
