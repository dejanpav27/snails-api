require('dotenv').config();
const db = require('./index');

async function setup() {
  console.log('Setting up Snails database...\n');

  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    console.log('✓ uuid-ossp extension ready');

    await db.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name         TEXT NOT NULL,
        email        TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✓ admins table ready');

    await db.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name       TEXT NOT NULL,
        phone      TEXT,
        email      TEXT,
        notes      TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✓ clients table ready');

    await db.query(`
      CREATE TABLE IF NOT EXISTS services (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name          TEXT NOT NULL,
        category      TEXT NOT NULL,
        duration_mins INT NOT NULL,
        price         DECIMAL(8,2) NOT NULL,
        active        BOOLEAN DEFAULT TRUE
      );
    `);
    console.log('✓ services table ready');

    await db.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,
        service_id   UUID REFERENCES services(id) ON DELETE SET NULL,
        booked_at    TIMESTAMPTZ NOT NULL,
        status       TEXT DEFAULT 'pending'
                       CHECK (status IN ('pending', 'confirmed', 'cancelled')),
        client_notes TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✓ bookings table ready');

    // Seed some starter services so the app isn't empty
    const existing = await db.query(`SELECT id FROM services LIMIT 1`);
    if (existing.rowCount === 0) {
      await db.query(`
        INSERT INTO services (name, category, duration_mins, price) VALUES
          ('Classic manicure',  'Manicure',  45,  25.00),
          ('Gel manicure',      'Manicure',  60,  35.00),
          ('Acrylic full set',  'Manicure',  90,  55.00),
          ('Builder gel',       'Manicure',  75,  45.00),
          ('Nail art set',      'Nail art',  90,  65.00),
          ('Nail art per nail', 'Nail art',  15,   5.00),
          ('Gel removal',       'Extras',    30,  15.00),
          ('Classic pedicure',  'Pedicure',  60,  35.00),
          ('Gel pedicure',      'Pedicure',  75,  45.00);
      `);
      console.log('✓ starter services seeded');
    }

    console.log('\nDatabase setup complete!');
    console.log('\nNext: create your admin account by running:');
    console.log('  node src/db/createAdmin.js\n');

  } catch (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

setup();
