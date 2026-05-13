require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

// Edit these before running!
const ADMIN_NAME  = 'Sara';
const ADMIN_EMAIL = 'sara@snails.com';
const ADMIN_PASS  = 'qwer1234';

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
