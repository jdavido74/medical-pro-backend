/**
 * Dynamic Database Connection Manager
 *
 * Purpose: Manage connections to clinic-specific databases
 * Each clinic has its own isolated PostgreSQL database
 *
 * Architecture:
 * - Central DB: medicalpro_central (clinics metadata + users)
 * - Clinic DBs: medicalpro_clinic_<uuid> (patient data, isolated per clinic)
 *
 * Refactored for:
 * - Better separation of concerns (config generation vs connection management)
 * - Reduced code duplication
 * - Improved error handling
 * - Enhanced maintainability
 */

const { Sequelize } = require('sequelize');
const path = require('path');

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

// Cache for clinic connections (clinic_id -> Sequelize instance)
const clinicConnections = new Map();

// Central database connection (singleton pattern)
let centralSequelize = null;

// Default pool configuration (can be customized per connection type)
const DEFAULT_POOL_CONFIG = {
  acquire: 30000,    // Max time to get connection (ms)
  idle: 10000        // Max idle time before releasing (ms)
};

// ============================================================================
// CONFIGURATION GENERATION
// ============================================================================

/**
 * Generate Sequelize configuration object
 * Consolidates common configuration logic to reduce duplication
 *
 * @param {Object} options - Configuration options
 * @param {string} options.database - Database name
 * @param {string} options.username - Database user
 * @param {string} options.password - Database password
 * @param {string} options.host - Database host
 * @param {number} options.port - Database port
 * @param {Object} options.pool - Pool configuration override
 * @returns {Object} - Sequelize configuration object
 */
function generateSequelizeConfig(options) {
  const {
    database,
    username = process.env.DB_USER || 'medicalpro',
    password = process.env.DB_PASSWORD || 'medicalpro2024',
    host = process.env.DB_HOST || 'localhost',
    port = process.env.DB_PORT || 5432,
    pool = {}
  } = options;

  return {
    database,
    username,
    password,
    host,
    port,
    dialect: 'postgres',
    logging: false,
    pool: {
      max: pool.max ?? (options.isCentral ? 5 : 10),
      min: pool.min ?? (options.isCentral ? 1 : 2),
      ...DEFAULT_POOL_CONFIG,
      ...pool
    }
  };
}

/**
 * Create and authenticate a Sequelize connection
 * Consolidates connection creation logic
 *
 * @param {Object} config - Sequelize configuration
 * @param {string} identifier - Identifier for logging (clinic_id or 'central')
 * @returns {Promise<Sequelize>} - Authenticated Sequelize instance
 */
async function createAndAuthenticateConnection(config, identifier) {
  try {
    const sequelize = new Sequelize(
      config.database,
      config.username,
      config.password,
      {
        host: config.host,
        port: config.port,
        dialect: config.dialect,
        logging: config.logging,
        pool: config.pool
      }
    );

    await sequelize.authenticate();
    console.log(`[ConnectionManager] ✅ Connection authenticated: ${identifier}`);

    return sequelize;
  } catch (error) {
    console.error(`[ConnectionManager] ❌ Failed to authenticate ${identifier}:`, error.message);
    throw error;
  }
}

// ============================================================================
// CENTRAL DATABASE MANAGEMENT
// ============================================================================

/**
 * Initialize central database connection
 * This connects to medicalpro_central to read clinic metadata
 * Uses singleton pattern to ensure only one connection
 *
 * @returns {Promise<Sequelize>} - Central database Sequelize instance
 */
async function initializeCentralConnection() {
  if (centralSequelize) return centralSequelize;

  const config = generateSequelizeConfig({
    database: process.env.CENTRAL_DB_NAME || 'medicalpro_central',
    isCentral: true
  });

  centralSequelize = await createAndAuthenticateConnection(config, 'Central');
  return centralSequelize;
}

/**
 * Get central database connection
 * Ensures connection is initialized before returning
 *
 * @returns {Sequelize} - Central database Sequelize instance
 */
function getCentralConnection() {
  if (!centralSequelize) {
    throw new Error('Central database not initialized. Call initializeCentralConnection() first.');
  }
  return centralSequelize;
}

// ============================================================================
// CLINIC DATABASE MANAGEMENT
// ============================================================================

/**
 * Get clinic connection info from central database
 * Retrieves connection parameters for a specific clinic
 *
 * Clinic databases follow pattern: medicalpro_clinic_<clinicId>
 * All clinics use same connection credentials (same PostgreSQL server)
 *
 * @param {string} clinicId - UUID of the clinic
 * @returns {Promise<Object>} - Clinic connection information
 */
async function getClinicConnectionInfo(clinicId) {
  try {
    const central = await initializeCentralConnection();

    // Verify clinic exists in central database
    const [results] = await central.query(
      `SELECT id, name
       FROM companies
       WHERE id = :clinicId AND deleted_at IS NULL`,
      { replacements: { clinicId }, type: 'SELECT' }
    );

    if (!results || results.length === 0) {
      throw new Error(`Clinic ${clinicId} not found or inactive`);
    }

    // Construct clinic database connection info from clinicId
    // Database name format: medicalpro_clinic_<clinicId>
    const dbName = `medicalpro_clinic_${clinicId}`;

    return {
      id: clinicId,
      name: results[0].name,
      db_host: process.env.DB_HOST || 'localhost',
      db_port: process.env.DB_PORT || 5432,
      db_name: dbName,
      db_user: process.env.DB_USER || 'medicalpro',
      db_password: process.env.DB_PASSWORD || 'medicalpro2024'
    };
  } catch (error) {
    console.error('[ConnectionManager] Error fetching clinic connection info:', error.message);
    throw error;
  }
}

/**
 * Get or create Sequelize connection for a specific clinic
 * Uses cache to avoid recreating connections
 *
 * @param {string} clinicId - UUID of the clinic
 * @returns {Promise<Sequelize>} - Sequelize instance for the clinic's database
 */
async function getClinicConnection(clinicId) {
  // Check cache first (significant performance improvement)
  if (clinicConnections.has(clinicId)) {
    return clinicConnections.get(clinicId);
  }

  try {
    // Fetch clinic connection info from central DB
    const clinicInfo = await getClinicConnectionInfo(clinicId);

    // Generate configuration from clinic info
    const config = generateSequelizeConfig({
      database: clinicInfo.db_name,
      username: clinicInfo.db_user,
      password: clinicInfo.db_password,
      host: clinicInfo.db_host,
      port: clinicInfo.db_port,
      isCentral: false
    });

    // Create and authenticate connection
    const clinicSequelize = await createAndAuthenticateConnection(config, `Clinic ${clinicId}`);

    // Cache the connection for future use
    clinicConnections.set(clinicId, clinicSequelize);

    return clinicSequelize;
  } catch (error) {
    console.error(`[ConnectionManager] ❌ Failed to connect to clinic ${clinicId}:`, error.message);
    throw error;
  }
}

// ============================================================================
// CONNECTION CLEANUP
// ============================================================================

/**
 * Close a clinic connection and remove from cache
 * Properly cleans up resources to prevent connection leaks
 *
 * @async
 * @param {string} clinicId - UUID of the clinic
 */
async function closeClinicConnection(clinicId) {
  if (clinicConnections.has(clinicId)) {
    try {
      const connection = clinicConnections.get(clinicId);
      await connection.close();
      clinicConnections.delete(clinicId);
      console.log(`[ConnectionManager] ✅ Closed connection for clinic ${clinicId}`);
    } catch (error) {
      console.error(`[ConnectionManager] ❌ Error closing clinic ${clinicId}:`, error.message);
    }
  }
}

/**
 * Close all connections (clinic and central)
 * Gracefully shuts down all database connections
 * Useful for application shutdown or connection reset
 *
 * @async
 */
async function closeAllConnections() {
  console.log('[ConnectionManager] Closing all connections...');

  // Close all clinic connections
  for (const [clinicId, connection] of clinicConnections.entries()) {
    try {
      await connection.close();
      console.log(`[ConnectionManager] ✅ Closed clinic connection: ${clinicId}`);
    } catch (error) {
      console.error(`[ConnectionManager] ❌ Error closing clinic ${clinicId}:`, error.message);
    }
  }
  clinicConnections.clear();

  // Close central connection
  if (centralSequelize) {
    try {
      await centralSequelize.close();
      console.log('[ConnectionManager] ✅ Closed central database connection');
    } catch (error) {
      console.error('[ConnectionManager] ❌ Error closing central connection:', error.message);
    }
    centralSequelize = null;
  }

  console.log('[ConnectionManager] All connections closed successfully');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all cached clinic connections (for monitoring/debugging)
 * Returns list of clinic IDs that currently have cached connections
 *
 * @returns {string[]} - Array of clinic IDs with active connections
 */
function getCachedClinicConnections() {
  return Array.from(clinicConnections.keys());
}

/**
 * Get connection cache size (for monitoring)
 *
 * @returns {number} - Number of cached clinic connections
 */
function getCacheSize() {
  return clinicConnections.size;
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = {
  // Central database management
  initializeCentralConnection,
  getCentralConnection,

  // Clinic database management
  getClinicConnection,
  getClinicConnectionInfo,

  // Connection cleanup
  closeClinicConnection,
  closeAllConnections,

  // Utilities
  getCachedClinicConnections,
  getCacheSize
};
