#!/usr/bin/env node
/**
 * Diagnostic Script - Clinic Database Connection
 *
 * This script helps diagnose connection issues with clinic databases
 * by checking:
 * - Companies in central database
 * - Clinic databases existence in PostgreSQL
 * - Connection status for each clinic
 */

const { Client } = require('pg');
const { getCentralConnection, getClinicConnection } = require('../src/config/connectionManager');

// ANSI color codes for better visibility
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function header(text) {
  log('\n' + '='.repeat(80), colors.cyan);
  log(`  ${text}`, colors.bright + colors.cyan);
  log('='.repeat(80), colors.cyan);
}

async function checkPostgresDatabases() {
  header('STEP 1: Checking PostgreSQL Databases');

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'medicalpro',
    password: process.env.DB_PASSWORD || 'medicalpro2024',
    database: 'postgres' // Connect to default postgres database
  });

  try {
    await client.connect();
    log('✅ Connected to PostgreSQL server', colors.green);

    // List all databases
    const result = await client.query(`
      SELECT datname
      FROM pg_database
      WHERE datname LIKE 'medicalpro%'
      ORDER BY datname
    `);

    log(`\n📊 Found ${result.rows.length} MedicalPro databases:`, colors.blue);
    result.rows.forEach(row => {
      if (row.datname === 'medicalpro_central') {
        log(`  • ${row.datname} (Central DB)`, colors.green);
      } else {
        log(`  • ${row.datname}`, colors.cyan);
      }
    });

    return result.rows;
  } catch (error) {
    log(`❌ Failed to connect to PostgreSQL: ${error.message}`, colors.red);
    throw error;
  } finally {
    await client.end();
  }
}

async function checkCentralDatabase() {
  header('STEP 2: Checking Central Database');

  try {
    const { initializeCentralConnection } = require('../src/config/connectionManager');
    const central = await initializeCentralConnection();
    log('✅ Connected to medicalpro_central', colors.green);

    // Get all companies
    const [companies] = await central.query(`
      SELECT id, name, country, is_active, deleted_at, created_at
      FROM companies
      ORDER BY created_at DESC
    `);

    log(`\n📊 Found ${companies.length} companies in central database:`, colors.blue);

    companies.forEach((company, index) => {
      const status = company.deleted_at ? '🔴 Deleted' :
                     !company.is_active ? '🟡 Inactive' :
                     '🟢 Active';

      log(`\n  ${index + 1}. ${company.name} (${company.country})`, colors.bright);
      log(`     Status: ${status}`);
      log(`     ID: ${company.id}`, colors.cyan);
      log(`     Expected DB: medicalpro_clinic_${company.id}`, colors.magenta);
      log(`     Created: ${new Date(company.created_at).toLocaleString()}`);
    });

    return companies;
  } catch (error) {
    log(`❌ Failed to query central database: ${error.message}`, colors.red);
    throw error;
  }
}

async function testClinicConnections(companies, pgDatabases) {
  header('STEP 3: Testing Clinic Database Connections');

  const dbList = pgDatabases.map(db => db.datname);

  for (const company of companies) {
    const expectedDbName = `medicalpro_clinic_${company.id}`;
    const dbExists = dbList.includes(expectedDbName);

    log(`\n🔍 Testing clinic: ${company.name}`, colors.bright);
    log(`   Clinic ID: ${company.id}`, colors.cyan);
    log(`   Expected DB: ${expectedDbName}`, colors.cyan);
    log(`   DB Exists in PostgreSQL: ${dbExists ? '✅ Yes' : '❌ No'}`, dbExists ? colors.green : colors.red);

    if (!dbExists) {
      log(`   ⚠️  PROBLEM: Database does not exist!`, colors.yellow);
      log(`   → Solution: Run provisioning for this clinic`, colors.yellow);
      continue;
    }

    if (company.deleted_at || !company.is_active) {
      log(`   ⚠️  Company is ${company.deleted_at ? 'deleted' : 'inactive'}`, colors.yellow);
      log(`   → Connection test skipped`, colors.yellow);
      continue;
    }

    // Try to connect
    try {
      log(`   🔌 Attempting connection...`, colors.blue);
      const clinicDb = await getClinicConnection(company.id);
      await clinicDb.authenticate();
      log(`   ✅ Connection successful!`, colors.green);

      // Check if tables exist
      const [tables] = await clinicDb.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      log(`   📋 Found ${tables.length} tables in clinic database`, colors.green);
    } catch (error) {
      log(`   ❌ Connection failed: ${error.message}`, colors.red);
      log(`   → Error type: ${error.name}`, colors.red);
    }
  }
}

async function diagnose() {
  try {
    log('\n🏥 MedicalPro - Clinic Database Diagnostic Tool', colors.bright + colors.blue);
    log('This tool will help identify connection issues with clinic databases\n');

    // Step 1: Check all databases in PostgreSQL
    const pgDatabases = await checkPostgresDatabases();

    // Step 2: Check companies in central database
    const companies = await checkCentralDatabase();

    // Step 3: Test connections to each clinic database
    await testClinicConnections(companies, pgDatabases);

    // Summary
    header('DIAGNOSTIC SUMMARY');

    const centralExists = pgDatabases.some(db => db.datname === 'medicalpro_central');
    const activeCompanies = companies.filter(c => !c.deleted_at && c.is_active);
    const expectedDbs = companies.map(c => `medicalpro_clinic_${c.id}`);
    const existingClinicDbs = pgDatabases
      .filter(db => db.datname.startsWith('medicalpro_clinic_'))
      .map(db => db.datname);
    const missingDbs = expectedDbs.filter(db => !existingClinicDbs.includes(db));

    log(`\n📊 Central Database: ${centralExists ? '✅ OK' : '❌ Missing'}`, centralExists ? colors.green : colors.red);
    log(`📊 Total Companies: ${companies.length}`, colors.blue);
    log(`📊 Active Companies: ${activeCompanies.length}`, colors.green);
    log(`📊 Clinic Databases Found: ${existingClinicDbs.length}`, colors.cyan);

    if (missingDbs.length > 0) {
      log(`\n⚠️  WARNING: ${missingDbs.length} clinic database(s) missing!`, colors.yellow);
      missingDbs.forEach(db => {
        log(`   • ${db}`, colors.yellow);
      });
      log(`\n💡 Solution: Run the provisioning script to create missing databases`, colors.yellow);
    } else {
      log(`\n✅ All clinic databases exist!`, colors.green);
    }

    log('\n✅ Diagnostic complete!', colors.green);
    process.exit(0);

  } catch (error) {
    log(`\n❌ Diagnostic failed: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Run diagnostic
diagnose();
