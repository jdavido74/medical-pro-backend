/**
 * Run category migration - Add type and sort_order columns
 */

const { Sequelize } = require('sequelize');

async function migrate() {
  // Connect to clinic database
  const dbName = process.env.CLINIC_DB_NAME || 'medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000';
  const dbUser = process.env.DB_USER || 'medicalpro';
  const dbPass = process.env.DB_PASSWORD || 'medicalpro2024';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT || 5432;

  const dbUrl = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
  console.log('Connecting to:', dbName);
  const sequelize = new Sequelize(dbUrl, { logging: false });

  try {
    console.log('Checking categories table...');

    // Check if columns exist
    const [results] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'categories' AND column_name IN ('type', 'sort_order')
    `);

    const existingColumns = results.map(r => r.column_name);
    console.log('Existing columns:', existingColumns);

    // Add type column if it doesn't exist
    if (!existingColumns.includes('type')) {
      console.log('Adding type column...');
      await sequelize.query(`
        ALTER TABLE categories ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'product'
      `);
      console.log('Added type column');

      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type)
      `);
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_categories_company_type ON categories(company_id, type)
      `);
      console.log('Added type indexes');
    } else {
      console.log('type column already exists');
    }

    // Add sort_order column if it doesn't exist
    if (!existingColumns.includes('sort_order')) {
      console.log('Adding sort_order column...');
      await sequelize.query(`
        ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
      `);
      console.log('Added sort_order column');
    } else {
      console.log('sort_order column already exists');
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

migrate();
