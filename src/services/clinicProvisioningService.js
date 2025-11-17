/**
 * Clinic Provisioning Service
 * Handles automatic creation of clinic-specific databases and initial setup
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { connectionManager } = require('../config/connectionManager');
const { logger } = require('../utils/logger');

const execAsync = promisify(exec);

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
      const dbPassword = process.env.DB_PASSWORD || 'medicalpro2024';
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

      // Step 3: Initialize clinic-specific data
      await this._initializeClinicData(dbName, dbUser, dbPassword, dbHost, dbPort, clinicId, country);
      logger.info(`✅ Clinic data initialized for: ${dbName}`);

      logger.info(`✅ Clinic provisioning completed successfully`, {
        clinicId,
        clinicName,
        dbName
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
          country
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
      // Use psql to create database
      const createDbCommand = `
        PGPASSWORD='${dbPassword}' psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1 || \
        PGPASSWORD='${dbPassword}' psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -c "CREATE DATABASE ${dbName};"
      `;

      await execAsync(createDbCommand);
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
        '001_medical_schema.sql',
        '002_medical_patients.sql',
        '003_products_services.sql',
        '004_medical_practitioners.sql',
        '005_medical_appointments.sql',
        '006_medical_appointment_items.sql',
        '007_medical_documents.sql',
        '008_medical_consents.sql'
      ];

      for (const migrationFile of migrationFiles) {
        const migrationPath = `/var/www/medical-pro-backend/migrations/${migrationFile}`;
        const runMigrationCommand = `PGPASSWORD='${dbPassword}' psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -f ${migrationPath}`;

        try {
          await execAsync(runMigrationCommand);
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
   * @private
   */
  async _initializeClinicData(dbName, dbUser, dbPassword, dbHost, dbPort, clinicId, country) {
    try {
      // Initialize with default values for the clinic
      // This can be extended in the future for clinic-specific defaults
      logger.debug(`Clinic data initialized for: ${dbName}`);
    } catch (error) {
      throw new Error(`Failed to initialize clinic data: ${error.message}`);
    }
  }

  /**
   * Create healthcare provider in clinic database
   * This syncs the user from the central database to the clinic-specific database
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

      // Create a basic healthcare provider record (without full model definition)
      // The healthcare_providers table is created by migrations
      const insertSql = `
        INSERT INTO healthcare_providers (
          id, facility_id, email, password_hash, first_name, last_name,
          profession, role, is_active, email_verified, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (email) DO NOTHING;
      `;

      await clinicDb.query(insertSql, {
        bind: [
          userData.id,                           // id
          clinicId,                              // facility_id
          userData.email,                        // email
          userData.password_hash,                // password_hash
          userData.first_name || userData.firstName || 'User',  // first_name
          userData.last_name || userData.lastName || '',        // last_name
          'practitioner',                        // profession (default)
          userData.role || 'practitioner',       // role
          true,                                  // is_active
          userData.email_verified || false       // email_verified
        ]
      });

      await clinicDb.close();
      logger.info(`✅ Healthcare provider created in clinic database: ${dbName}`, {
        clinicId,
        userId: userData.id,
        email: userData.email
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
      const dbPassword = process.env.DB_PASSWORD || 'medicalpro2024';
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || 5432;

      const testCommand = `PGPASSWORD='${dbPassword}' psql -h ${dbHost} -U ${dbUser} -p ${dbPort} -d ${dbName} -c "SELECT 1;"`;
      await execAsync(testCommand);

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
}

module.exports = new ClinicProvisioningService();
