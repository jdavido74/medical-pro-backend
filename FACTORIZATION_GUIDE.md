# 🏗️ Backend Factorization Guide

Ce guide explique comment les abstractions réduisent le code dupliqué et accélèrent l'ajout de nouveaux modèles.

## 📊 Impact de la Factorization

### Avant (Sans Factorization)
- Patient model: ~270 lignes
- Patient routes: ~400 lignes
- Patient validation: ~200 lignes
- **Total par modèle: ~870 lignes**

### Après (Avec Factorization)
- Patient model: ~50 lignes (hérité de BaseModel)
- Patient routes: ~30 lignes (généré par crudRoutes)
- Patient validation: ~10 lignes (utilise les blocs)
- **Total par modèle: ~90 lignes**

**Réduction: 89% du code** ✅

---

## 🚀 Comment Créer un Nouveau Modèle Médical

### Étape 1: Créer le Modèle Sequelize

```javascript
// src/models/Patient.js
const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Patient = BaseModel.create('Patient', {
  // Champs spécifiques au patient
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { len: [2, 100] }
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { len: [2, 100] }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
    validate: { isEmail: true }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { is: /^[\+]?[0-9\s\-\(\)]{8,20}$/ }
  },
  date_of_birth: {
    type: DataTypes.DATE,
    allowNull: true
  },
  gender: {
    type: DataTypes.STRING(10),
    allowNull: true,
    validate: { isIn: [['M', 'F', 'O', 'N/A']] }
  },
  social_security_number: {
    type: DataTypes.STRING(255), // Chiffré
    allowNull: true
  },
  patient_number: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true // Unique per company via index
  },
  medical_history: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  address: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  emergency_contact: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  insurance_info: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  is_incomplete: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [['active', 'inactive', 'archived']] }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'patients',
  indexes: [
    {
      name: 'patients_company_patient_number_unique',
      unique: true,
      fields: ['company_id', 'patient_number'],
      where: { deleted_at: null }
    }
  ],
  hooks: {
    beforeCreate: (patient, opts) => {
      // Defaults spécifiques au Patient
      if (!patient.patient_number) {
        patient.patient_number = `P-${Date.now()}`;
      }
    }
  }
});

module.exports = Patient;
```

**C'est tout!** Vous avez automatiquement:
- ✅ `id` (UUID, primary key)
- ✅ `company_id` (FK, soft delete isolation)
- ✅ `deleted_at` (soft delete)
- ✅ `created_at`, `updated_at` (timestamps)
- ✅ Hooks de normalisation
- ✅ Méthodes: `toSafeJSON()`, `softDelete()`, `restore()`, `getDisplayName()`
- ✅ Méthodes statiques: `findByCompany()`, `findActiveById()`, `countByCompany()`, `findWithPagination()`, `searchByCompany()`

---

### Étape 2: Créer les Schémas de Validation

```javascript
// src/routes/patients.js - Au début du fichier
const Joi = require('joi');
const schemas = require('../base/validationSchemas');

// Réutiliser les schémas préconstruits
const createPatientSchema = schemas.createPatientSchema;
const updatePatientSchema = schemas.updatePatientSchema;

// Ou combiner des blocs réutilisables
const customPatientSchema = Joi.object({
  ...schemas.basicInfo(), // first_name + last_name
  ...schemas.contact(),    // email + phone
  ...schemas.addressFull(),// address
  date_of_birth: schemas.dateOfBirth.optional(),
  gender: schemas.gender,
  patient_number: schemas.patientNumber.optional(),
  notes: schemas.notes
});
```

**Zero duplication!** Les schémas sont définis une fois et réutilisés.

---

### Étape 3: Créer les Routes CRUD

```javascript
// src/routes/patients.js - Générer les routes
const express = require('express');
const crudRoutes = require('../base/crudRoutes');
const { Patient } = require('../models');
const schemas = require('../base/validationSchemas');

const router = express.Router();

// Générer automatiquement toutes les routes CRUD
const patientRoutes = crudRoutes(Patient, {
  createSchema: schemas.createPatientSchema,
  updateSchema: schemas.updatePatientSchema,
  querySchema: Joi.object(schemas.queryParams()),
  modelName: 'Patient',
  searchFields: ['first_name', 'last_name', 'email', 'phone', 'patient_number'],

  // Hooks optionnels pour logique métier spécifique
  onBeforeCreate: async (data, user) => {
    // Vérifier duplicate
    const existing = await Patient.findOne({
      where: {
        company_id: user.companyId,
        $or: [
          { email: data.email },
          { first_name: data.first_name, last_name: data.last_name }
        ]
      }
    });
    if (existing) throw new Error('Patient already exists');
    return data;
  },

  onAfterCreate: async (patient, user) => {
    logger.info(`Patient created: ${patient.getDisplayName()}`, {
      patientId: patient.id,
      companyId: user.companyId
    });
  }
});

router.use('/', patientRoutes);

module.exports = router;
```

**C'est tout!** Vous avez automatiquement:
- ✅ `GET /api/v1/patients` - Liste avec pagination
- ✅ `GET /api/v1/patients/:id` - Récupérer un patient
- ✅ `POST /api/v1/patients` - Créer un patient
- ✅ `PUT /api/v1/patients/:id` - Mettre à jour
- ✅ `DELETE /api/v1/patients/:id` - Soft delete
- ✅ `GET /api/v1/patients/search` - Recherche avancée
- ✅ Validation Joi automatique
- ✅ Isolation multi-tenant automatique
- ✅ Logging automatique
- ✅ Gestion d'erreurs standardisée

---

## 📝 Exemple Complet: Modèle Appointment

### Models/Appointment.js
```javascript
const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Appointment = BaseModel.create('Appointment', {
  patient_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'patients', key: 'id' }
  },
  practitioner_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'practitioners', key: 'id' }
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: false
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: false
  },
  reason: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'scheduled',
    validate: {
      isIn: [['scheduled', 'confirmed', 'cancelled', 'completed', 'no-show']]
    }
  },
  notes: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'appointments',
  indexes: [
    { fields: ['patient_id'] },
    { fields: ['practitioner_id'] },
    { fields: ['start_time'] }
  ]
});

module.exports = Appointment;
```

### Routes/Appointments.js
```javascript
const express = require('express');
const crudRoutes = require('../base/crudRoutes');
const { Appointment } = require('../models');
const schemas = require('../base/validationSchemas');

const appointmentRoutes = crudRoutes(Appointment, {
  createSchema: schemas.createAppointmentSchema,
  updateSchema: schemas.createAppointmentSchema.optional(),
  querySchema: Joi.object(schemas.queryParams()),
  modelName: 'Appointment',
  searchFields: ['reason']
});

module.exports = appointmentRoutes;
```

### Server.js
```javascript
// Ajouter les routes
app.use(`/api/${API_VERSION}/patients`, authMiddleware, patientRoutes);
app.use(`/api/${API_VERSION}/practitioners`, authMiddleware, practitionerRoutes);
app.use(`/api/${API_VERSION}/appointments`, authMiddleware, appointmentRoutes);
```

**Temps total: 10 minutes** pour créer modèle + routes + validation pour 3 entités!

---

## 🔐 Sécurité Automatique

### Multi-Tenant Isolation
```javascript
// Automatique dans BaseModel.findByCompany()
const patients = await Patient.findByCompany(req.user.companyId);
// SELECT * FROM patients WHERE company_id = '...' AND deleted_at IS NULL
```

### Soft Delete Automatique
```javascript
// Pas de vraie suppression
await patient.softDelete(); // SET deleted_at = NOW()

// Les requêtes excluent automatiquement les supprimés
await Patient.findByCompany(companyId); // WHERE deleted_at IS NULL
```

### Pagination Automatique
```javascript
const result = await Patient.findWithPagination({
  company_id: companyId
}, {
  page: 1,
  limit: 20
});
// Retourne: { data: [...], pagination: { current, total, count, hasNext, hasPrev } }
```

### Validation Automatique
```javascript
// createCrudRoutes valide automatiquement
POST /api/v1/patients
{
  "first_name": "", // ❌ Vide = validation error automatique
  "email": "invalid" // ❌ Email invalide = validation error automatique
}
// Response: 400 { success: false, error: { message: 'Validation Error', details: [...] } }
```

---

## 📈 Ajouter de la Logique Métier Spécifique

### Hook Before Create
```javascript
const patientRoutes = crudRoutes(Patient, {
  // ... config ...
  onBeforeCreate: async (data, user) => {
    // Vérifier les doublons
    const duplicate = await Patient.findOne({
      where: {
        company_id: user.companyId,
        email: data.email
      }
    });
    if (duplicate) throw new Error('Email already registered');

    // Générer numéro patient
    if (!data.patient_number) {
      const count = await Patient.countByCompany(user.companyId);
      data.patient_number = `P-${user.companyId.substring(0, 4)}-${count + 1}`;
    }

    return data;
  }
});
```

### Hook After Create
```javascript
onAfterCreate: async (patient, user) => {
  // Envoyer email de bienvenue
  await emailService.sendWelcome(patient.email, patient.getDisplayName());

  // Logger l'événement
  logger.info(`New patient registered`, {
    patientId: patient.id,
    companyId: user.companyId
  });
}
```

---

## 🎯 Checklist: Ajouter un Nouveau Modèle

- [ ] Créer le modèle dans `src/models/` (50-100 lignes)
- [ ] Ajouter au `src/models/index.js` (1 ligne)
- [ ] Créer les routes dans `src/routes/` (30-50 lignes)
- [ ] Ajouter les routes à `server.js` (1 ligne)
- [ ] Tester les 6 endpoints générés automatiquement
- [ ] Ajouter des migrations SQL si nécessaire
- [ ] Ajouter les associations si parent/child

**Temps estimé: 15-30 minutes par modèle** (vs 2-3 heures sans factorization)

---

## 📚 Fichiers Clés

| Fichier | Responsabilité |
|---------|-----------------|
| `src/base/BaseModel.js` | Classe abstraite pour tous les modèles |
| `src/base/crudRoutes.js` | Factory pour routes CRUD standardisées |
| `src/base/validationSchemas.js` | Blocs Joi réutilisables et préconstruits |
| `src/middleware/companyTenancy.js` | Vérification multi-tenant |
| `src/middleware/errorHandler.js` | Gestion centralisée des erreurs |

---

## 🚨 Points d'Attention

### ⚠️ Soft Delete, pas Hard Delete
```javascript
// ❌ NE PAS faire
await Patient.destroy({ where: { id } });

// ✅ Faire
const patient = await Patient.findByPk(id);
await patient.softDelete(); // Marque comme supprimé, garde les données
```

### ⚠️ Toujours Filter par Company
```javascript
// ❌ NON SÉCURISÉ - Récupère les patients de toutes les cliniques
const patients = await Patient.findAll();

// ✅ SÉCURISÉ - Seulement les patients de cette clinique
const patients = await Patient.findByCompany(req.user.companyId);
```

### ⚠️ Validation Obligatoire
```javascript
// ❌ Pas de validation = injection de données invalides
router.post('/', (req, res) => {
  Patient.create(req.body); // Dangereux!
});

// ✅ Avec validation Joi
router.use('/', crudRoutes(Patient, {
  createSchema: schemas.createPatientSchema // Validation stricte
}));
```

---

## 🎓 Prochaines Étapes

1. Créer les 5 modèles médicaux (Patient, Practitioner, Appointment, MedicalRecord, Consent)
2. Générer les routes pour chacun avec `crudRoutes`
3. Migrer le frontend PatientContext pour appeler les API
4. Ajouter les associations (Patient ↔ Appointment, etc)
5. Ajouter les validations métier spécifiques (check time conflicts, etc)
