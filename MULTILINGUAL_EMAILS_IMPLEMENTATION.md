# Multilingual Emails Implementation Guide

## Quick Overview

This guide explains how multilingual email support is implemented in the backend and how to maintain/extend it.

## How It Works

### 1. User Registration Flow

```
POST /api/v1/auth/register
    ↓
Validate registration data (including country: 'FR' or 'ES')
    ↓
Create Company with country field
    ↓
Create User
    ↓
Generate JWT verification token
    ↓
Call emailService.sendVerificationEmail({
  ...,
  region: result.company.country || 'FR'
})
    ↓
EmailService routes to language-specific template
    ↓
Send via SMTP (Mailhog in dev, real SMTP in prod)
```

### 2. Email Verification Flow

```
User clicks verification link in email
    ↓
Frontend redirects to /auth/verify-email/{TOKEN}
    ↓
POST /api/v1/auth/verify-email/{TOKEN}
    ↓
Verify JWT token
    ↓
Update user.email_verified = true
    ↓
Call emailService.sendVerificationConfirmed({
  ...,
  region: company.country || 'FR'
})
    ↓
Send confirmation in same language
```

## Key Files

### `/src/services/emailService.js`

**Main Email Service Class**

#### Methods for Verification Emails

```javascript
// Main entry point
async sendVerificationEmail({ email, firstName, companyName, verificationToken, verificationUrl, region = 'FR' })

// Template router - selects language-specific template
getVerificationEmailTemplate(region = 'FR', params)

// French template
getVerificationEmailTemplateFR(params) → returns HTML

// Spanish template
getVerificationEmailTemplateES(params) → returns HTML
```

#### Methods for Confirmation Emails

```javascript
// Main entry point
async sendVerificationConfirmed({ email, firstName, companyName, region = 'FR' })

// Template router - selects language-specific template
getConfirmationEmailTemplate(region = 'FR', params)

// French template
getConfirmationEmailTemplateFR(params) → returns HTML

// Spanish template
getConfirmationEmailTemplateES(params) → returns HTML
```

### `/src/routes/auth.js`

**Authentication Routes**

Three places where region is passed to emailService:

1. **Registration** (line ~205)
   ```javascript
   await emailService.sendVerificationEmail({
     // ... other params
     region: result.company.country || 'FR'
   });
   ```

2. **Verification Callback** (line ~580)
   ```javascript
   await emailService.sendVerificationConfirmed({
     // ... other params
     region: company?.country || 'FR'
   });
   ```

3. **Resend Verification** (line ~672)
   ```javascript
   await emailService.sendVerificationEmail({
     // ... other params
     region: user.company.country || 'FR'
   });
   ```

## Environment Configuration

Required for email sending:

```env
# SMTP Configuration
SMTP_HOST=localhost          # For dev: localhost (Mailhog)
SMTP_PORT=1025               # For dev: 1025 (Mailhog)
SMTP_USER=                   # Not needed for Mailhog
SMTP_PASSWORD=               # Not needed for Mailhog

# Test Mode (optional)
TEST_MODE_EMAIL=true         # Redirect all emails to TEST_EMAIL_ADDRESS
TEST_EMAIL_ADDRESS=dev@medicalpro.test

# Email From Address
FROM_EMAIL=noreply@medicalpro.com

# Frontend URL for verification links
APP_URL=http://localhost:3000
```

## Testing

### Manual Testing with cURL

**French Registration:**
```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Cabinet Médical",
    "country": "FR",
    "businessNumber": "12345678901234",
    "vatNumber": "FR12345678901",
    "companyEmail": "clinic@example.fr",
    "companyPhone": "+33123456789",
    "email": "user@example.fr",
    "password": "TestPass123",
    "firstName": "Jean",
    "lastName": "Dupont",
    "address": {},
    "acceptTerms": true
  }'
```

**Check Mailhog:**
```bash
# List all emails
curl http://localhost:8025/api/v2/messages | jq '.items[].Content.Headers.Subject'

# Get specific email
curl http://localhost:8025/api/v2/messages | jq '.items[0]'
```

## Adding a New Language

### Step 1: Update Company Model

In `/src/models/Company.js`, update country validation:

```javascript
country: {
  type: DataTypes.STRING(2),
  allowNull: false,
  validate: {
    isIn: [['FR', 'ES', 'DE']]  // Add 'DE' for German
  }
}
```

### Step 2: Add Email Templates

In `/src/services/emailService.js`:

```javascript
// Add verification template
getVerificationEmailTemplateDE({ email, firstName, companyName, verificationUrl, verificationToken }) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <!-- German email template HTML -->
      </head>
      <body>
        <!-- German content -->
      </body>
    </html>
  `;
}

// Add confirmation template
getConfirmationEmailTemplateDE({ firstName, companyName }) {
  return `
    <!DOCTYPE html>
    <html>
      <!-- German confirmation template -->
    </html>
  `;
}
```

### Step 3: Update Template Routers

In `/src/services/emailService.js`:

```javascript
getVerificationEmailTemplate(region = 'FR', params) {
  region = region.toUpperCase();
  if (region === 'ES') {
    return this.getVerificationEmailTemplateES(params);
  }
  if (region === 'DE') {
    return this.getVerificationEmailTemplateDE(params);  // Add this
  }
  return this.getVerificationEmailTemplateFR(params);
}

getConfirmationEmailTemplate(region = 'FR', params) {
  region = region.toUpperCase();
  if (region === 'ES') {
    return this.getConfirmationEmailTemplateES(params);
  }
  if (region === 'DE') {
    return this.getConfirmationEmailTemplateDE(params);  // Add this
  }
  return this.getConfirmationEmailTemplateFR(params);
}
```

### Step 4: Test

```bash
# Register with new country code
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Klinik Deutschland",
    "country": "DE",
    ...
  }'

# Verify email contains German content
curl http://localhost:8025/api/v2/messages | jq '.items[0].Content.Body'
```

## Debugging

### Check Email Logs

The emailService logs all attempts:

```
[EmailService] Attempting to send verification email
[EmailService] Email sent successfully
✅ Verification email sent to user@example.com
```

### Check Region Parameter

Add debug logging in auth.js:

```javascript
console.log('[Auth] Sending email with region:', result.company.country);
```

### Verify Template Selection

Add logging in emailService:

```javascript
const template = this.getVerificationEmailTemplate(region, params);
console.log('[EmailService] Selected template for region:', region);
```

### Email Content Issues

1. Check HTML in Mailhog web UI: http://localhost:8025
2. Look for encoding issues (UTF-8)
3. Verify special characters (accents, emojis) render correctly
4. Test with different email clients

## Common Issues

### Issue: Wrong Language Email Sent

**Cause:** Region not passed from auth.js to emailService

**Solution:** Check the email sending calls include `region: company.country || 'FR'`

### Issue: Email Not Sent

**Cause:** SMTP configuration missing or Mailhog not running

**Solution:**
```bash
# Check Mailhog is running
curl http://localhost:8025
# Should return HTML page

# Check SMTP connection in logs
# Should see [EmailService] Config: {...}
```

### Issue: Verification Link Broken

**Cause:** APP_URL not set correctly

**Solution:** Update .env
```
APP_URL=http://localhost:3000
```

## Performance Considerations

- Email sending is async and doesn't block registration
- Template selection is a simple string comparison (O(1))
- No database queries in email service
- Emails are queued by SMTP server

## Security Notes

- Tokens are JWT with 24-hour expiration
- Test mode redirects emails but logs original recipient
- Email addresses are never exposed in response body
- Verification prevents duplicate confirmation emails

## Testing Checklist

- [ ] FR user registration sends French email
- [ ] ES user registration sends Spanish email (if validated data works)
- [ ] Email contains correct language text
- [ ] Button text is in correct language
- [ ] Verification link works
- [ ] Confirmation email sent after verification
- [ ] Test mode redirects to configured email
- [ ] Test mode shows original recipient in email body
