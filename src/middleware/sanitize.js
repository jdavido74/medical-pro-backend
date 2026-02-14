/**
 * HTML Sanitization Middleware
 *
 * Strips HTML tags from all string values in request body and query params.
 * Defence-in-depth against stored XSS: even if the frontend doesn't sanitize,
 * the server strips HTML before it reaches validation or database.
 *
 * Fields that legitimately contain HTML (rich text editors, templates) are
 * whitelisted and left untouched.
 */

// Fields that may contain intentional HTML (rich text editors, consent templates)
const HTML_ALLOWED_FIELDS = new Set([
  'terms',             // Consent terms (rich text from editor)
  'content',           // Generic rich text content
  'html_content',      // Explicit HTML content
  'template_content',  // Template HTML
  'template_body',     // Template body HTML
  'signature',         // Digital signatures (data URIs / SVG)
]);

/**
 * Strip HTML tags from a string value.
 * "<script>alert(1)</script>" → "alert(1)"
 */
function stripHtml(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/<[^>]*>/g, '');
}

/**
 * Recursively sanitize an object, stripping HTML from all string values
 * except those in whitelisted fields.
 */
function sanitizeValue(obj, key) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return stripHtml(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeValue(item, key));
  }

  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (HTML_ALLOWED_FIELDS.has(k)) {
        result[k] = v; // Preserve HTML in whitelisted fields
      } else {
        result[k] = sanitizeValue(v, k);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Express middleware: sanitize req.body and req.query before routing.
 */
function sanitizeMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        req.query[key] = stripHtml(value);
      }
    }
  }

  next();
}

module.exports = sanitizeMiddleware;
