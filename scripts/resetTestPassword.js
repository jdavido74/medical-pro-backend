/**
 * Temporary script to reset test user passwords for testing
 */
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'medicalpro',
  password: process.env.DB_PASSWORD || 'medicalpro2024',
  database: 'medicalpro_central'
});

async function resetPassword() {
  const email = process.argv[2] || 'david@ozondenia.com';
  const password = process.argv[3] || 'Test1234';

  const hash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING email',
    [hash, email]
  );

  if (result.rowCount > 0) {
    console.log(`Password reset for ${email} to: ${password}`);
  } else {
    console.log(`User not found: ${email}`);
  }

  await pool.end();
}

resetPassword().catch(console.error);
