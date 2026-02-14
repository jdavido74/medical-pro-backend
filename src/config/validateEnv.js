/**
 * Environment Variable Validation
 *
 * This module validates that all required environment variables are set
 * before the application starts. This prevents the app from running
 * with insecure fallback values.
 *
 * Must be called BEFORE any other module that uses these variables.
 */

const REQUIRED_ENV_VARS = [
  { name: 'JWT_SECRET', description: 'JWT signing secret (min 32 chars recommended)' },
  { name: 'JWT_REFRESH_SECRET', description: 'JWT refresh token signing secret' },
  { name: 'DB_PASSWORD', description: 'PostgreSQL database password' },
];

const RECOMMENDED_ENV_VARS = [
  { name: 'TOTP_ENCRYPTION_KEY', description: 'Separate encryption key for TOTP secrets (should differ from JWT_SECRET)' },
];

function validateRequiredEnvVars() {
  const missing = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar.name] || process.env[envVar.name].trim() === '') {
      missing.push(`  - ${envVar.name}: ${envVar.description}`);
    }
  }

  if (missing.length > 0) {
    console.error('\n========================================');
    console.error('FATAL: Missing required environment variables:');
    console.error(missing.join('\n'));
    console.error('');
    console.error('The application cannot start without these variables.');
    console.error('Set them in your .env file or environment.');
    console.error('========================================\n');
    process.exit(1);
  }

  // Warn about recommended vars
  for (const envVar of RECOMMENDED_ENV_VARS) {
    if (!process.env[envVar.name] || process.env[envVar.name].trim() === '') {
      console.warn(`WARNING: ${envVar.name} is not set. ${envVar.description}`);
    }
  }

  // Warn if TOTP_ENCRYPTION_KEY equals JWT_SECRET
  if (process.env.TOTP_ENCRYPTION_KEY && process.env.TOTP_ENCRYPTION_KEY === process.env.JWT_SECRET) {
    console.warn('WARNING: TOTP_ENCRYPTION_KEY should be different from JWT_SECRET for better security isolation.');
  }
}

module.exports = { validateRequiredEnvVars };
