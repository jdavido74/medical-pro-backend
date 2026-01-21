# CODE REVIEW - Architecture Mismatch Analysis
**Date:** 2025-12-06
**Reviewer:** Code Review Specialist
**Status:** CRITICAL - System Non-Functional

## Executive Summary

The backend has a **fundamental architectural mismatch** between database schemas and model definitions that makes the system completely non-functional for clinic databases. The models expect fields that don't exist in clinic databases, causing all queries to fail.

### Critical Errors Identified

1. ❌ `column "deletedAt" does not exist` - Models query deleted_at, clinic tables don't have it
2. ❌ `column "company_id" does not exist` - Models query company_id, clinic tables have facility_id instead
3. ❌ `relation "practitioners" does not exist` - Clinic tables use healthcare_providers instead

---

## 1. DATABASE ARCHITECTURE ANALYSIS

### 1.1 Central Database Schema (medicalpro_central)

**Purpose:** Multi-tenant metadata storage (users, companies, legacy data)

**Patients Table:**
```sql
- id (UUID, PK)
- company_id (UUID, NOT NULL, FK → companies)      ⚠️ Multi-tenant field
- deleted_at (TIMESTAMP)                            ⚠️ Soft delete
- first_name, last_name, email, phone
- date_of_birth, gender, social_security_number
- patient_number, medical_history (JSONB)
- address (JSONB), emergency_contact (JSONB)
- insurance_info (JSONB), is_incomplete, status
- notes, created_at, updated_at
```

**Appointments Table:**
```sql
- id (UUID, PK)
- company_id (UUID, NOT NULL, FK → companies)      ⚠️ Multi-tenant field
- deleted_at (TIMESTAMP)                            ⚠️ Soft delete
- patient_id (UUID, FK → patients)
- practitioner_id (UUID, FK → practitioners)        ⚠️ Table name
- start_time, end_time, reason, notes (JSONB)
- status, created_at, updated_at, quote_id
```

**Practitioners Table:**
```sql
- id (UUID, PK)
- company_id (UUID, NOT NULL, FK → companies)      ⚠️ Multi-tenant field
- deleted_at (TIMESTAMP)                            ⚠️ Soft delete
- user_id (UUID, FK → users)
- license_number, license_expiry, speciality (JSONB)
- bio, photo_url, working_hours (JSONB)
- is_active, created_at, updated_at
```

### 1.2 Clinic Database Schema (medicalpro_clinic_*)

**Purpose:** Isolated per-clinic patient data storage

**Patients Table:**
```sql
- id (UUID, PK)
- facility_id (UUID, NOT NULL, FK → medical_facilities)   ✅ Different!
- patient_number, social_security
- first_name, last_name, maiden_name
- birth_date, gender, birth_place, nationality
- address_line1, address_line2, postal_code, city, country
- phone, mobile, email
- emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
- blood_type, allergies, chronic_conditions, current_medications
- insurance_provider, insurance_number
- mutual_insurance, mutual_number
- preferred_language, communication_preferences (JSONB)
- consent_data_processing, consent_marketing
- legal_representative
- is_active, archived (BOOLEAN)                           ✅ NOT deleted_at!
- created_at, updated_at
```

**Appointments Table:**
```sql
- id (UUID, PK)
- facility_id (UUID, NOT NULL, FK → medical_facilities)   ✅ Different!
- patient_id (UUID, FK → patients)
- provider_id (UUID, FK → healthcare_providers)           ✅ Different!
- appointment_number, appointment_date
- start_time (TIME), end_time (TIME), duration_minutes
- type, reason, notes, status
- reminder_sent, reminder_sent_at
- confirmation_required, confirmed_at, confirmed_by
- is_teleconsultation, meeting_link
- consultation_fee, insurance_covered
- created_at, updated_at
```
**NO deleted_at column** - No soft delete mechanism!

**Healthcare Providers Table (NOT practitioners!):**
```sql
- Table name: healthcare_providers (NOT practitioners)     ✅ Different!
- Fields unknown (not checked yet, but table name is wrong)
```

### 1.3 Schema Comparison

| Feature | Central DB | Clinic DB | Status |
|---------|-----------|-----------|--------|
| Multi-tenant field | `company_id` | `facility_id` | ❌ MISMATCH |
| Soft delete | `deleted_at` timestamp | `archived` boolean (patients only) | ❌ MISMATCH |
| Practitioner table | `practitioners` | `healthcare_providers` | ❌ MISMATCH |
| Foreign key references | companies | medical_facilities | ❌ MISMATCH |
| Timestamps | created_at, updated_at | created_at, updated_at | ✅ MATCH |

---

## 2. CODE ARCHITECTURE ANALYSIS

### 2.1 BaseModel Pattern (src/base/BaseModel.js)

**What it does:**
- Creates Sequelize models with standard fields and methods
- Used by ALL clinic-related models (Patient, Appointment, Practitioner)
- Connects to central database via `sequelize` from config/database.js

**Fields ALWAYS added** (lines 29-50):
```javascript
const fullAttributes = {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  company_id: {                                    // ❌ Doesn't exist in clinic DBs!
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'companies', key: 'id' },
    onDelete: 'CASCADE'
  },
  deleted_at: {                                    // ❌ Doesn't exist in clinic DBs!
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  ...attributes
};
```

**Indexes ALWAYS added** (lines 89-96):
```javascript
indexes: [
  { fields: ['company_id'] },      // ❌ company_id doesn't exist in clinic DBs
  { fields: ['deleted_at'] },      // ❌ deleted_at doesn't exist in clinic DBs
  ...(options.indexes || [])
]
```

**Methods ALWAYS added:**
- `findByCompany(companyId)` - Queries `WHERE company_id = ? AND deleted_at IS NULL` ❌
- `findActiveById(id, companyId)` - Queries `WHERE id = ? AND company_id = ? AND deleted_at IS NULL` ❌
- `countByCompany(companyId)` - Queries `WHERE company_id = ? AND deleted_at IS NULL` ❌
- `softDelete()` - Sets `deleted_at = new Date()` ❌
- `restore()` - Sets `deleted_at = null` ❌

### 2.2 Model Definitions

**src/models/Patient.js:**
```javascript
const Patient = BaseModel.create('Patient', {
  first_name: { type: DataTypes.STRING(100), allowNull: false },
  // ... other fields
}, {
  tableName: 'patients',
  indexes: [
    {
      name: 'patients_company_patient_number_unique',
      unique: true,
      fields: ['company_id', 'patient_number'],    // ❌ company_id
      where: { deleted_at: null }                  // ❌ deleted_at
    }
  ]
});
```
**Result:** Model expects company_id + deleted_at fields that don't exist in clinic DBs

**src/models/Appointment.js:**
```javascript
const Appointment = BaseModel.create('Appointment', {
  patient_id: { type: DataTypes.UUID, allowNull: false },
  practitioner_id: {                               // ❌ FK to practitioners
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'practitioners', key: 'id' }  // ❌ Table doesn't exist
  },
  // ... other fields
}, {
  tableName: 'appointments',
  indexes: [
    { fields: ['company_id', 'start_time', 'end_time'] }  // ❌ company_id
  ]
});
```
**Result:** Model references non-existent practitioners table and company_id field

**src/models/Practitioner.js:**
```javascript
const Practitioner = BaseModel.create('Practitioner', {
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' }      // ❌ users table in central DB only
  },
  // ... other fields
}, {
  tableName: 'practitioners',                      // ❌ Clinic DBs have healthcare_providers
  indexes: [
    {
      name: 'practitioners_company_license_unique',
      unique: true,
      fields: ['company_id', 'license_number'],    // ❌ company_id
      where: { deleted_at: null }                  // ❌ deleted_at
    }
  ]
});
```
**Result:** Wrong table name, wrong fields, references central DB users table

### 2.3 ModelFactory Pattern (src/base/ModelFactory.js)

**Purpose:** Re-initialize models for clinic-specific database connections

**Current Approach** (lines 79-105):
```javascript
// Fix rawAttributes to ensure proper field naming (snake_case)
const attributes = {};
for (const [attrName, attrDef] of Object.entries(CentralModel.rawAttributes)) {
  attributes[attrName] = {
    ...attrDef,
    field: attrDef.field || attrName.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
  };
}

const modelDefinition = clinicDb.define(
  modelName,
  attributes,    // ❌ Still contains company_id, deleted_at from BaseModel!
  {
    tableName: CentralModel.options.tableName || modelName.toLowerCase() + 's',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',     // ❌ Clinic DBs don't use this!
    paranoid: false,
    hooks: CentralModel.options.hooks || {},
    indexes: CentralModel.options.indexes || [],  // ❌ Contains company_id indexes!
    sequelize: clinicDb
  }
);
```

**Problem:** ModelFactory copies the central model schema (including company_id, deleted_at) and tries to use it for clinic databases. This is fundamentally wrong because the schemas are completely different.

### 2.4 Route Handlers

**src/routes/patients.js** (lines 39-56):
```javascript
onBeforeCreate: async (data, user, clinicDb) => {
  const Patient = await getModel(clinicDb, 'Patient');

  const existing = await Patient.findOne({
    where: {
      [Op.or]: [
        { email: data.email },
        { [Op.and]: [{ firstName: data.firstName }, { lastName: data.lastName }] }
      ],
      deletedAt: null    // ❌ Column doesn't exist in clinic DB!
    }
  });

  if (existing) {
    throw new Error('Patient with this email or name already exists in this clinic');
  }

  return data;
}
```

**src/routes/appointments.js** (lines 36-44):
```javascript
onBeforeCreate: async (data, user, clinicDb) => {
  const Appointment = await getModel(clinicDb, 'Appointment');

  const conflict = await Appointment.findOne({
    where: {
      practitionerId: data.practitionerId,
      status: { [Op.ne]: 'cancelled' },
      startTime: { [Op.lt]: data.endTime },
      endTime: { [Op.gt]: data.startTime },
      deletedAt: null    // ❌ Column doesn't exist in clinic DB!
    }
  });
  // ...
}
```

---

## 3. ERROR CHAIN ANALYSIS

### 3.1 Request Flow

```
1. User logs in → JWT with companyId
2. Request to GET /api/v1/patients
3. authMiddleware verifies JWT, adds user to req
4. clinicRoutingMiddleware:
   - Gets companyId from JWT: 2f8e96fd-963a-4d19-9b63-8bc94dd46c10
   - Calls getClinicConnection(companyId)
   - Attaches clinic DB connection to req.clinicDb
5. Route handler:
   - Calls ModelFactory.getModel(req.clinicDb, 'Patient')
   - ModelFactory redefines Patient model with clinic DB connection
   - BUT: Model still has company_id, deleted_at from BaseModel
6. Query execution:
   - clinicCrudRoutes builds query: SELECT * FROM patients WHERE deleted_at IS NULL
   - Sequelize sends to clinic database
7. ❌ ERROR: column Patient.deletedAt does not exist
```

### 3.2 Why Every Fix Attempt Failed

**Attempt 1:** Call `.associate()` method
- **Error:** ModelClass.associate is not a function
- **Why it failed:** Sequelize models don't have an associate() method by default

**Attempt 2:** Copy model with `clinicDb.define()`
- **Error:** column "deletedAt" does not exist
- **Why it failed:** Copied attributes still included company_id and deleted_at from BaseModel

**Attempt 3:** Add `underscored: true` explicitly
- **Error:** column "deletedAt" does not exist
- **Why it failed:** underscored only affects NEW models, not field names in WHERE clauses

**Attempt 4:** Invert option merge order
- **Error:** column "deletedAt" does not exist
- **Why it failed:** The problem isn't option order, it's that the fields don't exist at all

**Attempt 5:** Manual field mapping with snake_case
- **Error:** column "deletedAt" does not exist
- **Why it failed:** Still copying company_id and deleted_at attributes from central model

**Root Cause:** All attempts tried to "fix" the central model definition to work with clinic DBs. This is impossible because the schemas are fundamentally different. You can't use a model defined for one schema on a completely different schema.

---

## 4. COMPREHENSIVE INCONSISTENCIES LIST

### 4.1 BaseModel Issues

| File | Line | Issue | Impact |
|------|------|-------|--------|
| BaseModel.js | 35-43 | Always adds company_id field | ❌ Field doesn't exist in clinic DBs |
| BaseModel.js | 44-48 | Always adds deleted_at field | ❌ Field doesn't exist in clinic DBs (patients use archived) |
| BaseModel.js | 89 | Index on company_id | ❌ Can't create index on non-existent field |
| BaseModel.js | 94 | Index on deleted_at | ❌ Can't create index on non-existent field |
| BaseModel.js | 174-183 | findByCompany() queries company_id | ❌ Query fails on clinic DBs |
| BaseModel.js | 176-179 | Queries deleted_at IS NULL | ❌ Query fails on clinic DBs |
| BaseModel.js | 188-196 | findActiveById() queries company_id + deleted_at | ❌ Query fails on clinic DBs |
| BaseModel.js | 201-209 | countByCompany() queries company_id + deleted_at | ❌ Query fails on clinic DBs |
| BaseModel.js | 222 | findWithPagination() queries deleted_at | ❌ Query fails on clinic DBs |
| BaseModel.js | 252 | searchByCompany() queries company_id | ❌ Query fails on clinic DBs |

### 4.2 Model Definition Issues

| File | Line | Issue | Impact |
|------|------|-------|--------|
| Patient.js | 9 | Uses BaseModel.create() | ❌ Inherits company_id + deleted_at |
| Patient.js | 87-91 | Index on company_id + patient_number | ❌ company_id doesn't exist |
| Patient.js | 90 | WHERE deleted_at IS NULL in index | ❌ deleted_at doesn't exist |
| Appointment.js | 4 | Uses BaseModel.create() | ❌ Inherits company_id + deleted_at |
| Appointment.js | 10-13 | FK to practitioners table | ❌ Clinic DBs use healthcare_providers |
| Appointment.js | 49 | Index on company_id + times | ❌ company_id doesn't exist |
| Practitioner.js | 4 | Uses BaseModel.create() | ❌ Inherits company_id + deleted_at |
| Practitioner.js | 5-8 | FK to users table | ❌ users table only in central DB |
| Practitioner.js | 41 | tableName: 'practitioners' | ❌ Clinic DBs use healthcare_providers |
| Practitioner.js | 43-48 | Index on company_id + license | ❌ company_id doesn't exist |
| Practitioner.js | 47 | WHERE deleted_at IS NULL | ❌ deleted_at doesn't exist |

### 4.3 ModelFactory Issues

| File | Line | Issue | Impact |
|------|------|-------|--------|
| ModelFactory.js | 80-87 | Copies central model attributes | ❌ Includes company_id + deleted_at |
| ModelFactory.js | 99 | deletedAt: 'deleted_at' option | ❌ Field doesn't exist |
| ModelFactory.js | 102 | Copies central model indexes | ❌ Includes company_id + deleted_at indexes |

### 4.4 Route Handler Issues

| File | Line | Issue | Impact |
|------|------|-------|--------|
| patients.js | 50 | WHERE deletedAt: null | ❌ Column doesn't exist |
| appointments.js | 42 | WHERE deletedAt: null | ❌ Column doesn't exist |
| appointments.js | 76 | WHERE deletedAt: null | ❌ Column doesn't exist |
| appointments.js | 116 | WHERE deletedAt: null | ❌ Column doesn't exist |
| appointments.js | 137 | WHERE deletedAt: null | ❌ Column doesn't exist |
| appointments.js | 148 | WHERE deletedAt: null | ❌ Column doesn't exist |

---

## 5. ARCHITECTURAL SOLUTIONS

### Option A: Separate Models for Clinic DBs ⭐ RECOMMENDED

**Approach:** Create dedicated models that match clinic database schema

**Implementation:**

1. **Create ClinicBaseModel** (src/base/ClinicBaseModel.js):
   - Does NOT add company_id (clinics are isolated by database)
   - Does NOT add deleted_at (clinics use different soft delete mechanisms)
   - Uses facility_id for relationships
   - Methods query actual clinic schema

2. **Create Clinic-Specific Models**:
   - src/models/clinic/Patient.js - Uses facility_id, archived boolean
   - src/models/clinic/Appointment.js - Uses facility_id, provider_id FK
   - src/models/clinic/HealthcareProvider.js - Matches healthcare_providers table

3. **Update ModelFactory**:
   - Map model names to correct model type
   - Use clinic models for clinic DBs, central models for central DB

4. **Update Route Handlers**:
   - Use clinic-specific query logic
   - Check archived instead of deleted_at for patients
   - Reference provider_id instead of practitioner_id

**Pros:**
- ✅ Matches actual database schemas
- ✅ Clear separation of concerns
- ✅ No database migrations needed
- ✅ Supports both architectures simultaneously

**Cons:**
- ⚠️ Code duplication between central and clinic models
- ⚠️ More maintenance (two sets of models)

### Option B: Migrate Clinic DBs to Match Central Schema

**Approach:** Update all clinic databases to use central DB schema

**Implementation:**

1. **Database Migrations** for each clinic DB:
   ```sql
   -- Add company_id column
   ALTER TABLE patients ADD COLUMN company_id UUID NOT NULL;
   ALTER TABLE appointments ADD COLUMN company_id UUID NOT NULL;

   -- Add deleted_at column
   ALTER TABLE patients ADD COLUMN deleted_at TIMESTAMP;
   ALTER TABLE appointments ADD COLUMN deleted_at TIMESTAMP;

   -- Rename tables
   ALTER TABLE healthcare_providers RENAME TO practitioners;

   -- Remove archived column
   ALTER TABLE patients DROP COLUMN archived;

   -- Add foreign keys
   ALTER TABLE patients ADD CONSTRAINT patients_company_id_fkey
     FOREIGN KEY (company_id) REFERENCES companies(id);
   ```

2. **Data Migration**:
   - Set company_id to clinic's UUID for all existing rows
   - Convert archived boolean to deleted_at timestamp
   - Update all foreign key references

**Pros:**
- ✅ Single model codebase
- ✅ Consistent architecture

**Cons:**
- ❌ Requires migrations for ALL existing clinic databases
- ❌ Breaking change for any direct DB access
- ❌ Redundant company_id (clinics already isolated by database)
- ❌ High risk of data loss during migration
- ❌ Goes against database isolation principle

### Option C: Hybrid Approach

**Approach:** Use schema detection and dynamic model configuration

**Implementation:**

1. **Schema Detection**: ModelFactory detects which schema is in use
2. **Dynamic Attributes**: Conditionally add company_id, deleted_at
3. **Query Translation Layer**: Translate company_id queries to facility_id

**Pros:**
- ✅ Supports both schemas with single codebase

**Cons:**
- ❌ Very complex
- ❌ Difficult to maintain
- ❌ Performance overhead

---

## 6. RECOMMENDED ACTION PLAN

### Phase 1: Immediate Fixes (Option A Implementation)

**Priority: CRITICAL - System Currently Non-Functional**

1. **Create ClinicBaseModel.js** ✅
   - Base model WITHOUT company_id, deleted_at
   - Uses facility_id for relationships
   - Provides clinic-appropriate query methods

2. **Create Clinic Models** ✅
   - models/clinic/Patient.js
   - models/clinic/Appointment.js
   - models/clinic/HealthcareProvider.js

3. **Update ModelFactory** ✅
   - Use clinic models for clinic DBs
   - Keep central models for central DB

4. **Update Route Handlers** ✅
   - Fix queries to use correct fields
   - Remove deleted_at checks for clinic DBs

5. **Testing** ✅
   - Test patient CRUD operations
   - Test appointment CRUD operations
   - Test practitioner/provider CRUD operations

### Phase 2: Code Quality Improvements

1. **Documentation**
   - Document central vs clinic architecture
   - Update API documentation
   - Add JSDoc comments

2. **Tests**
   - Unit tests for clinic models
   - Integration tests for clinic routes
   - Test both central and clinic DBs

3. **Refactoring**
   - Extract common logic
   - Reduce code duplication
   - Improve error messages

### Phase 3: Long-term Architecture

1. **Evaluate Migration Strategy**
   - Assess if central DB patients/appointments are still needed
   - Consider deprecating central clinic tables
   - Plan gradual migration if needed

2. **Frontend Alignment**
   - Ensure frontend expects correct field names
   - Update API contracts
   - Version API if needed

---

## 7. FRONTEND EXPECTATIONS ANALYSIS

Based on the route definitions and validation schemas, the frontend expects:

### API Endpoints

| Endpoint | Method | Expected Response Fields | Status |
|----------|--------|-------------------------|--------|
| /api/v1/patients | GET | Array of patients with id, firstName, lastName, email, phone, etc. | ⚠️ Currently failing |
| /api/v1/patients | POST | Created patient object | ⚠️ Currently failing |
| /api/v1/appointments | GET | Array of appointments | ⚠️ Currently failing |
| /api/v1/appointments | POST | Created appointment | ⚠️ Currently failing |

### Field Naming Convention

**Backend sends:** snake_case (first_name, last_name, created_at)
**Frontend may expect:** camelCase (firstName, lastName, createdAt)

**Status:** Need to verify if API responses are transformed to camelCase. Check if there's a response transformer middleware.

### Current Issues

1. ❌ All patient queries fail due to deleted_at column error
2. ❌ All appointment queries fail due to deleted_at column error
3. ⚠️ Field naming might not match frontend expectations (needs verification)
4. ⚠️ practitioner_id vs provider_id mismatch

---

## 8. CONCLUSION

### Critical Findings

1. **System is completely non-functional** for clinic database operations
2. **Root cause:** Models designed for central DB schema being used on clinic DBs with different schema
3. **All CRUD operations fail** with column not found errors
4. **ModelFactory approach is fundamentally flawed** - can't fix central models for clinic use

### Immediate Action Required

Implement **Option A: Separate Models for Clinic DBs** to restore functionality

### Estimated Effort

- Phase 1 (Critical Fixes): 4-6 hours
- Phase 2 (Quality): 8-12 hours
- Phase 3 (Long-term): 16-24 hours

### Risk Assessment

**Current Risk:** 🔴 CRITICAL - System completely broken
**Post-Fix Risk:** 🟡 MEDIUM - Dual model architecture requires careful maintenance

---

## Appendix A: Test Queries to Verify Fixes

```sql
-- Clinic DB: Verify patients table structure
\d patients

-- Clinic DB: Verify appointments table structure
\d appointments

-- Clinic DB: Verify healthcare_providers table
\d healthcare_providers

-- Clinic DB: Test query that should work
SELECT id, first_name, last_name, facility_id, archived
FROM patients
WHERE is_active = true
LIMIT 5;

-- Central DB: Verify separation
SELECT id, first_name, last_name, company_id, deleted_at
FROM patients
WHERE deleted_at IS NULL
LIMIT 5;
```

## Appendix B: Key Files to Modify

1. src/base/ClinicBaseModel.js (NEW)
2. src/models/clinic/Patient.js (NEW)
3. src/models/clinic/Appointment.js (NEW)
4. src/models/clinic/HealthcareProvider.js (NEW)
5. src/base/ModelFactory.js (MODIFY)
6. src/routes/patients.js (MODIFY)
7. src/routes/appointments.js (MODIFY)
8. src/routes/practitioners.js (MODIFY - rename to healthcare-providers.js?)
