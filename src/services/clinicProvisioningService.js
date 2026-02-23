/**
 * Clinic Provisioning Service
 * Handles automatic creation of clinic-specific databases and initial setup
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { connectionManager } = require('../config/connectionManager');
const { logger } = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * Execute a shell command with PGPASSWORD passed via environment variable
 * instead of interpolating it into the command string (prevents command injection).
 */
function execPsql(command, dbPassword) {
  return execAsync(command, {
    env: { ...process.env, PGPASSWORD: dbPassword }
  });
}

class ClinicProvisioningService {
  /**
   * Auto-provision clinic database
   * Creates a new clinic database and runs migrations
   *
   * @param {Object} params
   * @param {String} params.clinicId - Unique clinic UUID
   * @param {String} params.clinicName - Clinic name
   * @param {String} params.country - Country code (FR/ES)
   * @returns {Promise<Object>} Clinic connection info
   */
  async provisionClinicDatabase({ clinicId, clinicName, country }) {
    try {
      const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;
      const dbUser = process.env.DB_USER || 'medicalpro';
      const dbPassword = process.env.DB_PASSWORD;
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || 5432;

      logger.info(`🔧 Starting clinic database provisioning...`, {
        clinicId,
        clinicName,
        dbName,
        country
      });

      // Step 1: Create database
      await this._createDatabase(dbName, dbUser, dbPassword, dbHost, dbPort);
      logger.info(`✅ Database created: ${dbName}`);

      // Step 2: Run migrations
      await this._runMigrations(dbName, dbUser, dbPassword, dbHost, dbPort);
      logger.info(`✅ Migrations executed for: ${dbName}`);

      // Step 3: Initialize clinic-specific data (create default facility)
      const facilityInfo = await this._initializeClinicData(dbName, dbUser, dbPassword, dbHost, dbPort, clinicId, country, clinicName);
      logger.info(`✅ Clinic data initialized for: ${dbName}`);

      logger.info(`✅ Clinic provisioning completed successfully`, {
        clinicId,
        clinicName,
        dbName,
        defaultFacilityId: facilityInfo.defaultFacilityId
      });

      return {
        success: true,
        clinic: {
          id: clinicId,
          name: clinicName,
          db_name: dbName,
          db_host: dbHost,
          db_port: dbPort,
          db_user: dbUser,
          country,
          defaultFacilityId: facilityInfo.defaultFacilityId,
          defaultFacilityName: facilityInfo.facilityName
        }
      };
    } catch (error) {
      logger.error(`❌ Clinic provisioning failed for ${clinicId}:`, error);
      throw new Error(`Clinic provisioning failed: ${error.message}`);
    }
  }

  /**
   * Create clinic database
   * @private
   */
  async _createDatabase(dbName, dbUser, dbPassword, dbHost, dbPort) {
    try {
      // Use psql to create database -- PGPASSWORD passed via env (not interpolated in shell)
      const createDbCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1 || \
        psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d postgres -c "CREATE DATABASE ${dbName};"`;

      await execPsql(createDbCommand, dbPassword);
      logger.debug(`Database created or already exists: ${dbName}`);
    } catch (error) {
      throw new Error(`Failed to create database ${dbName}: ${error.message}`);
    }
  }

  /**
   * Run clinic migrations
   * @private
   */
  async _runMigrations(dbName, dbUser, dbPassword, dbHost, dbPort) {
    try {
      const migrationFiles = [
        // Core medical schema
        '001_medical_schema.sql',
        '002_medical_patients.sql',
        '003_products_services.sql',
        '004_medical_practitioners.sql',
        '005_medical_appointments.sql',
        '006_medical_appointment_items.sql',
        '007_medical_documents.sql',
        '008_medical_consents.sql',
        '009_email_verification.sql',
        '010_audit_logs.sql',
        '011_add_provider_availability.sql',
        '012_create_clinic_roles.sql',
        '013_create_clinic_settings.sql',
        '014_add_invitation_fields.sql',
        '014_add_operating_days_and_lunch_breaks.sql',
        '015_fix_birth_date_nullable.sql',
        '016_add_administrative_role.sql',
        '017_create_medical_records.sql',
        '018_alter_medical_records_add_columns.sql',
        '019_create_prescriptions.sql',
        '019_alter_prescriptions_add_snapshots.sql',
        // Consent system
        'clinic_020_medical_consents.sql',
        'clinic_021_consent_template_translations.sql',
        'clinic_022_consent_signing_requests.sql',
        'clinic_023_fix_healthcare_providers_role_constraint.sql',
        'clinic_024_practitioner_weekly_availability.sql',
        'clinic_025_patient_care_team.sql',
        // Phase 1 Security Fix
        'clinic_026_phase1_auth_security_fix.sql',
        'clinic_fix_gender_constraint.sql',
        // Onboarding - Teams
        '020_create_teams.sql',
        // Standardization
        'clinic_027_standardize_roles.sql',
        // Schema alignments (frontend/backend/db)
        'clinic_028_add_patient_id_number.sql',
        'clinic_029_add_current_medications.sql',
        'clinic_030_add_appointment_fields.sql',
        'clinic_031_add_consent_fields.sql',
        'clinic_032_fix_consent_template_types_and_status.sql',
        'clinic_033_fix_prescriptions_schema.sql',
        'clinic_034_add_operating_days_to_settings.sql',
        // Medical records fixes
        'clinic_035_fix_medical_records_provider_id.sql',
        'clinic_036_fix_medical_records_record_type_constraint.sql',
        // Facility enhancements
        'clinic_037_add_facility_number.sql',
        'clinic_038_add_logo_url.sql',
        // Soft delete
        'clinic_039_add_soft_delete_fields.sql',
        // Medical records date and assistant
        'clinic_040_add_medical_record_date_assistant.sql',
        // Medical records datetime (include time)
        'clinic_041_change_record_date_to_timestamp.sql',
        // Catalog with medical fields
        'clinic_042_create_products_services.sql',
        // Tags system for product grouping
        'clinic_043_add_tags_system.sql',
        // Machines for treatments
        'clinic_043_create_machines.sql',
        // Planning system
        'clinic_044_appointments_planning.sql',
        'clinic_045_linked_appointments.sql',
        // Suppliers
        'clinic_046_suppliers.sql',
        // Appointment workflow automation
        'clinic_047_appointment_actions.sql',
        'clinic_048_scheduled_jobs.sql',
        'clinic_049_treatment_consent_templates.sql',
        'clinic_050_appointment_workflow_fields.sql',
        // System categories (dynamic consent types, specialties, etc.)
        'clinic_051_system_categories.sql',
        'clinic_052_seed_system_categories.sql',
        'clinic_053_update_consent_type_constraint.sql',
        // Drop overly strict provider-appointment unique constraint
        'clinic_054_drop_provider_appointment_unique.sql',
        // Billing: documents, document_items, document_sequences
        'clinic_055_documents_billing.sql',
        // Consent variable substitution (filled content columns)
        'clinic_056_consent_variable_substitution.sql',
        // Physician: add patients.view_all (temporary until care team UI)
        'clinic_057_physician_patients_view_all.sql',
        // Current illness free-text field on medical records
        'clinic_058_current_illness_field.sql',
        // Prescription clinical context snapshot columns
        'clinic_059_prescription_clinical_context.sql',
        // Custom medications (CIMA integration)
        'clinic_060_custom_medications.sql',
        // Admin medical permissions + nurse role
        'clinic_061_admin_medical_nurse_role.sql',
        // Vitals glycemia + appointment link on medical records
        'clinic_062_vitals_glycemia_appointment_link.sql',
        // Default roles insertion
        '025_insert_default_clinic_roles.sql'
      ];

      for (const migrationFile of migrationFiles) {
        const migrationPath = `/var/www/medical-pro-backend/migrations/${migrationFile}`;
        const runMigrationCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -f ${migrationPath}`;

        try {
          await execPsql(runMigrationCommand, dbPassword);
          logger.debug(`✅ Migration executed: ${migrationFile}`);
        } catch (migrationError) {
          // Some migrations might fail if tables already exist - that's ok
          logger.debug(`⚠️ Migration might have already been applied: ${migrationFile}`);
        }
      }
    } catch (error) {
      throw new Error(`Failed to run migrations: ${error.message}`);
    }
  }

  /**
   * Initialize clinic-specific data (settings, defaults, etc.)
   * Creates default facility using the clinic name
   * @private
   */
  async _initializeClinicData(dbName, dbUser, dbPassword, dbHost, dbPort, clinicId, country, clinicName) {
    try {
      // Step 1: Create default medical facility
      // Use clinic ID as facility ID for the first facility
      // This allows: 1 facility now, but can add more later with different IDs
      const defaultFacilityId = clinicId; // Use clinic ID as first facility ID

      const createFacilityCommand = `
        psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} << 'EOF'
INSERT INTO medical_facilities (
  id,
  name,
  facility_type,
  address_line1,
  city,
  postal_code,
  country,
  is_active,
  created_at,
  updated_at
) VALUES (
  '${defaultFacilityId}',
  '${clinicName.replace(/'/g, "''")}',
  'cabinet',
  'À compléter',
  'À compléter',
  '00000',
  '${country}',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;
EOF
      `;

      await execPsql(createFacilityCommand, dbPassword);
      logger.info(`✅ Default facility created: ${clinicName}`);

      // Step 2: Insert default clinic roles for this facility
      const insertRolesCommand = `
        psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} << 'EOF'
SELECT insert_default_clinic_roles('${defaultFacilityId}'::uuid);
EOF
      `;

      try {
        await execPsql(insertRolesCommand, dbPassword);
        logger.info(`✅ Default clinic roles created for facility: ${defaultFacilityId}`);
      } catch (roleError) {
        // Log but don't fail provisioning if roles can't be created
        // They can be added later via migration
        logger.warn(`⚠️ Could not create default roles: ${roleError.message}`);
      }

      // Return facility info for later use
      return {
        defaultFacilityId,
        facilityName: clinicName
      };
    } catch (error) {
      logger.error(`Failed to initialize clinic data: ${error.message}`);
      throw new Error(`Failed to initialize clinic data: ${error.message}`);
    }
  }

  /**
   * Create healthcare provider in clinic database
   * This syncs the user from the central database to the clinic-specific database
   *
   * PHASE 1 SECURITY FIX:
   * - NO LONGER copies password_hash (authentication is in central DB only)
   * - Stores central_user_id to link back to users table
   * - Marks auth_migrated_to_central = true
   *
   * @param {String} dbName - Clinic database name
   * @param {String} dbUser - Database user
   * @param {String} dbPassword - Database password
   * @param {String} dbHost - Database host
   * @param {Number} dbPort - Database port
   * @param {String} clinicId - Clinic UUID (maps to facility_id in clinic DB)
   * @param {Object} userData - User data from central database
   */
  async createHealthcareProviderInClinic(dbName, dbUser, dbPassword, dbHost, dbPort, clinicId, userData) {
    try {
      // Create a temporary connection to the clinic database
      const { Sequelize } = require('sequelize');
      const clinicDb = new Sequelize({
        host: dbHost,
        port: dbPort,
        database: dbName,
        username: dbUser,
        password: dbPassword,
        dialect: 'postgres',
        logging: false,
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000
        }
      });

      // PHASE 1 FIX: Create healthcare provider WITHOUT password_hash
      // Password is ONLY stored in central users table
      // central_user_id links back to users.id for authentication
      const insertSql = `
        INSERT INTO healthcare_providers (
          id, facility_id, email, first_name, last_name,
          profession, role, is_active, email_verified,
          central_user_id, auth_migrated_to_central,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (email) DO UPDATE SET
          central_user_id = EXCLUDED.central_user_id,
          auth_migrated_to_central = EXCLUDED.auth_migrated_to_central,
          updated_at = CURRENT_TIMESTAMP;
      `;

      await clinicDb.query(insertSql, {
        bind: [
          userData.id,                                          // id (same as central user id for consistency)
          clinicId,                                             // facility_id
          userData.email,                                       // email
          userData.first_name || userData.firstName || 'User',  // first_name
          userData.last_name || userData.lastName || '',        // last_name
          'practitioner',                                       // profession (default)
          userData.role || 'admin',                             // role
          true,                                                 // is_active
          userData.email_verified || false,                     // email_verified
          userData.id,                                          // central_user_id (links to users.id)
          true                                                  // auth_migrated_to_central
        ]
      });

      await clinicDb.close();
      logger.info(`✅ Healthcare provider created in clinic database (Phase 1 - no password copied): ${dbName}`, {
        clinicId,
        centralUserId: userData.id,
        email: userData.email,
        authMigratedToCentral: true
      });

      return true;
    } catch (error) {
      logger.warn(`⚠️ Failed to create healthcare provider in clinic DB: ${error.message}`);
      // Don't throw - allow registration to continue even if provider creation fails
      // User can still be created in clinic DB manually
      return false;
    }
  }

  /**
   * Verify clinic database is accessible
   */
  async verifyClinicDatabase(clinicId) {
    try {
      const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;
      const dbUser = process.env.DB_USER || 'medicalpro';
      const dbPassword = process.env.DB_PASSWORD;
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || 5432;

      const testCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -c "SELECT 1;"`;
      await execPsql(testCommand, dbPassword);

      logger.info(`✅ Clinic database verified: ${dbName}`);
      return true;
    } catch (error) {
      logger.error(`❌ Clinic database verification failed for ${clinicId}:`, error.message);
      return false;
    }
  }

  /**
   * Get clinic database name from ID
   */
  getClinicDatabaseName(clinicId) {
    return `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;
  }

  /**
   * Cleanup failed provisioning - Remove clinic database if it was partially created
   * @param {String} clinicId - UUID of the clinic
   */
  async cleanupFailedProvisioning(clinicId) {
    try {
      const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;
      const dbUser = process.env.DB_USER || 'medicalpro';
      const dbPassword = process.env.DB_PASSWORD;
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || 5432;

      logger.info(`🗑️ Cleaning up failed provisioning for clinic: ${clinicId}`);

      // Check if database exists
      const checkDbCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1`;

      try {
        await execPsql(checkDbCommand, dbPassword);

        // Database exists, drop it
        const dropDbCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -c "DROP DATABASE IF EXISTS ${dbName};"`;
        await execPsql(dropDbCommand, dbPassword);

        logger.info(`✅ Cleaned up database: ${dbName}`);
      } catch (error) {
        // Database doesn't exist, nothing to cleanup
        logger.debug(`Database ${dbName} does not exist, no cleanup needed`);
      }

      return true;
    } catch (error) {
      logger.error(`❌ Failed to cleanup clinic database:`, error.message);
      // Don't throw - cleanup is best effort
      return false;
    }
  }

  /**
   * Check clinic database integrity
   * @param {String} clinicId - UUID of the clinic
   * @returns {Promise<Object>} Integrity check result
   */
  async checkClinicDatabaseIntegrity(clinicId) {
    try {
      const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;
      const dbUser = process.env.DB_USER || 'medicalpro';
      const dbPassword = process.env.DB_PASSWORD;
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || 5432;

      // 1. Check if database exists
      const checkDbCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1`;

      try {
        await execPsql(checkDbCommand, dbPassword);
      } catch (error) {
        return {
          exists: false,
          accessible: false,
          tablesCount: 0,
          isHealthy: false,
          errors: ['Database does not exist']
        };
      }

      // 2. Check if database is accessible
      const connectCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -c "SELECT 1;" 2>&1`;

      try {
        await execPsql(connectCommand, dbPassword);
      } catch (error) {
        return {
          exists: true,
          accessible: false,
          tablesCount: 0,
          isHealthy: false,
          errors: ['Database exists but not accessible']
        };
      }

      // 3. Count tables
      const countTablesCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -tc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"`;

      const { stdout } = await execPsql(countTablesCommand, dbPassword);
      const tablesCount = parseInt(stdout.trim()) || 0;

      // 4. Check for required tables
      const requiredTables = [
        'healthcare_providers',
        'patients',
        'appointments',
        'documents',
        'system_categories'
      ];

      const missingTables = [];
      for (const table of requiredTables) {
        const checkTableCommand = `psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -tc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}';" | grep -q 1`;

        try {
          await execPsql(checkTableCommand, dbPassword);
        } catch (error) {
          missingTables.push(table);
        }
      }

      const isHealthy = tablesCount > 0 && missingTables.length === 0;

      return {
        exists: true,
        accessible: true,
        tablesCount,
        isHealthy,
        missingTables,
        errors: missingTables.length > 0 ? [`Missing tables: ${missingTables.join(', ')}`] : []
      };

    } catch (error) {
      logger.error(`❌ Failed to check clinic database integrity:`, error.message);
      return {
        exists: false,
        accessible: false,
        tablesCount: 0,
        isHealthy: false,
        errors: [error.message]
      };
    }
  }

  /**
   * Repair clinic database - Fix incomplete or corrupted clinic database
   * @param {String} clinicId - UUID of the clinic
   * @param {String} clinicName - Name of the clinic
   * @param {String} country - Country code
   */
  async repairClinicDatabase(clinicId, clinicName, country) {
    try {
      logger.info(`🔧 Starting clinic database repair for: ${clinicId}`);

      // 1. Check current state
      const integrity = await this.checkClinicDatabaseIntegrity(clinicId);

      if (!integrity.exists) {
        // Database doesn't exist, create from scratch
        logger.info('Database does not exist, creating from scratch...');
        return await this.provisionClinicDatabase({
          clinicId,
          clinicName: clinicName || 'Repaired Clinic',
          country: country || 'FR'
        });
      }

      if (!integrity.accessible) {
        throw new Error('Database exists but is not accessible');
      }

      if (integrity.isHealthy) {
        logger.info('Database is already healthy, no repair needed');
        return {
          success: true,
          message: 'Database is already healthy',
          integrity
        };
      }

      // 2. Reapply migrations for missing tables
      if (integrity.missingTables.length > 0) {
        logger.info(`Reapplying migrations for missing tables: ${integrity.missingTables.join(', ')}`);

        const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;
        const dbUser = process.env.DB_USER || 'medicalpro';
        const dbPassword = process.env.DB_PASSWORD;
        const dbHost = process.env.DB_HOST || 'localhost';
        const dbPort = process.env.DB_PORT || 5432;

        await this._runMigrations(dbName, dbUser, dbPassword, dbHost, dbPort);
      }

      // 3. Verify again
      const finalIntegrity = await this.checkClinicDatabaseIntegrity(clinicId);

      if (finalIntegrity.isHealthy) {
        logger.info(`✅ Clinic database repaired successfully`);
        return {
          success: true,
          message: 'Database repaired successfully',
          integrity: finalIntegrity
        };
      } else {
        throw new Error('Repair failed, database still unhealthy');
      }

    } catch (error) {
      logger.error(`❌ Failed to repair clinic database:`, error.message);
      throw error;
    }
  }
}

module.exports = new ClinicProvisioningService();
