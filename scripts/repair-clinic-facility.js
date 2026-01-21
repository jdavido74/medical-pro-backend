#!/usr/bin/env node
/**
 * Repair Script: Add Default Facility to Existing Clinics
 *
 * This script adds a default facility to clinics that were created
 * before the auto-facility provisioning was implemented.
 *
 * Usage:
 *   node scripts/repair-clinic-facility.js <clinicId> <facilityName>
 *   node scripts/repair-clinic-facility.js --all
 */

const { Sequelize } = require('sequelize');
const chalk = require('chalk');

const DEFAULT_FACILITY_ID = '00000000-0000-0000-0000-000000000001';

async function connectToClinicDb(clinicId) {
  const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;

  const connection = new Sequelize(dbName, 'medicalpro', 'medicalpro2024', {
    host: 'localhost',
    port: 5432,
    dialect: 'postgres',
    logging: false
  });

  try {
    await connection.authenticate();
    console.log(chalk.green(`✓ Connected to clinic database: ${dbName}`));
    return connection;
  } catch (error) {
    console.error(chalk.red(`✗ Failed to connect to ${dbName}: ${error.message}`));
    throw error;
  }
}

async function checkFacilityExists(clinicDb) {
  const [results] = await clinicDb.query(
    `SELECT id, name FROM medical_facilities WHERE id = :facilityId`,
    {
      replacements: { facilityId: DEFAULT_FACILITY_ID }
    }
  );

  return results.length > 0 ? results[0] : null;
}

async function createDefaultFacility(clinicDb, facilityName, country = 'FR') {
  await clinicDb.query(
    `INSERT INTO medical_facilities (
      id, name, facility_type, address_line1, city, postal_code, country, is_active
    ) VALUES (
      :facilityId,
      :facilityName,
      'cabinet',
      'À compléter',
      'À compléter',
      '00000',
      :country,
      true
    )
    ON CONFLICT (id) DO NOTHING`,
    {
      replacements: {
        facilityId: DEFAULT_FACILITY_ID,
        facilityName: facilityName,
        country: country
      }
    }
  );

  console.log(chalk.green(`✓ Default facility created: ${facilityName}`));
}

async function repairClinic(clinicId, facilityName) {
  console.log(chalk.blue(`\n=== Repairing Clinic: ${clinicId} ===`));

  let clinicDb;
  try {
    clinicDb = await connectToClinicDb(clinicId);

    // Check if facility exists
    const existing = await checkFacilityExists(clinicDb);

    if (existing) {
      console.log(chalk.yellow(`⚠ Default facility already exists: ${existing.name}`));
      console.log(chalk.yellow(`  No repair needed`));
      return { status: 'exists', facility: existing };
    }

    // Create facility
    await createDefaultFacility(clinicDb, facilityName);

    // Verify
    const created = await checkFacilityExists(clinicDb);
    if (created) {
      console.log(chalk.green(`✓ Facility verified: ${created.name}`));
      return { status: 'created', facility: created };
    } else {
      throw new Error('Facility creation failed verification');
    }

  } catch (error) {
    console.error(chalk.red(`✗ Error repairing clinic: ${error.message}`));
    return { status: 'error', error: error.message };
  } finally {
    if (clinicDb) {
      await clinicDb.close();
    }
  }
}

async function repairAllClinics() {
  console.log(chalk.blue('\n=== Repairing All Clinics ===\n'));

  // Connect to central DB to get all clinics
  const centralDb = new Sequelize('medicalpro_central', 'medicalpro', 'medicalpro2024', {
    host: 'localhost',
    port: 5432,
    dialect: 'postgres',
    logging: false
  });

  try {
    await centralDb.authenticate();
    console.log(chalk.green('✓ Connected to central database\n'));

    const [companies] = await centralDb.query(
      `SELECT id, name FROM companies WHERE deleted_at IS NULL ORDER BY created_at`
    );

    console.log(chalk.blue(`Found ${companies.length} active clinics\n`));

    const results = [];
    for (const company of companies) {
      const result = await repairClinic(company.id, company.name);
      results.push({ clinicId: company.id, clinicName: company.name, ...result });
    }

    // Summary
    console.log(chalk.blue('\n=== Repair Summary ==='));
    console.log(`Total clinics: ${results.length}`);
    console.log(chalk.green(`Created: ${results.filter(r => r.status === 'created').length}`));
    console.log(chalk.yellow(`Already exists: ${results.filter(r => r.status === 'exists').length}`));
    console.log(chalk.red(`Errors: ${results.filter(r => r.status === 'error').length}`));

    if (results.some(r => r.status === 'error')) {
      console.log(chalk.red('\nErrors:'));
      results.filter(r => r.status === 'error').forEach(r => {
        console.log(chalk.red(`  - ${r.clinicName}: ${r.error}`));
      });
    }

  } catch (error) {
    console.error(chalk.red(`Error accessing central database: ${error.message}`));
  } finally {
    await centralDb.close();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
${chalk.bold('Repair Clinic Facility Script')}

Usage:
  ${chalk.cyan('node scripts/repair-clinic-facility.js <clinicId> <facilityName>')}
    Repair a specific clinic

  ${chalk.cyan('node scripts/repair-clinic-facility.js --all')}
    Repair all clinics (use facility name from company table)

Examples:
  node scripts/repair-clinic-facility.js 2f8e96fd-963a-4d19-9b63-8bc94dd46c10 "Cabinet Médical"
  node scripts/repair-clinic-facility.js --all
    `);
    process.exit(0);
  }

  if (args[0] === '--all') {
    await repairAllClinics();
  } else {
    const clinicId = args[0];
    const facilityName = args[1] || 'Default Facility';

    await repairClinic(clinicId, facilityName);
  }

  console.log(chalk.green('\n✓ Done\n'));
}

main().catch(error => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  process.exit(1);
});
