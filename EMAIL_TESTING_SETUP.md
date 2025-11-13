# Email Testing Configuration - MedicalPro

## Overview

Le système d'email de MedicalPro est complètement configuré avec un **mode test** qui redirige tous les emails vers une adresse unique de test tout en gardant trace de l'email original.

## Configuration

### Variables d'Environnement (.env)

```env
# SMTP Configuration (Mailhog for development)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
FROM_EMAIL=noreply@medicalpro.local

# Email Test Mode
TEST_MODE_EMAIL=true                          # Enable test mode
TEST_EMAIL_ADDRESS=dev@medicalpro.test       # All emails go here
```

### Services Running

```bash
# Mailhog - Capture all SMTP emails
# Web UI: http://localhost:8025
# SMTP:  localhost:1025

# Backend - Medical Pro API
# API: http://localhost:3001/api/v1
```

## How It Works

### Test Mode Features

When `TEST_MODE_EMAIL=true`:

1. **Email Redirection**: All emails are sent to `TEST_EMAIL_ADDRESS` instead of the original recipient
2. **Subject Prefix**: Each email type is prefixed for easy identification:
   - `[TEST - VERIFICATION]` - Email verification emails
   - `[TEST - CONFIRMATION]` - Confirmation emails
3. **Original Email Info**: A yellow info box is added to the email showing:
   - The original recipient email
   - A note that in production, this would be sent to the real recipient

### Email Types

#### 1. Verification Email
- **Sent when**: User registers a new account
- **Original recipient**: User's email address
- **Test recipient**: `dev@medicalpro.test`
- **Subject prefix**: `[TEST - VERIFICATION]`
- **Contains**:
  - Verification link with JWT token
  - 24-hour expiration notice
  - Original recipient info box

#### 2. Confirmation Email
- **Sent when**: User successfully verifies their email
- **Original recipient**: User's email address
- **Test recipient**: `dev@medicalpro.test`
- **Subject prefix**: `[TEST - CONFIRMATION]`
- **Contains**:
  - Success message
  - Next steps instructions
  - Original recipient info box

## Testing Workflow

### Step 1: Verify Services are Running

```bash
# Check Backend
curl http://localhost:3001/health

# Check Mailhog
curl http://localhost:8025
```

### Step 2: Register a New User

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Clinic",
    "country": "FR",
    "companyEmail": "clinic@test.fr",
    "companyPhone": "+33612345678",
    "email": "user@test.com",
    "password": "TestPassword123",
    "firstName": "John",
    "lastName": "Doe",
    "acceptTerms": true
  }'
```

**Response** will include:
- User ID
- Verification token
- Message: "Please verify your email..."

### Step 3: Check Mailhog for Verification Email

**Open**: http://localhost:8025

**You will see**:
- Email from: `noreply@medicalpro.local`
- Email to: `dev@medicalpro.test` (test mode redirect)
- Subject: `[TEST - VERIFICATION] Vérifiez votre adresse email - Test Clinic`
- Body contains:
  - 🧪 Yellow info box showing original email: `user@test.com`
  - Verification button with link
  - Token embedded in the link

### Step 4: Verify Email

Extract the token from the verification URL and call:

```bash
curl -X POST "http://localhost:3001/api/v1/auth/verify-email/{TOKEN}" \
  -H "Content-Type: application/json"
```

### Step 5: Check Mailhog for Confirmation Email

**You will see**:
- Email to: `dev@medicalpro.test` (test mode redirect)
- Subject: `[TEST - CONFIRMATION] Adresse email confirmée - Test Clinic`
- Body contains:
  - ✨ Success message
  - Original email info: `user@test.com`
  - Next steps

## Distinguishing Different Workflows

In the test inbox (`dev@medicalpro.test`), you can identify different workflows by:

1. **Subject Prefix**:
   - `[TEST - VERIFICATION]` = signup flow
   - `[TEST - CONFIRMATION]` = after email verification
   - Add more types as needed (password reset, etc.)

2. **Company Name** (in subject):
   - Changes for each registration
   - Example: `...- Dr. Martin's Clinic`

3. **Original Email** (in yellow box):
   - Shows which user this email was originally for
   - Useful for debugging multi-user scenarios

## Production Setup

### To Use Real Email Provider (SendGrid, AWS SES, Mailtrap, etc.):

1. **Disable test mode**:
   ```env
   TEST_MODE_EMAIL=false
   ```

2. **Configure SMTP**:
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASSWORD=SG.xxxxxxxxxxxx
   FROM_EMAIL=noreply@yourdomain.com
   ```

3. **Remove yellow info box** (optional):
   - The `wrapEmailContentWithTestInfo()` function will automatically skip wrapping
   - Yellow box only appears when `TEST_MODE_EMAIL=true`

## Backend Email Service

### Key Files

- **Service**: `/src/services/emailService.js`
- **Routes**: `/src/routes/auth.js` (where emails are sent)
- **Templates**: Embedded in `emailService.js`

### Email Service Methods

```javascript
// Send verification email
emailService.sendVerificationEmail({
  email: 'user@example.com',
  firstName: 'John',
  companyName: 'Test Clinic',
  verificationToken: 'jwt-token-here',
  verificationUrl: 'http://localhost:3000/verify-email/jwt-token-here'
})

// Send confirmation email
emailService.sendVerificationConfirmed({
  email: 'user@example.com',
  firstName: 'John',
  companyName: 'Test Clinic'
})
```

### Helper Methods (Test Mode)

```javascript
// Determine recipient (test or real)
emailService.getRecipientEmail(originalEmail)
// Returns: dev@medicalpro.test (if test mode) OR originalEmail (if production)

// Get subject with prefix
emailService.getEmailSubject('Verify your email', 'VERIFICATION')
// Returns: [TEST - VERIFICATION] Verify your email (if test mode)

// Wrap content with test info box
emailService.wrapEmailContentWithTestInfo(htmlContent, originalEmail)
// Adds yellow box showing original recipient
```

## Troubleshooting

### Emails Not Appearing in Mailhog?

1. **Check backend logs**:
   ```bash
   tail -50 /tmp/backend.log | grep -i email
   ```

2. **Verify Mailhog is running**:
   ```bash
   curl http://localhost:8025
   ```

3. **Check SMTP configuration**:
   ```bash
   echo $SMTP_HOST $SMTP_PORT
   ```

### Wrong Email Recipient?

- Check `TEST_MODE_EMAIL` environment variable
- Verify `TEST_EMAIL_ADDRESS` is set correctly
- Check backend logs for "TEST MODE ENABLED" message

### Missing Info Box?

- Make sure `TEST_MODE_EMAIL=true`
- Check that the service was restarted after changing `.env`

## Logs

### Backend Logs
```bash
tail -f /tmp/backend.log | grep -i email
```

**Look for**:
- `[EmailService] Attempting to send verification email:`
- `TEST MODE ENABLED - All emails will be sent to:`
- `✅ Verification email sent to`

### Mailhog API
```bash
# List all messages
curl http://localhost:8025/api/v1/messages

# Get specific message (by ID)
curl http://localhost:8025/api/v1/messages/{ID}

# Delete all messages
curl -X DELETE http://localhost:8025/api/v1/messages
```

## Example: Complete Test Flow

```bash
#!/bin/bash

# 1. Register user
echo "Registering user..."
RESPONSE=$(curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Clinic",
    "country": "FR",
    "companyEmail": "clinic@test.fr",
    "companyPhone": "+33612345678",
    "email": "demo@test.com",
    "password": "DemoPassword123",
    "firstName": "Demo",
    "lastName": "User",
    "acceptTerms": true
  }')

# 2. Extract verification token
TOKEN=$(echo "$RESPONSE" | jq -r '.data.user.email_verification_token')
echo "Verification token: $TOKEN"

# 3. Wait a moment for email to be sent
sleep 2

# 4. Check Mailhog
echo "Checking Mailhog for emails..."
curl -s http://localhost:8025/api/v1/messages | jq '.[] | {
  from: .From.Mailbox,
  to: .To[0].Mailbox,
  subject: .Content.Headers.Subject[0]
}'

# 5. Verify email
echo "Verifying email..."
curl -s -X POST "http://localhost:3001/api/v1/auth/verify-email/$TOKEN" \
  -H "Content-Type: application/json" | jq '.data.user | {email, email_verified}'

# 6. Check for confirmation email
sleep 1
echo "Checking for confirmation email..."
curl -s http://localhost:8025/api/v1/messages | jq '.[] | {
  to: .To[0].Mailbox,
  subject: .Content.Headers.Subject[0]
}' | tail -2
```

## Future Enhancements

1. **Add more email types**:
   - Password reset
   - Account locked
   - Welcome email
   - Newsletter

2. **Email queue system**:
   - Queue emails if SMTP is down
   - Retry logic
   - Track delivery status

3. **Email templates**:
   - Database-driven templates
   - User-customizable content
   - Multi-language support

4. **Webhook notifications**:
   - Notify frontend when email is sent
   - Track email opens
   - Handle bounces

---

**Last Updated**: November 12, 2025
**Status**: ✅ Fully Operational
