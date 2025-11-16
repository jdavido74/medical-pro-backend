require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const { logger, httpLoggerStream } = require('./src/utils/logger');
const { testConnection, syncDatabase } = require('./src/config/database');
const { initializeCentralConnection, closeAllConnections } = require('./src/config/connectionManager');

// Import routes
const authRoutes = require('./src/routes/auth');
const clientRoutes = require('./src/routes/clients');
const invoiceRoutes = require('./src/routes/invoices');
const quoteRoutes = require('./src/routes/quotes');
const validationRoutes = require('./src/routes/validation');
const adminRoutes = require('./src/routes/admin');
const productRoutes = require('./src/routes/products');
const categoryRoutes = require('./src/routes/categories');

// Medical routes
const patientRoutes = require('./src/routes/patients');
const practitionerRoutes = require('./src/routes/practitioners');
const appointmentRoutes = require('./src/routes/appointments');
const appointmentItemRoutes = require('./src/routes/appointment-items');
const documentRoutes = require('./src/routes/documents');
const consentRoutes = require('./src/routes/consents');
const consentTemplateRoutes = require('./src/routes/consent-templates');

// Import middleware
const errorHandler = require('./src/middleware/errorHandler');
const { authMiddleware } = require('./src/middleware/auth');
const { clinicRoutingMiddleware } = require('./src/middleware/clinicRouting');
const { regionMiddleware } = require('./src/utils/regionDetector');

const app = express();
const PORT = process.env.PORT || 3001;
const API_VERSION = process.env.API_VERSION || 'v1';

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'facturepro_api',
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
});

const rateLimitMiddleware = async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
    res.set('Retry-After', String(secs));
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
      retryAfter: secs
    });
  }
};

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: "same-origin" }
}));

// CORS configuration - Handle both single and multiple origins
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
const corsOriginList = corsOrigin.includes(',')
  ? corsOrigin.split(',').map(o => o.trim())
  : [corsOrigin];

app.use(cors({
  origin: corsOriginList.length === 1 ? corsOriginList[0] : corsOriginList,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// General middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: httpLoggerStream }));

// Region detection middleware (detects country from sub-domain)
app.use(regionMiddleware());

// Rate limiting
app.use(rateLimitMiddleware);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use(`/api/${API_VERSION}/auth`, authRoutes);

// Apply clinic routing middleware to all clinic-specific routes
// This middleware extracts clinic_id from JWT and provides req.clinicDb
app.use(`/api/${API_VERSION}/clients`, authMiddleware, clinicRoutingMiddleware, clientRoutes);
app.use(`/api/${API_VERSION}/invoices`, authMiddleware, clinicRoutingMiddleware, invoiceRoutes);
app.use(`/api/${API_VERSION}/quotes`, authMiddleware, clinicRoutingMiddleware, quoteRoutes);
app.use(`/api/${API_VERSION}/validation`, authMiddleware, clinicRoutingMiddleware, validationRoutes);
// Admin routes use ONLY central database - super_admin should NOT use clinic routing
app.use(`/api/${API_VERSION}/admin`, authMiddleware, adminRoutes);
app.use(`/api/${API_VERSION}/products`, authMiddleware, clinicRoutingMiddleware, productRoutes);
app.use(`/api/${API_VERSION}/categories`, authMiddleware, clinicRoutingMiddleware, categoryRoutes);

// Medical API routes (all use clinic-specific databases)
app.use(`/api/${API_VERSION}/patients`, authMiddleware, clinicRoutingMiddleware, patientRoutes);
app.use(`/api/${API_VERSION}/practitioners`, authMiddleware, clinicRoutingMiddleware, practitionerRoutes);
app.use(`/api/${API_VERSION}/appointments`, authMiddleware, clinicRoutingMiddleware, appointmentRoutes);
app.use(`/api/${API_VERSION}/appointment-items`, authMiddleware, clinicRoutingMiddleware, appointmentItemRoutes);
app.use(`/api/${API_VERSION}/documents`, authMiddleware, clinicRoutingMiddleware, documentRoutes);
app.use(`/api/${API_VERSION}/consents`, authMiddleware, clinicRoutingMiddleware, consentRoutes);
app.use(`/api/${API_VERSION}/consent-templates`, authMiddleware, clinicRoutingMiddleware, consentTemplateRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await closeAllConnections();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await closeAllConnections();
  process.exit(0);
});

// Start server
const startServer = async () => {
  try {
    // Initialize central database connection (manages all clinics)
    await initializeCentralConnection();
    logger.info('✅ Central database initialized');

    // Test database connection (to first clinic)
    await testConnection();

    // Sync database in development
    if (process.env.NODE_ENV === 'development') {
      await syncDatabase();
    }

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Medical Pro API Server started`);
      logger.info(`📍 Port: ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`📝 API Version: ${API_VERSION}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
      logger.info(`🏥 Architecture: Multi-clinic with isolated databases`);

      if (process.env.NODE_ENV === 'development') {
        logger.info(`📖 API Base URL: http://localhost:${PORT}/api/${API_VERSION}`);
      }
    });

    // Handle server errors
    server.on('error', (error) => {
      logger.error('Server error:', error.message);
      process.exit(1);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();

module.exports = app;