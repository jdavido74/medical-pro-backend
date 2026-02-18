#!/usr/bin/env node
/**
 * Script to run migrations on existing clinic databases
 * Usage: node scripts/run-clinic-migrations.js [--clinic=<clinic_id>] [--migration=<migration_file>]
 *
 * Options:
 *   --clinic=<id>    Run migrations for specific clinic only
 *   --migration=<file>  Run specific migration file only
 *   --dry-run       Show what would be executed without running
 */

require('dotenv').config();
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

// Database configuration
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'medicalpro';
const DB_PASSWORD = process.env.DB_PASSWORD || 'medicalpro2024';
const CENTRAL_DB = process.env.DB_NAME || 'medicalpro_central';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  clinicId: null,
  migrationFile: null,
  dryRun: false
};

args.forEach(arg => {
  if (arg.startsWith('--clinic=')) {
    options.clinicId = arg.split('=')[1];
  } else if (arg.startsWith('--migration=')) {
    options.migrationFile = arg.split('=')[1];
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
});

// New migrations to run (in order)
const NEW_MIGRATIONS = [
  'clinic_047_appointment_actions.sql',
  'clinic_048_scheduled_jobs.sql',
  'clinic_049_treatment_consent_templates.sql',
  'clinic_050_appointment_workflow_fields.sql',
  'clinic_051_system_categories.sql',
  'clinic_052_seed_system_categories.sql',
  'clinic_053_update_consent_type_constraint.sql',
  'clinic_054_drop_provider_appointment_unique.sql',
  'clinic_055_documents_billing.sql',
  'clinic_056_consent_variable_substitution.sql',
  'clinic_057_physician_patients_view_all.sql',
  'clinic_058_current_illness_field.sql',
  'clinic_059_prescription_clinical_context.sql',
  'clinic_060_custom_medications.sql',
  'clinic_061_admin_medical_nurse_role.sql'
];

async function getClinicDatabases() {
  try {
    // Get list of clinic databases from central database
    const query = `SELECT id, name, db_name FROM clinics WHERE db_provisioned = true AND is_active = true`;
    const command = `PGPASSWORD='${DB_PASSWORD}' psql -h ${DB_HOST} -U ${DB_USER} -p ${DB_PORT} -d ${CENTRAL_DB} -t -c "${query}"`;

    const { stdout } = await execAsync(command);

    const clinics = stdout.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('|').map(p => p.trim());
        return {
          id: parts[0],
          name: parts[1],
          dbName: parts[2] || `medicalpro_clinic_${parts[0].replace(/-/g, '_')}`
        };
      });

    return clinics;
  } catch (error) {
    console.error('Error getting clinic databases:', error.message);

    // Fallback: try to list databases directly
    try {
      const listCommand = `PGPASSWORD='${DB_PASSWORD}' psql -h ${DB_HOST} -U ${DB_USER} -p ${DB_PORT} -d postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%'"`;
      const { stdout } = await execAsync(listCommand);

      return stdout.trim().split('\n')
        .filter(line => line.trim())
        .map(dbName => ({
          id: dbName.trim().replace('medicalpro_clinic_', '').replace(/_/g, '-'),
          name: dbName.trim(),
          dbName: dbName.trim()
        }));
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError.message);
      return [];
    }
  }
}

async function runMigration(dbName, migrationFile) {
  const migrationPath = path.join(__dirname, '..', 'migrations', migrationFile);

  if (!fs.existsSync(migrationPath)) {
    console.error(`  ❌ Migration file not found: ${migrationPath}`);
    return false;
  }

  if (options.dryRun) {
    console.log(`  [DRY RUN] Would run: ${migrationFile}`);
    return true;
  }

  const command = `PGPASSWORD='${DB_PASSWORD}' psql -h ${DB_HOST} -U ${DB_USER} -p ${DB_PORT} -d ${dbName} -f ${migrationPath} 2>&1`;

  try {
    const { stdout, stderr } = await execAsync(command);

    // Check for actual errors (not just notices)
    if (stderr && stderr.includes('ERROR')) {
      console.error(`  ❌ ${migrationFile}: ${stderr}`);
      return false;
    }

    console.log(`  ✅ ${migrationFile}`);
    return true;
  } catch (error) {
    // Some migrations might fail because objects already exist - that's ok
    if (error.message.includes('already exists') ||
        error.message.includes('duplicate key') ||
        error.message.includes('relation') && error.message.includes('already exists')) {
      console.log(`  ⚠️ ${migrationFile} (already applied)`);
      return true;
    }
    console.error(`  ❌ ${migrationFile}: ${error.message}`);
    return false;
  }
}

async function runMigrationsForClinic(clinic) {
  console.log(`\n📦 Running migrations for: ${clinic.name || clinic.dbName}`);

  const migrations = options.migrationFile
    ? [options.migrationFile]
    : NEW_MIGRATIONS;

  let successCount = 0;
  let failCount = 0;

  for (const migration of migrations) {
    const success = await runMigration(clinic.dbName, migration);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  return { successCount, failCount };
}

async function main() {
  console.log('🚀 Clinic Migration Runner');
  console.log('========================');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  // Get clinic databases
  let clinics = await getClinicDatabases();

  if (clinics.length === 0) {
    console.log('No clinic databases found.');
    return;
  }

  // Filter by clinic ID if specified
  if (options.clinicId) {
    clinics = clinics.filter(c =>
      c.id === options.clinicId ||
      c.dbName.includes(options.clinicId.replace(/-/g, '_'))
    );

    if (clinics.length === 0) {
      console.log(`Clinic not found: ${options.clinicId}`);
      return;
    }
  }

  console.log(`Found ${clinics.length} clinic database(s)`);

  const migrations = options.migrationFile
    ? [options.migrationFile]
    : NEW_MIGRATIONS;

  console.log(`Migrations to run: ${migrations.join(', ')}`);

  let totalSuccess = 0;
  let totalFail = 0;

  for (const clinic of clinics) {
    const { successCount, failCount } = await runMigrationsForClinic(clinic);
    totalSuccess += successCount;
    totalFail += failCount;
  }

  console.log('\n========================');
  console.log(`✅ Successful: ${totalSuccess}`);
  if (totalFail > 0) {
    console.log(`❌ Failed: ${totalFail}`);
  }
  console.log('Done!');
}

main().catch(console.error);
