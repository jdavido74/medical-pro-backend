require('dotenv').config();

// Validate required environment variables BEFORE anything else
const { validateRequiredEnvVars } = require('./src/config/validateEnv');
validateRequiredEnvVars();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
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
const tagRoutes = require('./src/routes/tags');
const supplierRoutes = require('./src/routes/suppliers');

// Medical routes
const patientRoutes = require('./src/routes/patients');
const practitionerRoutes = require('./src/routes/practitioners');
const appointmentRoutes = require('./src/routes/appointments');
const appointmentItemRoutes = require('./src/routes/appointment-items');
const documentRoutes = require('./src/routes/documents');
const consentRoutes = require('./src/routes/consents');
const consentTemplateRoutes = require('./src/routes/consent-templates');
const medicalRecordsRoutes = require('./src/routes/medical-records');
const prescriptionsRoutes = require('./src/routes/prescriptions');
const medicationsRoutes = require('./src/routes/medications');
const consentSigningRoutes = require('./src/routes/consent-signing');

// Public routes (no authentication)
const publicConsentSigningRoutes = require('./src/routes/public-consent-signing');

// Clinic configuration routes
const healthcareProvidersRoutes = require('./src/routes/healthcareProviders');
const clinicSettingsRoutes = require('./src/routes/clinicSettings');
const clinicRolesRoutes = require('./src/routes/clinicRoles');
const clinicSetupRoutes = require('./src/routes/clinicSetup');
const facilitiesRoutes = require('./src/routes/facilities');
const profileRoutes = require('./src/routes/profile');
const practitionerAvailabilityRoutes = require('./src/routes/practitionerAvailability');
const patientCareTeamRoutes = require('./src/routes/patientCareTeam');
const teamsRoutes = require('./src/routes/teams');
const machineRoutes = require('./src/routes/machines');
const planningRoutes = require('./src/routes/planning');
const appointmentActionsRoutes = require('./src/routes/appointment-actions');
const treatmentConsentsRoutes = require('./src/routes/treatment-consents');
const systemCategoriesRoutes = require('./src/routes/system-categories');
const publicAppointmentRoutes = require('./src/routes/public-appointment');

// User management routes (central database)
const usersRoutes = require('./src/routes/users');
const auditRoutes = require('./src/routes/audit');
const totpRoutes = require('./src/routes/totp');

// Import middleware
const errorHandler = require('./src/middleware/errorHandler');
const { authMiddleware } = require('./src/middleware/auth');
const { clinicStatusMiddleware } = require('./src/middleware/clinicStatus');
const { clinicRoutingMiddleware } = require('./src/middleware/clinicRouting');
const { regionMiddleware } = require('./src/utils/regionDetector');
const sanitizeMiddleware = require('./src/middleware/sanitize');

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
  // Skip rate limiting for localhost in development
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';

  if (isDevelopment && isLocalhost) {
    return next();
  }

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
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      connectSrc: ["'none'"],
      fontSrc: ["'none'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: []
    }
  }
}));

// Cookie parser (for httpOnly refresh token cookies)
app.use(cookieParser());

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

// Strip HTML tags from all incoming string values (XSS defence-in-depth)
app.use(sanitizeMiddleware);

// Region detection middleware (detects country from sub-domain)
app.use(regionMiddleware());

// Serve static files from uploads directory with CORS headers
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d',
  etag: true
}));

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

// Public routes (no authentication required)
// Consent signing page for patients (accessed via email link)
app.use(`/api/${API_VERSION}/public/sign`, publicConsentSigningRoutes);
// Public appointment confirmation (accessed via email link)
app.use(`/api/${API_VERSION}/public`, clinicRoutingMiddleware, publicAppointmentRoutes);

// API routes
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/auth/2fa`, totpRoutes);

// Apply clinic routing middleware to all clinic-specific routes
// Middleware chain: auth -> clinicRouting (provides req.clinicDb)
// NOTE: clinicStatusMiddleware TEMPORARILY DISABLED for debugging
app.use(`/api/${API_VERSION}/clients`, authMiddleware, clinicRoutingMiddleware, clientRoutes);
app.use(`/api/${API_VERSION}/invoices`, authMiddleware, clinicRoutingMiddleware, invoiceRoutes);
app.use(`/api/${API_VERSION}/quotes`, authMiddleware, clinicRoutingMiddleware, quoteRoutes);
app.use(`/api/${API_VERSION}/validation`, authMiddleware, clinicRoutingMiddleware, validationRoutes);
// Admin routes use ONLY central database - super_admin should NOT use clinic routing
app.use(`/api/${API_VERSION}/admin`, authMiddleware, adminRoutes);
// User and audit routes use central database (company-scoped)
app.use(`/api/${API_VERSION}/users`, usersRoutes);
app.use(`/api/${API_VERSION}/audit`, auditRoutes);
app.use(`/api/${API_VERSION}/products`, authMiddleware, clinicRoutingMiddleware, productRoutes);
app.use(`/api/${API_VERSION}/categories`, authMiddleware, clinicRoutingMiddleware, categoryRoutes);
app.use(`/api/${API_VERSION}/tags`, authMiddleware, clinicRoutingMiddleware, tagRoutes);
app.use(`/api/${API_VERSION}/suppliers`, authMiddleware, clinicRoutingMiddleware, supplierRoutes);

// Medical API routes (all use clinic-specific databases)
app.use(`/api/${API_VERSION}/patients`, authMiddleware, clinicRoutingMiddleware, patientRoutes);
app.use(`/api/${API_VERSION}/practitioners`, authMiddleware, clinicRoutingMiddleware, practitionerRoutes);
app.use(`/api/${API_VERSION}/appointments`, authMiddleware, clinicRoutingMiddleware, appointmentRoutes);
app.use(`/api/${API_VERSION}/appointment-items`, authMiddleware, clinicRoutingMiddleware, appointmentItemRoutes);
app.use(`/api/${API_VERSION}/documents`, authMiddleware, clinicRoutingMiddleware, documentRoutes);
app.use(`/api/${API_VERSION}/consents`, authMiddleware, clinicRoutingMiddleware, consentRoutes);
app.use(`/api/${API_VERSION}/consent-templates`, authMiddleware, clinicRoutingMiddleware, consentTemplateRoutes);
app.use(`/api/${API_VERSION}/medical-records`, authMiddleware, clinicRoutingMiddleware, medicalRecordsRoutes);
app.use(`/api/${API_VERSION}/prescriptions`, authMiddleware, clinicRoutingMiddleware, prescriptionsRoutes);
app.use(`/api/${API_VERSION}/medications`, authMiddleware, clinicRoutingMiddleware, medicationsRoutes);
app.use(`/api/${API_VERSION}/consent-signing`, authMiddleware, clinicRoutingMiddleware, consentSigningRoutes);

// Clinic configuration API routes (all use clinic-specific databases)
app.use(`/api/${API_VERSION}/healthcare-providers`, healthcareProvidersRoutes);
app.use(`/api/${API_VERSION}/clinic-settings`, clinicSettingsRoutes);
app.use(`/api/${API_VERSION}/clinic-roles`, clinicRolesRoutes);
app.use(`/api/${API_VERSION}/clinic`, clinicSetupRoutes); // Onboarding setup routes
app.use(`/api/${API_VERSION}/facilities`, facilitiesRoutes);
app.use(`/api/${API_VERSION}/profile`, profileRoutes);
app.use(`/api/${API_VERSION}/availability`, practitionerAvailabilityRoutes);
app.use(`/api/${API_VERSION}/care-team`, authMiddleware, clinicRoutingMiddleware, patientCareTeamRoutes);
app.use(`/api/${API_VERSION}/teams`, teamsRoutes);
app.use(`/api/${API_VERSION}/machines`, authMiddleware, clinicRoutingMiddleware, machineRoutes);
app.use(`/api/${API_VERSION}/planning`, authMiddleware, clinicRoutingMiddleware, planningRoutes);
// Appointment actions (state machine) routes - mounted under /planning for consistency
app.use(`/api/${API_VERSION}/planning`, authMiddleware, clinicRoutingMiddleware, appointmentActionsRoutes);
// Treatment consent associations
app.use(`/api/${API_VERSION}/treatment-consents`, authMiddleware, clinicRoutingMiddleware, treatmentConsentsRoutes);
// System categories (consent types, appointment types, specialties, departments)
app.use(`/api/${API_VERSION}/system-categories`, authMiddleware, clinicRoutingMiddleware, systemCategoriesRoutes);

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

    // Test database connection (to central database)
    await testConnection();

    // NOTE: Database sync is disabled because:
    // 1. Central DB tables are created via migrations
    // 2. Clinic DB tables are created via provisioning service
    // 3. Sync would try to create clinic models in central DB (incorrect)
    // if (process.env.NODE_ENV === 'development') {
    //   await syncDatabase();
    // }

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