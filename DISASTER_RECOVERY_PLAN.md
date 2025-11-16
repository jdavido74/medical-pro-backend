# Disaster Recovery & Emergency Access Plan

**Date Created:** November 15, 2025
**Last Updated:** November 15, 2025
**Status:** ACTIVE
**Severity:** CRITICAL

---

## Executive Summary

This document defines the **emergency access procedures** if the primary super_admin account is compromised or inaccessible. The system has **3 layers of protection**:

1. ✅ **Primary Admin** - Main super_admin account
2. ✅ **Recovery Admin** - Secondary backup super_admin
3. ✅ **Direct Database Access** - System-level emergency bypass

---

## Accounts in System

### Primary Super Admin

```
Email:              admin@example.com
Password:           SuperAdmin123
Role:               super_admin
Email Verified:     true
Status:             PRIMARY - PRIMARY ACCOUNT
```

### Recovery Super Admin (BACKUP)

```
Email:              recovery-admin@example.com
Password:           SuperAdmin123
Role:               super_admin
Email Verified:     true
Status:             SECONDARY - EMERGENCY ONLY
```

**⚠️ CRITICAL**: Keep recovery-admin password in **secure vault** (1Password, Bitwarden, etc.)
**⚠️ CRITICAL**: Never use recovery-admin for daily operations
**⚠️ CRITICAL**: Change password immediately after any emergency use

---

## Scenario 1: Primary Admin Compromised

**Situation:** admin@example.com password leaked or account compromised

### Step 1: Verify Compromise (Detection)

```bash
# Check recent login activity
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT
  email,
  last_login,
  created_at,
  role
FROM users
WHERE role = 'super_admin'
ORDER BY last_login DESC;
"

# Check audit logs for suspicious actions
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT
  user_id,
  action,
  entity_type,
  entity_id,
  created_at
FROM audit_logs
WHERE action LIKE '%user%' OR action LIKE '%admin%'
ORDER BY created_at DESC
LIMIT 20;
"
```

### Step 2: Immediate Action - USE RECOVERY ACCOUNT

```bash
# Test recovery account access
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "recovery-admin@example.com",
    "password": "SuperAdmin123"
  }'

# Expected response:
# {
#   "success": true,
#   "data": {
#     "tokens": { "accessToken": "..." }
#   }
# }
```

### Step 3: Reset Primary Admin Password

**Option A: Via Recovery Account (Through UI)**

1. Login to SaaS Admin with recovery-admin@example.com
2. Navigate to user management
3. Reset admin@example.com password
4. Notify admin of new password

**Option B: Direct Database Reset**

```bash
# Generate new password hash
PASSWORD="NewSecurePassword123"
HASH=$(node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$PASSWORD', 12))")

# Update in database
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central << EOF
UPDATE users
SET password_hash = '$HASH',
    last_login = NULL,
    email_verified = true
WHERE email = 'admin@example.com';

-- Log the recovery action
INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, created_at)
VALUES (
  gen_random_uuid(),
  NULL,
  'EMERGENCY_PASSWORD_RESET',
  'super_admin',
  '550e8400-e29b-41d4-a716-446655440099',
  NOW()
);

SELECT 'PRIMARY ADMIN PASSWORD RESET' as status;
EOF
```

### Step 4: Security Audit

```bash
# Log all changes made
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT * FROM audit_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
"

# Check for unauthorized user creation
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT * FROM users
WHERE created_at > NOW() - INTERVAL '24 hours'
AND role NOT IN ('user', 'readonly');
"
```

### Step 5: Deactivate Compromised Access

```bash
# Invalidate all recovery account tokens (forces re-login)
# Note: Implement token invalidation endpoint if needed

# Or simply change recovery account password
NEW_RECOVERY_HASH=$(node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('NewRecoveryPass456', 12))")

PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central << EOF
UPDATE users
SET password_hash = '$NEW_RECOVERY_HASH'
WHERE email = 'recovery-admin@example.com';
EOF
```

---

## Scenario 2: Both Accounts Compromised

**Situation:** Both admin@example.com AND recovery-admin@example.com compromised

### Step 1: Direct Database Access

You must have **SSH/system access** to the server:

```bash
# SSH to server
ssh root@your-server.com

# Connect directly to PostgreSQL
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central

# Verify you're in the database
\du  # List users
\l   # List databases

# Reset ALL super_admin accounts
UPDATE users
SET password_hash = '$2a$12$Gn3.PB/O4Guefn3Rn7RWhuwDVY0Op3l7T6Vof.lKkgBR4FBYf6L.a'
WHERE role = 'super_admin';

# Verify
SELECT email, role FROM users WHERE role = 'super_admin';

# Exit
\q
```

### Step 2: Create New Recovery Account

```bash
# If recovery account is compromised, create a new one
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central << EOF
INSERT INTO users (
  id, company_id, email, password_hash, first_name, last_name, role, email_verified, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000',
  'emergency-backup-admin@example.com',
  '$2a$12$Gn3.PB/O4Guefn3Rn7RWhuwDVY0Op3l7T6Vof.lKkgBR4FBYf6L.a',
  'Emergency',
  'Backup',
  'super_admin',
  true,
  NOW(),
  NOW()
);

SELECT 'New backup admin created' as status;
EOF
```

---

## Scenario 3: Database File Corruption

**Situation:** PostgreSQL database is corrupted or attacked

### Restore from Backup

```bash
# 1. Stop the application
systemctl stop medical-pro-backend
systemctl stop medical-pro

# 2. List available backups
ls -lh /var/backups/postgresql/

# 3. Restore from latest backup
pg_restore -h localhost -U postgres -d medicalpro_central -v \
  /var/backups/postgresql/medicalpro_central_backup_latest.sql

# 4. Verify restoration
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c \
  "SELECT COUNT(*) as user_count FROM users;"

# 5. Restart application
systemctl start medical-pro-backend
systemctl start medical-pro
```

---

## Emergency Access Procedures

### Quick Reference Card

```
╔═══════════════════════════════════════════════════════════════╗
║          EMERGENCY ACCESS - QUICK REFERENCE                  ║
╚═══════════════════════════════════════════════════════════════╝

SCENARIO 1: Primary Admin Compromised
└─ USE: recovery-admin@example.com / SuperAdmin123
└─ ACTION: Reset primary admin password
└─ TIME: 5 minutes

SCENARIO 2: Both Admins Compromised
└─ REQUIREMENT: SSH access to server
└─ ACTION: Direct database password reset
└─ TIME: 2 minutes

SCENARIO 3: Database Corrupted
└─ REQUIREMENT: SSH access + backups available
└─ ACTION: Restore from backup
└─ TIME: 15-30 minutes
```

### System Access Requirements

| Scenario | SSH | DB Access | API Access | Required |
|----------|-----|-----------|------------|----------|
| Primary compromised | ❌ | ❌ | ✅ | Application only |
| Both compromised | ✅ | ✅ | ❌ | System access |
| DB corrupted | ✅ | ✅ | ❌ | System + backups |

---

## Prevention Measures

### 1. Password Management

```bash
# Change recovery account password QUARTERLY
# Store in secure vault (1Password, Bitwarden, LastPass, AWS Secrets Manager)
# NEVER commit to Git
# NEVER share via email or chat
# ONLY share via secure channel (encrypted password manager)
```

### 2. Monitoring & Alerts

```bash
# Monitor login attempts
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
-- Create view for failed logins (requires enhanced logging)
-- Log all super_admin access
CREATE TABLE IF NOT EXISTS admin_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email VARCHAR(255),
  action VARCHAR(100),
  status VARCHAR(50),
  ip_address INET,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Alert on unusual activity
SELECT * FROM admin_access_log
WHERE created_at > NOW() - INTERVAL '1 hour'
AND status = 'FAILED';
"
```

### 3. Backup Strategy

```bash
# Daily automated backups
0 2 * * * pg_dump -h localhost -U medicalpro medicalpro_central | \
  gzip > /var/backups/postgresql/medicalpro_central_$(date +\%Y\%m\%d).sql.gz

# Keep 30 days of backups
find /var/backups/postgresql/ -name "medicalpro_central_*.sql.gz" -mtime +30 -delete

# Test restore monthly
# 1st of month: pg_restore test from latest backup
```

### 4. Multi-Factor Authentication (TODO)

```javascript
// Future enhancement: Implement MFA for super_admin
// Options:
// - TOTP (Google Authenticator)
// - SMS OTP
// - WebAuthn (FIDO2)
//
// Current status: NOT IMPLEMENTED
// Recommendation: Implement before production
```

---

## Access Control Matrix

| Action | Primary Admin | Recovery Admin | Root/SSH | Notes |
|--------|---------------|----------------|----------|-------|
| Login via UI | ✅ Yes | ✅ Yes (emergency only) | ❌ | Normal authentication |
| View users | ✅ Yes | ✅ Yes | ✅ | Via admin panel or DB |
| Reset passwords | ✅ Yes | ✅ Yes | ✅ | Via admin panel or DB |
| Delete accounts | ✅ Yes | ✅ Yes | ✅ | Via admin panel or DB |
| View audit logs | ✅ Yes | ✅ Yes | ✅ | Via admin panel or DB |
| Emergency DB access | ❌ No | ❌ No | ✅ Yes | Requires SSH + DB access |

---

## Compliance & Security Notes

### GDPR Compliance
- ✅ Audit logs track all admin changes
- ✅ Soft deletes preserve data history
- ✅ Password changes logged
- ✅ Access recovery documented

### HIPAA Compliance
- ✅ Multi-layer access control
- ✅ Activity tracking (audit logs)
- ✅ Emergency procedures documented
- ⚠️ MFA not yet implemented (TODO)

### Security Best Practices
- ✅ Passwords hashed (bcrypt, 12 rounds)
- ✅ JWT tokens (24h expiry)
- ✅ Recovery account exists
- ✅ Direct DB access available
- ⚠️ No MFA yet (implement before production)
- ⚠️ No rate limiting on login (implement)

---

## Incident Response Checklist

### Upon Detecting Compromise

```
☐ 1. Verify compromise (check logs)
☐ 2. Isolate: disable compromised account if possible
☐ 3. Access: use recovery account to regain control
☐ 4. Reset: change all admin passwords
☐ 5. Audit: review all changes made
☐ 6. Monitor: watch for further suspicious activity
☐ 7. Document: record timeline of incident
☐ 8. Notify: inform stakeholders if needed
☐ 9. Recover: restore from backup if needed
☐ 10. Review: improve security to prevent recurrence
```

---

## Testing Recovery Procedures

### Monthly Drill

```bash
# 1st of month: Test recovery account access

echo "Testing Recovery Account Access..."
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "recovery-admin@example.com",
    "password": "SuperAdmin123"
  }' | jq .success

# Should return: true
```

### Quarterly Drill

```bash
# 1st of quarter: Test password reset procedure
# - Reset primary admin password via recovery account
# - Verify primary admin can login with new password
# - Revert to original password
```

### Annual Drill

```bash
# January 1: Full disaster recovery drill
# - Test database backup restoration
# - Verify all accounts accessible
# - Test emergency procedures
# - Update this document with findings
```

---

## Contact & Escalation

**Security Contact:** your-security-email@example.com
**On-Call DevOps:** DevOps team
**Database Admin:** Database team
**CTO/Tech Lead:** For approval of critical changes

### Escalation Path

1. **5 mins** - Detect issue, use recovery account
2. **15 mins** - Reset compromised account
3. **30 mins** - Notify security team
4. **1 hour** - Full incident review
5. **24 hours** - Incident report completed

---

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2025-11-15 | Initial disaster recovery plan | Security Team |
| TBD | MFA implementation | TBD |
| TBD | Rate limiting on login | TBD |

---

**Last Verified:** November 15, 2025
**Next Review:** February 15, 2026
**Status:** ACTIVE & TESTED ✅
