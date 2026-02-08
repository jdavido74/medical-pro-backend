/**
 * TOTP (Time-based One-Time Password) Service
 *
 * Handles 2FA authentication using TOTP algorithm compatible with:
 * - Google Authenticator
 * - Authy
 * - Microsoft Authenticator
 * - Any TOTP-compatible app
 */

const crypto = require('crypto');

// TOTP Configuration
const TOTP_CONFIG = {
  issuer: 'MediMaestro Admin',
  algorithm: 'SHA1',
  digits: 6,
  period: 30, // seconds
  window: 1   // Allow 1 period before/after for clock drift
};

/**
 * Generate a random base32 secret
 */
function generateSecret(length = 20) {
  const buffer = crypto.randomBytes(length);
  return base32Encode(buffer);
}

/**
 * Base32 encoding (RFC 4648)
 */
function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Base32 decoding
 */
function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = encoded.replace(/=+$/, '').toUpperCase();

  let bits = 0;
  let value = 0;
  const output = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const idx = alphabet.indexOf(cleanInput[i]);
    if (idx === -1) continue;

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Generate TOTP code for a given secret and time
 */
function generateTOTP(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / TOTP_CONFIG.period);
  const counterBuffer = Buffer.alloc(8);

  // Write counter as big-endian 64-bit integer
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const secretBuffer = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const code = (
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  ) % Math.pow(10, TOTP_CONFIG.digits);

  return code.toString().padStart(TOTP_CONFIG.digits, '0');
}

/**
 * Verify a TOTP code against a secret
 */
function verifyTOTP(secret, token, window = TOTP_CONFIG.window) {
  const now = Date.now();
  const tokenStr = token.toString().padStart(TOTP_CONFIG.digits, '0');

  // Check current and adjacent time windows for clock drift
  for (let i = -window; i <= window; i++) {
    const time = now + (i * TOTP_CONFIG.period * 1000);
    const expectedToken = generateTOTP(secret, time);

    if (crypto.timingSafeEqual(Buffer.from(tokenStr), Buffer.from(expectedToken))) {
      return true;
    }
  }

  return false;
}

/**
 * Generate otpauth:// URI for QR code
 */
function generateOTPAuthURI(secret, email) {
  const issuer = encodeURIComponent(TOTP_CONFIG.issuer);
  const account = encodeURIComponent(email);

  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=${TOTP_CONFIG.algorithm}&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
}

/**
 * Generate backup codes for account recovery
 */
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a backup code for storage
 */
function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

/**
 * Verify a backup code against hashed codes
 */
function verifyBackupCode(code, hashedCodes) {
  const hashedInput = hashBackupCode(code);
  const index = hashedCodes.findIndex(hashed =>
    crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(hashedInput))
  );
  return index;
}

/**
 * Encrypt TOTP secret for database storage
 */
function encryptSecret(secret, encryptionKey) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt TOTP secret from database
 */
function decryptSecret(encryptedData, encryptionKey) {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateOTPAuthURI,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  encryptSecret,
  decryptSecret,
  TOTP_CONFIG
};
