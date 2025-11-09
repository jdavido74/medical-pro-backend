/**
 * Dynamic Database Connection Manager
 *
 * Purpose: Manage connections to clinic-specific databases
 * Each clinic has its own isolated PostgreSQL database
 *
 * Architecture:
 * - Central DB: medicalpro_central (clinics metadata + users)
 * - Clinic DBs: medicalpro_clinic_<uuid> (patient data, isolated per clinic)
 */

const { Sequelize } = require('sequelize');
const path = require('path');

// Cache for clinic connections (clinic_id -> Sequelize instance)
const clinicConnections = new Map();

// Central database connection (never changes)
let centralSequelize = null;

/**
 * Initialize central database connection
 * This connects to medicalpro_central to read clinic metadata
 */
async function initializeCentralConnection() {
  if (centralSequelize) return centralSequelize;

  centralSequelize = new Sequelize(
    process.env.CENTRAL_DB_NAME || 'medicalpro_central',
    process.env.DB_USER || 'medicalpro',
    process.env.DB_PASSWORD || 'medicalpro2024',
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false,
      pool: {
        max: 5,
        min: 1,
        acquire: 30000,
        idle: 10000
      }
    }
  );

  try {
    await centralSequelize.authenticate();
    console.log('[ConnectionManager] ✅ Central database authenticated');
    return centralSequelize;
  } catch (error) {
    console.error('[ConnectionManager] ❌ Failed to authenticate central database:', error.message);
    throw error;
  }
}

/**
 * Get clinic connection info from central database
 */
async function getClinicConnectionInfo(clinicId) {
  try {
    const central = await initializeCentralConnection();

    // Query central database for clinic connection details
    const [results] = await central.query(
      `SELECT id, db_host, db_port, db_name, db_user, db_password
       FROM companies
       WHERE id = :clinicId AND deleted_at IS NULL`,
      { replacements: { clinicId }, type: 'SELECT' }
    );

    if (!results || results.length === 0) {
      throw new Error(`Clinic ${clinicId} not found or inactive`);
    }

    return results[0];
  } catch (error) {
    console.error('[ConnectionManager] Error fetching clinic connection info:', error.message);
    throw error;
  }
}

/**
 * Get or create Sequelize connection for a specific clinic
 *
 * @param {string} clinicId - UUID of the clinic
 * @returns {Sequelize} - Sequelize instance for the clinic's database
 */
async function getClinicConnection(clinicId) {
  // Check cache first
  if (clinicConnections.has(clinicId)) {
    return clinicConnections.get(clinicId);
  }

  try {
    // Fetch clinic connection info from central DB
    const clinicInfo = await getClinicConnectionInfo(clinicId);

    // Create new Sequelize connection for this clinic
    const clinicSequelize = new Sequelize(
      clinicInfo.db_name,
      clinicInfo.db_user,
      clinicInfo.db_password,
      {
        host: clinicInfo.db_host,
        port: clinicInfo.db_port,
        dialect: 'postgres',
        logging: false,
        pool: {
          max: 10,
          min: 2,
          acquire: 30000,
          idle: 10000
        }
      }
    );

    // Test connection
    await clinicSequelize.authenticate();
    console.log(`[ConnectionManager] ✅ Connected to clinic ${clinicId}`);

    // Cache the connection
    clinicConnections.set(clinicId, clinicSequelize);

    return clinicSequelize;
  } catch (error) {
    console.error(`[ConnectionManager] ❌ Failed to connect to clinic ${clinicId}:`, error.message);
    throw error;
  }
}

/**
 * Close a clinic connection and remove from cache
 */
async function closeClinicConnection(clinicId) {
  if (clinicConnections.has(clinicId)) {
    const connection = clinicConnections.get(clinicId);
    await connection.close();
    clinicConnections.delete(clinicId);
    console.log(`[ConnectionManager] Closed connection for clinic ${clinicId}`);
  }
}

/**
 * Close all connections
 */
async function closeAllConnections() {
  // Close all clinic connections
  for (const [clinicId, connection] of clinicConnections.entries()) {
    try {
      await connection.close();
      console.log(`[ConnectionManager] Closed connection for clinic ${clinicId}`);
    } catch (error) {
      console.error(`[ConnectionManager] Error closing clinic ${clinicId}:`, error.message);
    }
  }
  clinicConnections.clear();

  // Close central connection
  if (centralSequelize) {
    try {
      await centralSequelize.close();
      console.log('[ConnectionManager] Closed central database connection');
    } catch (error) {
      console.error('[ConnectionManager] Error closing central connection:', error.message);
    }
    centralSequelize = null;
  }
}

/**
 * Get central database connection
 */
function getCentralConnection() {
  if (!centralSequelize) {
    throw new Error('Central database not initialized. Call initializeCentralConnection() first.');
  }
  return centralSequelize;
}

/**
 * Get all cached clinic connections (for monitoring/cleanup)
 */
function getCachedClinicConnections() {
  return Array.from(clinicConnections.keys());
}

module.exports = {
  initializeCentralConnection,
  getClinicConnection,
  getCentralConnection,
  closeClinicConnection,
  closeAllConnections,
  getCachedClinicConnections,
  getClinicConnectionInfo
};
