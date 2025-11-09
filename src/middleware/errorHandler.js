const { logger } = require('../utils/logger');

/**
 * Middleware de gestion globale des erreurs
 * @param {Error} err - L'erreur capturée
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log de l'erreur
  logger.error(`Error ${err.name}: ${err.message}`, {
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Erreur de validation Sequelize
  if (err.name === 'SequelizeValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = {
      statusCode: 400,
      message: 'Validation Error',
      details: message
    };
  }

  // Erreur contrainte unique Sequelize
  if (err.name === 'SequelizeUniqueConstraintError') {
    const message = 'Duplicate field value entered';
    error = {
      statusCode: 400,
      message: 'Duplicate Entry',
      details: message
    };
  }

  // Erreur JWT
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = {
      statusCode: 401,
      message: 'Authentication Error',
      details: message
    };
  }

  // Erreur JWT expiré
  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = {
      statusCode: 401,
      message: 'Authentication Error',
      details: message
    };
  }

  // Erreur de validation Joi
  if (err.isJoi) {
    const message = err.details.map(detail => detail.message).join(', ');
    error = {
      statusCode: 400,
      message: 'Validation Error',
      details: message
    };
  }

  // Erreur de cast (ID invalide)
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = {
      statusCode: 404,
      message: 'Not Found',
      details: message
    };
  }

  // Réponse par défaut
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Server Error';

  const response = {
    success: false,
    error: {
      message,
      ...(error.details && { details: error.details }),
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method
    }
  };

  // En développement, inclure la stack trace
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;