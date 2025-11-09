# Migration Guide: Single DB → Multi-Clinic Architecture

## Overview

This guide shows how to migrate existing route handlers from a single shared database to the multi-clinic isolated database architecture.

## Architecture Change

### Before (Single Database)
```javascript
// db.js - Single global connection
const sequelize = new Sequelize('medicalpro', ...);

// routes/patients.js
const Patient = require('../models/Patient');
Patient.init(sequelize);

router.get('/', async (req, res) => {
  const patients = await Patient.findAll();  // Queries single global DB
});
```

**Problem:** All clinics share the same database - security risk!

### After (Multi-Clinic)
```javascript
// server.js - Connection management
await initializeCentralConnection();
app.use(clinicRoutingMiddleware);  // Each req gets req.clinicDb

// routes/patients.js
const ModelFactory = require('../base/ModelFactory');

router.get('/', async (req, res) => {
  const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
  const patients = await Patient.findAll();  // Queries clinic-specific DB
});
```

**Benefit:** Each clinic has isolated database - maximum security!

## Step-by-Step Migration

### Step 1: Update Model Definition

**Old Model (models/Patient.js):**
```javascript
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Patient = sequelize.define('Patient', {
    id: { type: DataTypes.UUID, primaryKey: true },
    firstName: DataTypes.STRING,
    // ... fields
  });

  return Patient;
};
```

**New Model (keep structure, add `associate` method):**
```javascript
const { DataTypes } = require('sequelize');

module.exports = {
  define: (sequelize) => {
    return sequelize.define('Patient', {
      id: { type: DataTypes.UUID, primaryKey: true },
      firstName: DataTypes.STRING,
      // ... fields
    });
  },

  // Called for model initialization
  associate: async (clinicDb) => {
    const Patient = clinicDb.define('Patient', {
      // ... same as above
    });

    // Setup associations
    // Patient.belongsTo(/* ... */);

    return Patient;
  }
};
```

### Step 2: Update Route Handler

**Old Route Handler:**
```javascript
const express = require('express');
const Patient = require('../models/Patient');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // Queries shared global database
    const patients = await Patient.findAll({
      where: { deletedAt: null }
    });

    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

**New Route Handler:**
```javascript
const express = require('express');
const ModelFactory = require('../base/ModelFactory');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // Get Patient model for this clinic
    const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');

    // Query clinic-specific database
    const patients = await Patient.findAll({
      where: { deletedAt: null }
    });

    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### Step 3: Update REST Endpoints

Pattern for all CRUD operations:

```javascript
// GET /patients/:id
router.get('/:id', async (req, res) => {
  const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
  const patient = await Patient.findByPk(req.params.id);

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  res.json(patient);
});

// POST /patients
router.post('/', async (req, res) => {
  const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');

  const patient = await Patient.create(req.body);
  res.status(201).json(patient);
});

// PUT /patients/:id
router.put('/:id', async (req, res) => {
  const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');

  const patient = await Patient.findByPk(req.params.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  await patient.update(req.body);
  res.json(patient);
});

// DELETE /patients/:id (soft delete)
router.delete('/:id', async (req, res) => {
  const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');

  const updated = await Patient.update(
    { deletedAt: new Date() },
    { where: { id: req.params.id } }
  );

  if (updated[0] === 0) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  res.status(204).send();
});
```

### Step 4: Use Repository Pattern (Optional)

For complex operations, use Repository pattern:

```javascript
// repositories/PatientRepository.js
const Repository = require('../base/Repository');
const { ModelFactory } = require('../base/ModelFactory');

class PatientRepository extends Repository {
  static async getByEmail(clinicDb, email) {
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');
    return Patient.findOne({ where: { email } });
  }

  static async getActivePatients(clinicDb, options = {}) {
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');
    return this.findAll(clinicDb, {
      where: { deletedAt: null, status: 'active' },
      ...options
    });
  }
}

module.exports = PatientRepository;
```

Usage in route:
```javascript
router.get('/active', async (req, res) => {
  const patients = await PatientRepository.getActivePatients(req.clinicDb);
  res.json(patients);
});
```

### Step 5: Handle Associations

**Old Association Code:**
```javascript
// models/index.js - Global setup
const sequelize = require('../config/database');
const Patient = require('./Patient')(sequelize);
const User = require('./User')(sequelize);

Patient.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Patient, { foreignKey: 'userId' });

module.exports = { sequelize, Patient, User };
```

**New Association Code:**
```javascript
// Associations are lazy-loaded per clinic in ModelFactory
// When you call ModelFactory.getModel(clinicDb, 'Patient'),
// it automatically initializes associations for that database instance

// Example with associations:
router.get('/:id/with-user', async (req, res) => {
  const [Patient, User] = await Promise.all([
    ModelFactory.getModel(req.clinicDb, 'Patient'),
    ModelFactory.getModel(req.clinicDb, 'User')
  ]);

  const patient = await Patient.findByPk(req.params.id, {
    include: [{ association: 'user', model: User }]
  });

  res.json(patient);
});
```

## Common Patterns

### Pattern 1: Simple Query
```javascript
const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
const patients = await Patient.findAll();
```

### Pattern 2: Query with Conditions
```javascript
const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
const active = await Patient.findAll({
  where: {
    status: 'active',
    deletedAt: null
  }
});
```

### Pattern 3: Query with Pagination
```javascript
const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
const { limit, offset } = req.query;

const { count, rows } = await Patient.findAndCountAll({
  where: { deletedAt: null },
  limit: parseInt(limit) || 10,
  offset: parseInt(offset) || 0
});

res.json({
  data: rows,
  pagination: { total: count, limit, offset }
});
```

### Pattern 4: Transaction (Multiple Models)
```javascript
const [Patient, Appointment] = await Promise.all([
  ModelFactory.getModel(req.clinicDb, 'Patient'),
  ModelFactory.getModel(req.clinicDb, 'Appointment')
]);

await req.clinicDb.transaction(async (t) => {
  const patient = await Patient.create(patientData, { transaction: t });
  const appointment = await Appointment.create(
    { patientId: patient.id, ...appointmentData },
    { transaction: t }
  );

  res.status(201).json({ patient, appointment });
});
```

### Pattern 5: Raw Query (When Needed)
```javascript
const results = await req.clinicDb.query(
  'SELECT * FROM patients WHERE status = ?',
  { replacements: ['active'], type: QueryTypes.SELECT }
);
```

## Testing Migration

### Test Single Clinic
```bash
# Start server
npm run dev

# Login as clinic user
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "doctor@clinic.fr", "password": "secret"}'

# Get JWT token from response

# Test patient endpoints
curl http://localhost:3001/api/v1/patients \
  -H "Authorization: Bearer <token>"
```

### Test Clinic Isolation
```bash
# Create patient in clinic A
curl -X POST http://localhost:3001/api/v1/patients \
  -H "Authorization: Bearer <clinic-a-token>" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "John", "lastName": "Doe"}'

# Try to access with clinic B token
curl http://localhost:3001/api/v1/patients \
  -H "Authorization: Bearer <clinic-b-token>"

# Should NOT see patient from clinic A
```

## Troubleshooting

### Issue: "ModelFactory.getModel is not a function"

**Solution:** Check import
```javascript
// Wrong:
const ModelFactory = require('../base/ModelFactory');
ModelFactory.getModel(clinicDb, 'Patient');

// Correct:
const { getModel } = require('../base/ModelFactory');
const Patient = await getModel(req.clinicDb, 'Patient');

// Or:
const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
```

### Issue: "req.clinicDb is undefined"

**Solution:** Ensure clinicRoutingMiddleware is applied
```javascript
// Check server.js has:
app.use(authMiddleware);
app.use(clinicRoutingMiddleware);  // ← Must be here
app.use('/api/v1/patients', patientRoutes);
```

### Issue: "Model not found" Error

**Solution:** Register model in ModelFactory
```javascript
// In src/base/ModelFactory.js, add:
const NewModel = require('../models/NewModel');

const MODEL_MAP = {
  // ...
  NewModel  // ← Add here
};
```

## Rollout Strategy

1. **Phase 1:** Update patient/practitioner routes (read-heavy)
2. **Phase 2:** Update appointment/document routes (mixed)
3. **Phase 3:** Update auth/user routes
4. **Phase 4:** Full testing with multiple clinics

## Performance Considerations

- **Connection pooling:** Each clinic has separate pool (good isolation)
- **Cache:** Models are cached per clinicDb instance (fast lookups)
- **Lazy loading:** Models initialized on-demand (reduces memory)

## Migration Checklist

- [ ] All models updated with clinic-aware initialization
- [ ] All routes updated to use ModelFactory
- [ ] Associations tested per clinic
- [ ] Central database queries working
- [ ] Clinic isolation verified
- [ ] Performance tested with multiple clinics
- [ ] Rollout to production

---

**Duration:** ~2-3 hours for 50 routes
**Risk Level:** Low (backwards compatible during transition)
**Rollback:** Revert server.js changes to use single DB
