/**
 * Clinic Subdomain Middleware
 *
 * Detects the clinic from the subdomain and attaches clinic info to the request.
 *
 * Flow:
 * 1. Nginx extracts subdomain and passes it as X-Clinic-Subdomain header
 * 2. This middleware looks up the clinic by subdomain
 * 3. If found, req.clinic is set with clinic details
 * 4. If not found, returns 404 (unknown clinic)
 *
 * Usage:
 *   app.use(clinicSubdomainMiddleware);
 *
 * Then in routes:
 *   const clinicId = req.clinic?.id;
 *   const clinicDb = req.clinic?.databaseName;
 */

const { getCentralDbConnection } = require('../config/database');

// Cache clinic lookups (refresh every 5 minutes)
const clinicCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Normalize subdomain to a valid format
 * - Lowercase
 * - Remove special characters
 * - Replace spaces with hyphens
 */
function normalizeSubdomain(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9-]/g, '-')     // Replace non-alphanumeric with hyphen
    .replace(/-+/g, '-')              // Collapse multiple hyphens
    .replace(/^-|-$/g, '');           // Trim hyphens
}

/**
 * Generate subdomain from clinic name
 * Example: "Clínica Ozondenia" → "ozondenia"
 */
function generateSubdomain(clinicName) {
  // Remove common prefixes
  const prefixes = ['clinica', 'clinic', 'centro', 'centre', 'cabinet'];
  let name = clinicName.toLowerCase();

  for (const prefix of prefixes) {
    if (name.startsWith(prefix + ' ')) {
      name = name.substring(prefix.length + 1);
      break;
    }
  }

  return normalizeSubdomain(name);
}

/**
 * Lookup clinic by subdomain
 */
async function lookupClinicBySubdomain(subdomain) {
  // Check cache first
  const cached = clinicCache.get(subdomain);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.clinic;
  }

  try {
    const centralDb = getCentralDbConnection();

    const [clinicRows] = await centralDb.query(`
      SELECT
        id,
        name,
        subdomain,
        is_active,
        clinic_db_provisioned,
        'medicalpro_clinic_' || REPLACE(id::text, '-', '_') as database_name
      FROM companies
      WHERE subdomain = $1 AND is_active = true
      LIMIT 1
    `, { bind: [subdomain] });
    const clinic = clinicRows[0];

    // Cache the result (even if null)
    clinicCache.set(subdomain, {
      clinic: clinic || null,
      timestamp: Date.now()
    });

    return clinic || null;
  } catch (error) {
    console.error('[clinicSubdomain] Error looking up clinic:', error);
    return null;
  }
}

/**
 * Clear cache for a specific subdomain (call after clinic update)
 */
function clearClinicCache(subdomain) {
  if (subdomain) {
    clinicCache.delete(subdomain);
  } else {
    clinicCache.clear();
  }
}

/**
 * Express middleware
 */
async function clinicSubdomainMiddleware(req, res, next) {
  // Get subdomain from Nginx header
  const subdomain = req.headers['x-clinic-subdomain'];

  // No subdomain = main app (app.medimaestro.com)
  if (!subdomain || subdomain === 'app' || subdomain === 'www') {
    req.clinic = null;
    return next();
  }

  // Skip for health checks and public routes
  if (req.path === '/health' || req.path.startsWith('/api/v1/public')) {
    req.clinic = null;
    return next();
  }

  // Lookup clinic
  const clinic = await lookupClinicBySubdomain(subdomain);

  if (!clinic) {
    return res.status(404).json({
      success: false,
      error: 'Clinic not found',
      message: `No clinic found for subdomain: ${subdomain}`
    });
  }

  if (!clinic.clinic_db_provisioned) {
    return res.status(503).json({
      success: false,
      error: 'Clinic not ready',
      message: 'This clinic is being set up. Please try again later.'
    });
  }

  // Attach clinic to request
  req.clinic = {
    id: clinic.id,
    name: clinic.name,
    subdomain: clinic.subdomain,
    databaseName: clinic.database_name
  };

  next();
}

module.exports = {
  clinicSubdomainMiddleware,
  generateSubdomain,
  normalizeSubdomain,
  lookupClinicBySubdomain,
  clearClinicCache
};
