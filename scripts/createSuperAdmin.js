/**
 * Create Super Admin User Script
 * Run with: node scripts/createSuperAdmin.js
 */

require('dotenv').config();
const { sequelize, User } = require('../src/models');

async function createSuperAdmin() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected.');

    const email = 'josedavid.orts@gmail.com';
    const password = 'SuperAdmin2025!';

    // Check if user already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      console.log(`User ${email} already exists. Updating to super_admin...`);
      await existingUser.update({
        role: 'super_admin',
        is_active: true,
        email_verified: true
      });
      console.log('User updated to super_admin.');
    } else {
      console.log(`Creating super_admin user: ${email}`);

      const user = await User.create({
        email,
        password_hash: password, // Will be hashed by beforeCreate hook
        first_name: 'Jose David',
        last_name: 'Orts',
        role: 'super_admin',
        is_active: true,
        email_verified: true,
        company_id: null // Super admin has no company
      });

      console.log('Super admin created successfully!');
      console.log('User ID:', user.id);
    }

    console.log('\n=== LOGIN CREDENTIALS ===');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('========================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

createSuperAdmin();
