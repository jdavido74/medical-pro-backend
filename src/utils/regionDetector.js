/**
 * Region Detection Utility (Backend)
 *
 * Detects the medical clinic region (country) from:
 * 1. Sub-domain of request hostname (es.medicalpro.com, fr.medicalpro.com)
 * 2. Query parameter (/?region=es)
 * 3. User's country from JWT token
 * 4. Default (es)
 *
 * Each region has:
 * - Language (single language per instance - NOT switching)
 * - Business rules (TVA rates, validation rules)
 * - Document formats
 */

const VALID_REGIONS = {
  'es': {
    code: 'es',
    name: 'España',
    language: 'es',
    locale: 'es-ES',
    currency: 'EUR',
    country: 'ES',
    businessRules: {
      defaultTaxRate: 21, // IVA 21%
      taxLabel: 'IVA',
      businessNumberField: 'nif', // National Identification Number
      validationRules: {
        nif: true,
        siret: false
      }
    }
  },
  'fr': {
    code: 'fr',
    name: 'France',
    language: 'fr',
    locale: 'fr-FR',
    currency: 'EUR',
    country: 'FR',
    businessRules: {
      defaultTaxRate: 20, // TVA 20%
      taxLabel: 'TVA',
      businessNumberField: 'siret', // SIRET number
      validationRules: {
        nif: false,
        siret: true
      }
    }
  }
};

const DEFAULT_REGION = 'es'; // Spain is default
const REGION_PARAM_NAME = 'region';

/**
 * Detect region from request hostname sub-domain
 * @param {Object} req Express request object
 * @returns {string|null} Region code or null
 */
function detectRegionFromHostname(req) {
  try {
    const hostname = req.hostname || req.host || '';
    const parts = hostname.split('.');
    const potential = parts[0].toLowerCase();

    // Check if first part is a valid region code
    if (VALID_REGIONS[potential]) {
      return potential;
    }
  } catch (e) {
    console.debug('Error detecting region from hostname:', e.message);
  }

  return null;
}

/**
 * Detect region from query parameter
 * @param {Object} req Express request object
 * @returns {string|null} Region code or null
 */
function detectRegionFromQuery(req) {
  try {
    const region = req.query?.[REGION_PARAM_NAME];
    if (region && VALID_REGIONS[region]) {
      return region;
    }
  } catch (e) {
    console.debug('Error detecting region from query:', e.message);
  }

  return null;
}

/**
 * Detect region from user's country in JWT token
 * @param {Object} req Express request object
 * @returns {string|null} Region code or null
 */
function detectRegionFromUser(req) {
  try {
    const userCountry = req.user?.country?.toLowerCase();
    if (userCountry && VALID_REGIONS[userCountry]) {
      return userCountry;
    }
  } catch (e) {
    console.debug('Error detecting region from user:', e.message);
  }

  return null;
}

/**
 * Main region detection function for middleware
 * Priority order:
 * 1. Sub-domain (es.medicalpro.com) - Highest priority
 * 2. Query parameter (?region=es)
 * 3. User's country from JWT token
 * 4. Default (es)
 *
 * @param {Object} req Express request object
 * @returns {string} Region code (es, fr)
 */
function detectRegion(req) {
  // 1. Check sub-domain first (highest priority)
  const subdomain = detectRegionFromHostname(req);
  if (subdomain) {
    return subdomain;
  }

  // 2. Check query parameter
  const queryRegion = detectRegionFromQuery(req);
  if (queryRegion) {
    return queryRegion;
  }

  // 3. Check user's country from JWT
  const userRegion = detectRegionFromUser(req);
  if (userRegion) {
    return userRegion;
  }

  // 4. Use default
  return DEFAULT_REGION;
}

/**
 * Get region configuration
 * @param {string} region Region code
 * @returns {Object} Region configuration
 */
function getRegionConfig(region) {
  return VALID_REGIONS[region] || VALID_REGIONS[DEFAULT_REGION];
}

/**
 * Get region language (single language per instance)
 * @param {string} region Region code
 * @returns {string} Language code (es, fr)
 */
function getRegionLanguage(region) {
  const config = getRegionConfig(region);
  return config.language;
}

/**
 * Get business rules for region
 * @param {string} region Region code
 * @returns {Object} Business rules configuration
 */
function getBusinessRules(region) {
  const config = getRegionConfig(region);
  return config.businessRules;
}

/**
 * Check if region is valid
 * @param {string} region Region code
 * @returns {boolean}
 */
function isValidRegion(region) {
  return !!VALID_REGIONS[region];
}

/**
 * Get all available regions
 * @returns {Object} All region configurations
 */
function getAllRegions() {
  return VALID_REGIONS;
}

/**
 * Express middleware to detect and attach region to request
 * Adds req.region and req.regionConfig to all requests
 *
 * Usage: app.use(regionMiddleware);
 */
function regionMiddleware() {
  return (req, res, next) => {
    req.region = detectRegion(req);
    req.regionConfig = getRegionConfig(req.region);

    // Log region detection (useful for debugging)
    console.debug(`📍 Request to ${req.hostname} detected region: ${req.region.toUpperCase()}`);

    next();
  };
}

module.exports = {
  detectRegion,
  detectRegionFromHostname,
  detectRegionFromQuery,
  detectRegionFromUser,
  getRegionConfig,
  getRegionLanguage,
  getBusinessRules,
  isValidRegion,
  getAllRegions,
  regionMiddleware,
  DEFAULT_REGION,
  VALID_REGIONS,
  REGION_PARAM_NAME
};
