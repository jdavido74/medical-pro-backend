# Multi-Clinic Database Architecture

## Overview

Medical Pro implements a **multi-clinic isolation model** where each clinic operates with its own isolated PostgreSQL database. This ensures maximum security and data privacy for healthcare data.

**Key Principle:** A data breach affecting one clinic database does NOT compromise other clinics' data.

## Architecture

### Three-Layer Database Model

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT APPLICATION                        │
│                  (React Frontend)                             │
│              authenticates with JWT token                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ JWT includes: userId, clinicId (companyId)
                     │
┌────────────────────▼────────────────────────────────────────┐
│              EXPRESS BACKEND SERVER                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 1. authMiddleware: Verifies JWT signature             │  │
│  │    → Sets req.user.companyId = clinic_id              │  │
│  │                                                        │  │
│  │ 2. clinicRoutingMiddleware: Routes to clinic DB       │  │
│  │    → Gets clinic connection info from central DB      │  │
│  │    → Attaches req.clinicDb (Sequelize instance)       │  │
│  │                                                        │  │
│  │ 3. Route Handlers: Use req.clinicDb for queries      │  │
│  │    → All CRUD operations isolated to clinic DB        │  │
│  └───────────────────────────────────────────────────────┘  │
└────────┬──────────────────────────────────┬──────────────────┘
         │                                  │
    CENTRAL DB                      CLINIC-SPECIFIC DB
┌────────▼──────────────────┐  ┌────────▼──────────────────┐
│ medicalpro_central         │  │ medicalpro_clinic_<UUID>  │
│                            │  │                           │
│ ✓ companies                │  │ ✓ patients                │
│ ✓ users (central admins)   │  │ ✓ practitioners           │
│ ✓ audit_logs               │  │ ✓ appointments            │
│                            │  │ ✓ documents (quotes/inv)  │
│ (shared across clinics)    │  │ ✓ consents                │
└────────────────────────────┘  │ ✓ appointment_items       │
                                │ ✓ products_services       │
                                │                           │
                                │ (isolated per clinic)     │
                                └───────────────────────────┘
```

## Database Details

### Central Database: `medicalpro_central`

Shared by all clinics. Manages clinic metadata and global users.

**Tables:**
- **companies**: Clinic information + database connection details
  ```sql
  id UUID, name, email, phone,
  db_host, db_port, db_name, db_user, db_password,
  is_active, subscription_status
  ```
- **users**: Central administrators
  ```sql
  id UUID, company_id UUID, email, password_hash, role, permissions
  ```
- **audit_logs**: Global audit trail
  ```sql
  id UUID, company_id UUID, user_id UUID, action, entity_type, ...
  ```

### Clinic Databases: `medicalpro_clinic_<UUID>`

Each clinic has its own isolated database.

**Database Naming Convention:**
```
medicalpro_clinic_<clinic_uuid>
Example: medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000
```

**Tables:**
- Medical data: patients, practitioners, appointments
- Documents: quotes, invoices (combined in single table with discriminator)
- Consents: consent_templates, consents
- Products: products_services, categories, product_categories
- Appointment management: appointment_items

## Request Flow

### 1. Authentication (Frontend)
```
POST /api/v1/auth/login
{
  email: "doctor@clinic.fr",
  password: "secret"
}
```

Response includes JWT:
```jwt
{
  "userId": "user-uuid",
  "clinicId": "clinic-uuid",  // ← Key: clinic identity
  "email": "doctor@clinic.fr",
  "role": "doctor"
}
```

### 2. Protected Request (Frontend)
```javascript
fetch('/api/v1/patients', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
```

### 3. Backend Processing

**Step A: Authentication**
```javascript
// authMiddleware
const decoded = verifyAccessToken(token);
req.user = {
  id: decoded.userId,
  companyId: decoded.clinicId,  // Extract clinic ID
  email: decoded.email,
  role: decoded.role
};
```

**Step B: Clinic Routing**
```javascript
// clinicRoutingMiddleware
const clinicId = req.user.companyId;
const clinicDb = await getClinicConnection(clinicId);
req.clinicDb = clinicDb;  // Attach Sequelize instance
req.clinicId = clinicId;
```

**Step C: Query Execution**
```javascript
// In route handler
const patients = await Patient.findAll({
  sequelize: req.clinicDb  // Use clinic-specific connection
});
```

## Connection Management

### Connection Pool

```javascript
// Each clinic has its own connection pool
{
  host: "localhost",
  port: 5432,
  max: 10,           // Max concurrent connections
  min: 2,            // Min idle connections
  acquire: 30000,    // Timeout waiting for connection
  idle: 10000        // Idle connection timeout
}
```

### Connection Caching

Connections are cached in memory:
```javascript
// First request to clinic A
const clinicDb = await getClinicConnection('clinic-a-uuid');
// Connection created and cached

// Second request to clinic A
const clinicDb = await getClinicConnection('clinic-a-uuid');
// Uses cached connection (no new connection)
```

**Benefits:**
- Faster request handling (no reconnection overhead)
- Reduced database load
- Automatic pooling per clinic

## Security Isolation

### Data Isolation

```javascript
// Query for clinic A
User.findAll({
  sequelize: clinicADb  // Only queries medicalpro_clinic_a
})
// Result: Only patients from clinic A

// Query for clinic B
User.findAll({
  sequelize: clinicBDb  // Only queries medicalpro_clinic_b
})
// Result: Only patients from clinic B
```

### JWT-Based Clinic Identity

No clinic ID can be spoofed:
1. JWT is signed with secret key (verified on backend)
2. clinicId is embedded in token payload
3. Token cannot be modified without invalidating signature
4. Attempts to access other clinic's data rejected at middleware level

```javascript
// Attacker tries to access clinic B data:
// 1. Request comes with token for clinic A
// 2. clinicRoutingMiddleware extracts clinicId from token
// 3. All queries use clinic A database
// 4. Cannot access clinic B even if they guess clinic B's ID
```

### Audit Trail

Global audit logs in central database:
```sql
INSERT INTO audit_logs (
  company_id, user_id, action, entity_type, old_data, new_data, ip_address
)
```

Enables investigation of access patterns across clinics.

## Operations

### Initialize New Clinic

```bash
# Run initialization script
./scripts/init-clinic.sh "Clinique Lyon" "lyon@clinic.fr" "+33456789012"
```

This automatically:
1. Generates unique UUID
2. Creates database
3. Runs all migrations
4. Registers in central database

### Monitor Clinic Database

```bash
# List all clinic databases
PGPASSWORD=password psql -h localhost -U medicalpro -d postgres -c \
  "SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%';"

# Check clinic connection info
PGPASSWORD=password psql -h localhost -U medicalpro -d medicalpro_central -c \
  "SELECT id, name, db_name, is_active FROM companies WHERE deleted_at IS NULL;"
```

### Backup Clinic Data

```bash
# Backup single clinic database
pg_dump -h localhost -U medicalpro \
  medicalpro_clinic_550e8400_e29b_41d4_a716_446655440000 > clinic_backup.sql

# Restore to new clinic
psql -h localhost -U medicalpro -d medicalpro_clinic_new < clinic_backup.sql
```

### Scale Clinics

To add a new clinic:

```bash
# 1. Run initialization
./scripts/init-clinic.sh "New Clinic" "new@clinic.fr"

# 2. Create admin user (in clinic-specific DB)
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name)
VALUES (uuid_generate_v4(), '<clinic-id>', 'admin@new-clinic.fr', '$2a$...', 'admin', 'Admin', 'User');

# 3. Backend automatically routes to new clinic on login
```

## Deployment Considerations

### Single Server (Development)
All clinic databases on same PostgreSQL instance.

### Distributed (Production)
Clinics can use different PostgreSQL servers:
```sql
-- Central database tracks server location
UPDATE companies
SET db_host = 'postgres-server-2.example.com'
WHERE id = 'clinic-uuid';

-- Backend queries central DB, then connects to correct server
```

### High Availability
Each clinic DB can have failover:
```sql
-- Use replication for clinic DBs
-- Read replicas for reporting
-- Automated failover via pgBouncer or similar
```

## Limitations & Trade-offs

### Advantages
✅ **Maximum security**: Breach isolated to single clinic
✅ **Regulatory compliance**: GDPR, healthcare privacy requirements
✅ **Scalability**: Can distribute clinics across multiple servers
✅ **Flexibility**: Customize schema per clinic if needed
✅ **Audit trail**: Track all clinic access globally

### Disadvantages
❌ **Operational complexity**: N databases to manage
❌ **Backup overhead**: Separate backup per clinic
❌ **Resource usage**: Connection pools per clinic use more memory
❌ **Global queries**: Cannot easily query across all clinics

### Mitigation
- Use infrastructure-as-code (Terraform) for clinic provisioning
- Automated daily backups with central backup service
- Connection pool tuning per environment
- Central reporting database (read-only replica of clinic data)

## Future Enhancements

### 1. Cross-Clinic Reporting
```
reporting_db (read-only copies of clinic data)
├── patients (federated)
├── appointments (federated)
└── documents (federated)
```

### 2. Automated Clinic Provisioning
```bash
# Kubernetes: Auto-spawn database on demand
helm install clinic-1 ./charts/clinic-database \
  --set clinicId=clinic-uuid
```

### 3. Clinic Database Migration
```bash
# Move clinic from server A to server B
# Zero-downtime using logical replication
```

### 4. Compliance Auditing
```sql
-- Automated compliance checks
SELECT * FROM audit_logs
WHERE action = 'user_access'
  AND created_at > NOW() - INTERVAL '24 hours';
```

## Troubleshooting

### "Clinic database unavailable" Error

```
Error: Cannot connect to clinic clinic-uuid
```

**Check:**
1. Central database has clinic registration:
   ```sql
   SELECT * FROM companies WHERE id = 'clinic-uuid';
   ```

2. Clinic database exists:
   ```bash
   psql -l | grep medicalpro_clinic_
   ```

3. Credentials correct:
   ```sql
   \c medicalpro_clinic_<uuid> medicalpro  -- Test connection
   ```

### Slow Queries for Large Clinics

**Solutions:**
1. Add indexes (done in migrations)
2. Archive old data to archive DB
3. Increase connection pool size
4. Use read replicas for reporting

### Connection Pool Exhausted

```
Error: Timeout: Cannot acquire connection
```

**Fix:**
- Increase pool.max in connectionManager.js
- Investigate long-running queries
- Monitor with `SELECT * FROM pg_stat_activity;`

---

**Version:** 1.0
**Last Updated:** 2025-11-09
**Architecture:** Multi-Clinic with Isolated Databases
