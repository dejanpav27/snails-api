require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

// FIX: read password from command-line arg or env var, never hardcoded
const ADMIN_NAME  = process.env.ADMIN_NAME  || 'Snails Admin';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@snails.com';
const ADMIN_PASS  = process.argv[2] || process.env.ADMIN_PASS;

if (!ADMIN_PASS) {
  console.error('Usage: node createAdmin.js <password>');
  console.error('   or: set ADMIN_PASS in your .env file');
  process.exit(1);
}

async function createAdmin() {
  try {
    const hash = await bcrypt.hash(ADMIN_PASS, 12);
    const result = await db.query(
      `INSERT INTO admins (name, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, name, email`,
      [ADMIN_NAME, ADMIN_EMAIL, hash]
    );
    if (result.rowCount === 0) {
      console.log(`Admin with email "${ADMIN_EMAIL}" already exists.`);
    } else {
      console.log('Admin account created:');
      console.log(`  Name:  ${result.rows[0].name}`);
      console.log(`  Email: ${result.rows[0].email}`);
      console.log(`  ID:    ${result.rows[0].id}`);
    }
  } catch (err) {
    console.error('Failed to create admin:', err.message);
  } finally {
    process.exit(0);
  }
}

createAdmin();
