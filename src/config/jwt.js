const jwt = require('jsonwebtoken');

// No fallback values -- validated at startup by validateEnv.js
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '24h';
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '7d';

/**
 * Génère un token JWT d'accès
 * @param {Object} payload - Données utilisateur à inclure
 * @returns {string} Token JWT
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRE,
    issuer: 'facturepro-api',
    audience: 'facturepro-client'
  });
};

/**
 * Génère un token de refresh
 * @param {Object} payload - Données utilisateur à inclure
 * @returns {string} Refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRE,
    issuer: 'facturepro-api',
    audience: 'facturepro-client'
  });
};

/**
 * Vérifie un token d'accès
 * @param {string} token - Token à vérifier
 * @returns {Object} Payload décodé
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_SECRET, {
    issuer: 'facturepro-api',
    audience: 'facturepro-client'
  });
};

/**
 * Vérifie un refresh token
 * @param {string} token - Refresh token à vérifier
 * @returns {Object} Payload décodé
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET, {
    issuer: 'facturepro-api',
    audience: 'facturepro-client'
  });
};

/**
 * Décode un token sans vérification (pour debug)
 * @param {string} token - Token à décoder
 * @returns {Object} Payload décodé
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken
};