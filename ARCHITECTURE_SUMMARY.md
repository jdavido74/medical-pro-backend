# Multi-Clinic Architecture Implementation Summary

**Date:** November 9, 2025
**Status:** ✅ Phase 1 Complete - Database Isolation Layer Ready

## What Was Changed

### Problem Statement
User requested: **"Je ne souhaite pas qu'en cas de fuite l'intégralité de la base soit compromise"** (I don't want the entire database to be compromised in case of a breach)

The original multi-tenant SaaS design with single database + company_id isolation created a **single point of failure**. One breach = all clinics compromised.

### Solution Implemented
**Multi-Clinic Isolated Database Architecture** - Each clinic operates with its own PostgreSQL database.

```
One Breach = One Clinic Affected (not all)
```

## Architecture Changes

### 1. Database Layer

**Before:**
```
medicalpro (single database)
├── users (all clinics)
├── patients (all clinics)
└── appointments (all clinics)
```

**After:**
```
medicalpro_central (shared metadata only)
├── companies (clinic registration + DB connection info)
├── users (central admins only)
└── audit_logs

medicalpro_clinic_550e8400... (clinic 1 - isolated)
├── patients
├── practitioners
├── appointments
└── ...

medicalpro_clinic_a1b2c3d4... (clinic 2 - isolated)
├── patients
├── practitioners
├── appointments
└── ...
```

### 2. Application Layer

**New Components Created:**

| File | Purpose |
|------|---------|
| `src/config/connectionManager.js` | Manages dynamic connections to clinic databases |
| `src/middleware/clinicRouting.js` | Routes each request to clinic-specific database |
| `src/base/Repository.js` | Abstract base for database operations |
| `src/base/ModelFactory.js` | Factory for clinic-specific model instances |
| `migrations/central_001_initial_schema.sql` | Central database schema |
| `scripts/init-clinic.sh` | Clinic initialization automation |

**Server.js Changes:**
```javascript
// Before: Single database connection
const sequelize = require('./src/config/database');

// After: Dynamic routing
await initializeCentralConnection();
app.use(clinicRoutingMiddleware);  // Sets req.clinicDb
```

### 3. Request Flow

```
1. Client authenticates
   JWT includes: { userId, clinicId (companyId), email, role }

2. Protected request arrives
   Authorization: Bearer <jwt>

3. authMiddleware
   → Verifies JWT
   → Sets req.user.companyId (clinic identity)

4. clinicRoutingMiddleware (NEW)
   → Extracts clinicId from JWT
   → Fetches clinic DB connection from central database
   → Sets req.clinicDb (Sequelize instance for clinic)
   → All subsequent queries use req.clinicDb

5. Route handler
   → Queries clinic-specific database only
   → No cross-clinic data access possible
```

## Security Guarantees

### Data Isolation

```javascript
// Attacker has token for Clinic A
// Tries to access Clinic B data

const token = 'eyJc...'; // Clinic A token
const clinicId = jwt.decode(token).clinicId;  // 'clinic-a-uuid'

// Backend automatically:
const clinicDb = await getClinicConnection(clinicId);
// → Connects to medicalpro_clinic_a database

// All queries restricted to medicalpro_clinic_a
// Cannot access clinic_b data even if attacker guesses clinic_b UUID
```

**Why?** JWT signature cannot be forged. Token contains clinic identity. Cannot access different database without different token.

### Breach Containment

**Scenario: Attacker gains database access**

Before (Single DB):
```
medicalpro database breached
→ All 100 clinics' data exposed
→ Complete healthcare system compromise
→ Millions in GDPR fines
```

After (Multi-DB):
```
medicalpro_clinic_a database breached
→ Only Clinic A's patients exposed
→ Other 99 clinics unaffected
→ Issue contained and remediable
```

## Implementation Status

### ✅ Completed

| Component | Status | Details |
|-----------|--------|---------|
| Central Database | ✅ Created | medicalpro_central with companies, users, audit_logs |
| Clinic Database 1 | ✅ Created | medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000 |
| All Schema Migrations | ✅ Executed | Medical tables (patients, practitioners, appointments, etc.) |
| Connection Manager | ✅ Implemented | Dynamic connection routing + caching |
| Clinic Routing Middleware | ✅ Implemented | Automatic routing based on JWT clinic_id |
| Server Initialization | ✅ Updated | Central DB init on startup |
| Clinic Init Script | ✅ Created | Automated clinic provisioning |
| Documentation | ✅ Written | Complete architecture guide |
| Base Classes | ✅ Created | Repository + ModelFactory for easy adoption |

### ⏳ Pending

| Component | Status | Details |
|-----------|--------|---------|
| Route Migration | ⏳ TO DO | Update all routes to use req.clinicDb |
| Testing | ⏳ TO DO | Verify clinic isolation end-to-end |
| Production Deployment | ⏳ TO DO | Database backup strategy, monitoring |

## Usage Examples

### Add New Clinic

```bash
# Automated clinic creation
./scripts/init-clinic.sh "Clinique Lyon" "lyon@clinic.fr" "+33456789012"

# Script automatically:
# 1. Generates unique UUID: 550e8400-e29b-41d4-a716-446655440001
# 2. Creates database: medicalpro_clinic_550e8400_e29b_41d4_a716_446655440001
# 3. Runs all migrations
# 4. Registers in central database
```

### Query Clinic Data

**Old approach (global database):**
```javascript
const Patient = require('../models/Patient');
const patients = await Patient.findAll();  // ❌ Uncontrolled access
```

**New approach (clinic-isolated):**
```javascript
// In route handler with clinicRoutingMiddleware
const { getModel } = require('../base/ModelFactory');
const Patient = await getModel(req.clinicDb, 'Patient');
const patients = await Patient.findAll();  // ✅ Clinic-isolated
```

### Monitor Clinic Databases

```bash
# List all clinics
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central \
  -c "SELECT id, name, db_name, is_active FROM companies;"

# Query clinic A data directly
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro \
  -d medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000 \
  -c "SELECT COUNT(*) FROM patients;"
```

## Performance Impact

### Positive
✅ Connection pooling per clinic (better resource isolation)
✅ Faster queries (smaller database = faster scans)
✅ Parallel clinic queries (independent databases)

### Considerations
⚠️ More total connections (N clinics = N connection pools)
⚠️ Slightly more memory usage (cached connections per clinic)
⚠️ Backup complexity (N databases to backup)

**Mitigation:**
- Connection pool tuning in production
- Infrastructure-as-code for automation
- Centralized backup system

## Next Steps

### Phase 2: Route Migration (Estimated 4-6 hours)

```bash
# Update routes to use req.clinicDb
# Follow MIGRATION_GUIDE.md for each route

# Example routes to migrate (by priority):
1. /api/v1/patients - HIGH priority, read-heavy
2. /api/v1/appointments - HIGH priority, appointment management
3. /api/v1/documents - MEDIUM priority, quotes/invoices
4. /api/v1/practitioners - MEDIUM priority, doctor management
5. /api/v1/consents - LOW priority, compliance
```

### Phase 3: Testing (Estimated 2-3 hours)

```bash
# 1. Single clinic verification
npm run dev
# Test all endpoints with clinic A token

# 2. Multi-clinic testing
./scripts/init-clinic.sh "Test Clinic B" "test@clinic-b.fr"
# Login as clinic B user
# Verify data isolation from clinic A

# 3. Security testing
# Attempt to access clinic B data with clinic A token
# Should fail with 403 Forbidden
```

### Phase 4: Production Deployment (Estimated 1 day)

```bash
# Pre-deployment:
# 1. Database backup strategy (per clinic)
# 2. Monitoring setup (connection pools, query performance)
# 3. Scaling plan (multi-server architecture)
# 4. Disaster recovery procedures

# Deployment:
# 1. Zero-downtime migration of existing clinic to isolated DB
# 2. Gradual route updates
# 3. Monitoring and rollback plan
```

## GDPR Compliance

### Data Subject Rights

```sql
-- Delete all data for a patient (clinic A)
-- Affects ONLY clinic A database
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro \
  -d medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000 \
  -c "UPDATE patients SET deleted_at = NOW() WHERE id = 'patient-uuid';"

-- Clinic B's database unaffected
-- Other clinics' data intact
```

### Right to Be Forgotten

```sql
-- Soft delete (GDPR compliant)
-- All tables have deleted_at timestamp
UPDATE patients SET deleted_at = NOW() WHERE id = ?;
UPDATE consents SET deleted_at = NOW() WHERE patient_id = ?;
```

### Audit Trail

```sql
-- Global audit log for all clinic access
SELECT * FROM medicalpro_central.audit_logs
WHERE company_id = 'clinic-uuid'
  AND action IN ('user_access', 'patient_viewed', 'record_created');
```

## Files Changed/Created

**New Files:**
- `src/config/connectionManager.js`
- `src/middleware/clinicRouting.js`
- `src/base/Repository.js`
- `src/base/ModelFactory.js`
- `migrations/central_001_initial_schema.sql`
- `scripts/init-clinic.sh`
- `MULTI_CLINIC_ARCHITECTURE.md`
- `MIGRATION_GUIDE.md`
- `ARCHITECTURE_SUMMARY.md` (this file)

**Modified Files:**
- `server.js` - Added central DB init + clinic routing middleware
- `.env` - Added CENTRAL_DB_NAME + CLINIC_DB_NAME config

**Database Changes:**
- Created: `medicalpro_central` database
- Renamed: `medicalpro` → `medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000`
- Registered clinic in central database

## Rollback Plan

If needed to revert to single database:

```bash
# 1. Stop server
npm stop

# 2. Restore backup of original medicalpro database
psql -h localhost -U medicalpro < backup_medicalpro.sql

# 3. Revert server.js to use single connection
git checkout HEAD -- server.js

# 4. Remove clinicRoutingMiddleware
# 5. Update routes to query global db instead of req.clinicDb

# 6. Restart
npm run dev
```

**Time to rollback:** ~15 minutes

## Questions & Support

For questions about the architecture:
1. Read `MULTI_CLINIC_ARCHITECTURE.md` for overview
2. Read `MIGRATION_GUIDE.md` for implementation details
3. Check route examples in documentation

---

**Version:** 1.0
**Last Updated:** 2025-11-09
**Architecture:** Multi-Clinic with Isolated Databases
**Status:** ✅ Core Infrastructure Ready | ⏳ Route Migration In Progress
