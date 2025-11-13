# Backend Region Support for Email Service - Integration Guide

## Overview
This document provides a comprehensive analysis of how the backend handles region/country information and how to integrate it with the email service for localized email templates.

---

## 1. Region Storage and Access

### Primary Source: Company Model
```
Location: /var/www/medical-pro-backend/src/models/Company.js (lines 18-24)

Database Field:
  - Field name: country
  - Type: STRING(2)
  - Valid values: 'FR' (France), 'ES' (Spain)
  - Constraints: NOT NULL, UNIQUE index on email
```

### How to Access Region Data

#### During User Registration/Authentication:
```javascript
// Method 1: From User object (after auth middleware)
const user = await User.findOne({...});
const company = user.company; // Includes country field
console.log(company.country); // 'FR' or 'ES'

// Method 2: From request middleware (available on all routes)
console.log(req.region); // Detected region: 'es' or 'fr'
console.log(req.regionConfig); // Full region configuration
```

---

## 2. Region Detection System

### Active Middleware: Region Detector
```
Location: /var/www/medical-pro-backend/src/utils/regionDetector.js
Status: ACTIVE (enabled in server.js line 98)
Export: regionMiddleware()
```

### Detection Priority (in order):
1. **Subdomain** (e.g., es.medicalpro.com) - Highest Priority
2. **Query Parameter** (?region=es)
3. **User's Country from JWT** (if authenticated)
4. **Default** (falls back to 'es')

### Available on Every Request:
```javascript
req.region         // 'es' or 'fr' (lowercase)
req.regionConfig   // Full configuration object with language, locale, businessRules
```

### Region Configuration Object:
```javascript
{
  code: 'es',
  name: 'España',
  language: 'es',
  locale: 'es-ES',
  currency: 'EUR',
  country: 'ES',
  businessRules: {
    defaultTaxRate: 21,
    taxLabel: 'IVA',
    businessNumberField: 'nif',
    validationRules: {
      nif: true,
      siret: false
    }
  }
}
```

---

## 3. Current Email Service Status

### Email Service Location
```
File: /var/www/medical-pro-backend/src/services/emailService.js
Class: EmailService
Methods:
  - sendVerificationEmail()     [Currently uses hardcoded French]
  - sendVerificationConfirmed() [Currently uses hardcoded French]
  - getVerificationEmailTemplate()
  - getConfirmationEmailTemplate()
```

### Current Template Language
- **Language:** French only (hardcoded)
- **Subjects:** All in French
- **Content:** All in French
- **Region Support:** NONE

### Current Method Signatures
```javascript
// CURRENT (no region support):
async sendVerificationEmail({ 
  email, 
  firstName, 
  companyName, 
  verificationToken, 
  verificationUrl 
})

async sendVerificationConfirmed({ 
  email, 
  firstName, 
  companyName 
})
```

---

## 4. Where Email is Sent in Auth Routes

### Location: `/var/www/medical-pro-backend/src/routes/auth.js`

#### Point 1: User Registration (lines 204-215)
```javascript
// Email sent after company and user creation
await emailService.sendVerificationEmail({
  email: result.user.email,
  firstName: result.user.first_name || 'User',
  companyName: result.company.name,
  verificationToken,
  verificationUrl
});

// AVAILABLE DATA AT THIS POINT:
// - result.company.country ('FR' or 'ES')
// - result.user.company_id
```

#### Point 2: Resend Verification Email (lines 669-676)
```javascript
// Email resent if user didn't receive original
await emailService.sendVerificationEmail({
  email: user.email,
  firstName: user.first_name || 'User',
  companyName: user.company.name,
  verificationToken,
  verificationUrl
});

// AVAILABLE DATA AT THIS POINT:
// - user.company.country ('FR' or 'ES') - loaded via include
// - user relationship includes company
```

#### Point 3: Email Verification Confirmation (lines 577-583)
```javascript
// Email sent after email is verified
const company = await Company.findByPk(user.company_id);
await emailService.sendVerificationConfirmed({
  email: user.email,
  firstName: user.first_name || 'User',
  companyName: company?.name || 'MedicalPro'
});

// AVAILABLE DATA AT THIS POINT:
// - company.country ('FR' or 'ES')
```

---

## 5. Integration Implementation Plan

### Step 1: Update Email Service Method Signatures

**File:** `/var/www/medical-pro-backend/src/services/emailService.js`

Add `region` parameter to both methods:

```javascript
async sendVerificationEmail({ 
  email, 
  firstName, 
  companyName, 
  verificationToken, 
  verificationUrl,
  region = 'es'  // NEW: Add with default fallback
})

async sendVerificationConfirmed({ 
  email, 
  firstName, 
  companyName,
  region = 'es'  // NEW: Add with default fallback
})
```

### Step 2: Update Template Methods

Create region-aware template methods:

```javascript
getVerificationEmailTemplate({ 
  email, 
  firstName, 
  companyName, 
  verificationUrl, 
  verificationToken,
  region = 'es' 
}) {
  // Route to appropriate template based on region
  if (region === 'fr') {
    return this.getVerificationEmailTemplateFR({
      email, 
      firstName, 
      companyName, 
      verificationUrl, 
      verificationToken
    });
  }
  
  // Default to Spanish
  return this.getVerificationEmailTemplateES({
    email, 
    firstName, 
    companyName, 
    verificationUrl, 
    verificationToken
  });
}

getConfirmationEmailTemplate({ 
  firstName, 
  companyName,
  region = 'es'
}) {
  if (region === 'fr') {
    return this.getConfirmationEmailTemplateFR({ firstName, companyName });
  }
  return this.getConfirmationEmailTemplateES({ firstName, companyName });
}
```

### Step 3: Update Auth Routes

Modify email calls to pass region:

**Registration (line 205):**
```javascript
await emailService.sendVerificationEmail({
  email: result.user.email,
  firstName: result.user.first_name || 'User',
  companyName: result.company.name,
  verificationToken,
  verificationUrl,
  region: result.company.country.toLowerCase() // NEW
});
```

**Resend (line 670):**
```javascript
await emailService.sendVerificationEmail({
  email: user.email,
  firstName: user.first_name || 'User',
  companyName: user.company.name,
  verificationToken,
  verificationUrl,
  region: user.company.country.toLowerCase() // NEW
});
```

**Confirmation (line 579):**
```javascript
await emailService.sendVerificationConfirmed({
  email: user.email,
  firstName: user.first_name || 'User',
  companyName: company?.name || 'MedicalPro',
  region: company?.country?.toLowerCase() // NEW
});
```

### Step 4: Create Regional Template Methods

Add separate template methods for Spanish and French:

```javascript
getVerificationEmailTemplateES({ email, firstName, companyName, verificationUrl, verificationToken }) {
  return `
    <!-- Spanish template HTML -->
    <h1>Bienvenido! 👋</h1>
    <p>Verifica tu dirección de correo electrónico para acceder a ${companyName}</p>
    ...
  `;
}

getVerificationEmailTemplateFR({ email, firstName, companyName, verificationUrl, verificationToken }) {
  return `
    <!-- French template HTML (current) -->
    <h1>Bienvenue! 👋</h1>
    <p>Vérifiez votre adresse email pour accéder à ${companyName}</p>
    ...
  `;
}

getConfirmationEmailTemplateES({ firstName, companyName }) {
  return `
    <!-- Spanish confirmation template -->
    <h1>Correo confirmado! ✅</h1>
    ...
  `;
}

getConfirmationEmailTemplateFR({ firstName, companyName }) {
  return `
    <!-- French confirmation template (current) -->
    <h1>Adresse email confirmée! ✅</h1>
    ...
  `;
}
```

---

## 6. Data Flow Diagram

```
User Registration (POST /auth/register)
         |
         v
Validation (country: 'FR' or 'ES' required)
         |
         v
Company Creation (stores country)
         |
         v
User Creation (email_verified = false)
         |
         v
Generate Verification Token
         |
         v
[EMAIL SERVICE CALLED]
  - email
  - firstName
  - companyName
  - verificationToken
  - verificationUrl
  - region: company.country.toLowerCase() [NEW]
         |
         v
Select Template Based on Region
  - If region = 'fr': Use French template
  - If region = 'es': Use Spanish template
         |
         v
Send Email via Nodemailer
         |
         v
Email Received by User (in correct language)
         |
         v
User Verifies Email (POST /auth/verify-email/:token)
         |
         v
Mark email_verified = true
         |
         v
[CONFIRMATION EMAIL SENT]
  - region: company.country.toLowerCase() [NEW]
         |
         v
Select Template Based on Region
         |
         v
Send Confirmation Email (in correct language)
         |
         v
User Can Now Login
```

---

## 7. Testing Strategy

### Test Case 1: Spanish Registration
```
1. POST /api/v1/auth/register with country: 'ES'
2. Verify email sent in Spanish
3. Check subject, header, body are in Spanish
4. Click verification link
5. Verify confirmation email in Spanish
```

### Test Case 2: French Registration
```
1. POST /api/v1/auth/register with country: 'FR'
2. Verify email sent in French
3. Check subject, header, body are in French
4. Click verification link
5. Verify confirmation email in French
```

### Test Case 3: Resend Verification (Spanish)
```
1. User with Spanish company requests resend
2. POST /api/v1/auth/resend-verification-email
3. Verify email sent in Spanish
```

### Test Case 4: Resend Verification (French)
```
1. User with French company requests resend
2. POST /api/v1/auth/resend-verification-email
3. Verify email sent in French
```

---

## 8. Key Files to Modify

| File | Lines | Change | Priority |
|------|-------|--------|----------|
| `/src/services/emailService.js` | 130, 332 | Add `region` parameter to method signatures | HIGH |
| `/src/services/emailService.js` | 221, 376 | Create region-aware template selection | HIGH |
| `/src/services/emailService.js` | NEW | Add Spanish template methods | HIGH |
| `/src/routes/auth.js` | 205, 670, 579 | Pass region to email service calls | HIGH |
| `/src/services/emailService.js` | 90 | Update subject generation for region | MEDIUM |

---

## 9. Implementation Checklist

- [ ] Update `sendVerificationEmail()` signature to include `region` parameter
- [ ] Update `sendVerificationConfirmed()` signature to include `region` parameter
- [ ] Create `getVerificationEmailTemplateFR()` method
- [ ] Create `getVerificationEmailTemplateES()` method
- [ ] Create `getConfirmationEmailTemplateFR()` method
- [ ] Create `getConfirmationEmailTemplateES()` method
- [ ] Create region-aware `getVerificationEmailTemplate()` router method
- [ ] Create region-aware `getConfirmationEmailTemplate()` router method
- [ ] Update registration route to pass region
- [ ] Update resend verification route to pass region
- [ ] Update verification confirmation route to pass region
- [ ] Update `getEmailSubject()` to support region-specific subjects
- [ ] Test Spanish registration and emails
- [ ] Test French registration and emails
- [ ] Test resend verification for both regions
- [ ] Verify confirmation emails for both regions

---

## 10. Region-Specific Email Details

### Spanish (ES)
- **Language:** Spanish (Español)
- **Locale:** es-ES
- **Tax Label:** IVA (21%)
- **Business Number:** NIF

### French (FR)
- **Language:** French (Français)
- **Locale:** fr-FR
- **Tax Label:** TVA (20%)
- **Business Number:** SIRET

---

## Code References

### Region Detector
- File: `/var/www/medical-pro-backend/src/utils/regionDetector.js`
- Functions: `detectRegion()`, `getRegionConfig()`, `regionMiddleware()`
- Usage: Available on all requests via `req.region` and `req.regionConfig`

### Company Model
- File: `/var/www/medical-pro-backend/src/models/Company.js`
- Field: `country` (String 2-char code)
- Defaults: Regional settings set in `beforeCreate` hook

### Auth Routes
- File: `/var/www/medical-pro-backend/src/routes/auth.js`
- Email calls: Lines 205, 670, 579

### Email Service
- File: `/var/www/medical-pro-backend/src/services/emailService.js`
- Methods: `sendVerificationEmail()`, `sendVerificationConfirmed()`
- Templates: `getVerificationEmailTemplate()`, `getConfirmationEmailTemplate()`

