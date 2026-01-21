# Analyse Complète - Création de Patient

**Date**: 2025-12-06
**Objectif**: Documentation des champs obligatoires et validations pour la création de patient

---

## 📋 Vue d'Ensemble

La création d'un patient implique **3 couches de validation**:
1. **Frontend React** - Validation UX temps réel
2. **Backend Joi** - Validation schéma API
3. **Database Sequelize** - Contraintes PostgreSQL

---

## 🔴 CHAMPS OBLIGATOIRES

### Frontend React (PatientFormModal.js)

**Champs REQUIRED** validés dans `validateForm()` (lignes 131-145):

| Champ Frontend | Type | Validation | Message d'erreur |
|----------------|------|------------|------------------|
| `firstName` | string | Non vide (trim) | "El nombre es obligatorio" |
| `lastName` | string | Non vide (trim) | "Los apellidos son obligatorios" |
| `birthDate` | date | Non null | "La fecha de nacimiento es obligatoria" |
| `gender` | enum | Non vide | "El sexo es obligatorio" |
| `idNumber` | string | Non vide (trim) | "El número de documento es obligatorio" |

**Total**: 5 champs obligatoires côté frontend

---

### Backend Validation (validationSchemas.js)

**Schéma Joi** `createPatientSchema` (lignes 78-117):

| Champ Backend | Validation Joi | Obligatoire | Détails |
|---------------|----------------|-------------|---------|
| `first_name` | `Joi.string().min(2).max(100).trim().required()` | ✅ **OUI** | Min 2 chars, max 100 |
| `last_name` | `Joi.string().min(2).max(100).trim().required()` | ✅ **OUI** | Min 2 chars, max 100 |
| `birth_date` | `Joi.date().optional()` | ❌ NON | Optionnel backend |
| `gender` | `Joi.string().valid('M', 'F', 'O', 'N/A').optional()` | ❌ NON | Optionnel, valeurs limitées |
| `email` | `Joi.string().email().lowercase().trim().optional()` | ❌ NON | Si fourni: format email |
| `phone` | `Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).optional()` | ❌ NON | Si fourni: 8-20 chars |

**Total**: 2 champs obligatoires côté backend (first_name, last_name)

---

### Database Sequelize (Patient.js)

**Contraintes PostgreSQL** (lignes 22-199):

| Champ Database | Type | AllowNull | Validation | Default |
|----------------|------|-----------|------------|---------|
| `facility_id` | UUID | **NO** (required) | Foreign key | - |
| `first_name` | VARCHAR(100) | **NO** (required) | len: [1, 100] | - |
| `last_name` | VARCHAR(100) | **NO** (required) | len: [1, 100] | - |
| `birth_date` | DATE | **NO** (required) | - | - |
| `gender` | VARCHAR(10) | YES (optional) | isIn: ['M', 'F', 'O', 'N/A'] | - |
| `country` | VARCHAR(2) | YES (optional) | - | 'FR' |
| `email` | VARCHAR(255) | YES (optional) | isEmail: true | - |
| `phone` | VARCHAR(20) | YES (optional) | - | - |
| `is_active` | BOOLEAN | YES (optional) | - | true |

**Total**: 4 champs obligatoires côté database (facility_id, first_name, last_name, birth_date)

---

## ⚠️ INCOHÉRENCES IDENTIFIÉES

### 1. 🔴 CRITIQUE: birth_date (Date de naissance)

| Couche | Statut | Impact |
|--------|--------|--------|
| **Frontend** | ✅ OBLIGATOIRE | Bloque la soumission si vide |
| **Backend Joi** | ❌ OPTIONNEL | `Joi.date().optional()` |
| **Database** | ✅ OBLIGATOIRE | `allowNull: false` |

**Problème**:
```javascript
// Frontend valide et requiert birthDate
if (!formData.birthDate) {
  newErrors.birthDate = 'La fecha de nacimiento es obligatoria';
}

// Backend ne valide PAS
birth_date: Joi.date().optional(),  // ❌ Incohérent!

// Database REQUIERT
birth_date: {
  type: DataTypes.DATEONLY,
  allowNull: false,  // ❌ Erreur SQL si non fourni!
}
```

**Conséquence**:
- Si frontend bypass, l'API accepte mais la DB rejette
- Erreur SQL: `null value in column "birth_date" violates not-null constraint`

**Solution**:
```javascript
// Corriger dans validationSchemas.js ligne 85
birth_date: Joi.date().iso().required(),  // ✅ Cohérent avec DB
```

---

### 2. 🔴 CRITIQUE: gender (Sexe)

| Couche | Statut | Impact |
|--------|--------|--------|
| **Frontend** | ✅ OBLIGATOIRE | Bloque la soumission si vide |
| **Backend Joi** | ❌ OPTIONNEL | `gender: atomicSchemas.gender` (optional) |
| **Database** | ⚠️ OPTIONNEL | `allowNull: true` |

**Problème**:
```javascript
// Frontend valide et requiert gender
if (!formData.gender) {
  newErrors.gender = 'El sexo es obligatorio';
}

// Backend ne valide PAS comme required
gender: Joi.string().valid('M', 'F', 'O', 'N/A').optional(),

// Database accepte NULL
gender: {
  type: DataTypes.STRING(10),
  allowNull: true,  // ⚠️ Cohérent avec Joi mais incohérent avec frontend
}
```

**Impact**:
- Incohérence UX: frontend dit obligatoire mais backend/DB acceptent null
- Risque de données incomplètes en production

**Recommandation**:
```javascript
// Option 1: Rendre obligatoire partout (recommandé pour santé)
gender: Joi.string().valid('M', 'F', 'O', 'N/A').required(),
// ET
gender: { allowNull: false }

// Option 2: Rendre optionnel frontend (si politique de confidentialité)
// Retirer la validation frontend ligne 140-142
```

---

### 3. 🟡 MOYEN: idNumber (Numéro de document)

| Couche | Statut | Impact |
|--------|--------|--------|
| **Frontend** | ✅ OBLIGATOIRE | Bloque si vide |
| **Backend Joi** | ❌ ABSENT | Pas de champ `idNumber` dans schema! |
| **Database** | ❌ ABSENT | Pas de colonne `idNumber`! |

**Problème**:
```javascript
// Frontend collecte idNumber
const [formData, setFormData] = useState({
  idNumber: '',  // Collecté
  // ...
});

// Frontend valide
if (!formData.idNumber.trim()) {
  newErrors.idNumber = 'El número de documento es obligatorio';
}

// Backend: AUCUN champ correspondant!
// Database: AUCUNE colonne correspondante!
```

**Conséquence**:
- Données collectées par le frontend mais **jamais sauvegardées**!
- L'utilisateur pense avoir entré son numéro de document mais il est perdu

**Mapping possible**:
```javascript
// idNumber pourrait correspondre à:
social_security: {  // Numéro sécurité sociale (15 digits)
  type: DataTypes.STRING(15),
  allowNull: true
}
```

**Solution**:
```javascript
// Option 1: Mapper idNumber → social_security
// Dans dataTransform.js
social_security_number: patient.idNumber,

// Option 2: Ajouter colonne id_number à la DB
id_number: {
  type: DataTypes.STRING(50),
  allowNull: true  // ou false si obligatoire
}
```

---

### 4. 🟡 MOYEN: facility_id

| Couche | Statut | Impact |
|--------|--------|--------|
| **Frontend** | ❌ ABSENT | Jamais collecté/envoyé |
| **Backend Joi** | ⚠️ OPTIONNEL | `Joi.string().uuid().optional()` |
| **Database** | ✅ OBLIGATOIRE | `allowNull: false` |

**Problème**:
```javascript
// Frontend ne gère PAS facility_id

// Backend accepte optionnel
facility_id: Joi.string().uuid().optional(),

// Database REQUIERT
facility_id: {
  type: DataTypes.UUID,
  allowNull: false,  // ❌ Erreur si non fourni!
}
```

**Solution Actuelle**:
La route doit ajouter un default dans le handler (similaire aux appointments):
```javascript
// Dans routes/patients.js
onBeforeCreate: async (data, user, clinicDb) => {
  if (!data.facility_id) {
    data.facility_id = '00000000-0000-0000-0000-000000000001';  // Default
  }
  return data;
}
```

**Vérification nécessaire**: Confirmer que cette logique existe dans le route handler.

---

## 📊 VALIDATIONS CONDITIONNELLES

### Frontend - Contact d'urgence (lignes 158-165)

**Règle**: Si `emergencyContact.name` est renseigné, alors `relationship` et `phone` deviennent obligatoires.

```javascript
if (formData.contact.emergencyContact.name) {
  if (!formData.contact.emergencyContact.relationship) {
    newErrors.emergencyRelationship = 'La relación con el contacto de emergencia es obligatoria';
  }
  if (!formData.contact.emergencyContact.phone) {
    newErrors.emergencyPhone = 'El teléfono del contacto de emergencia es obligatorio';
  }
}
```

**Backend Joi** (lignes 102-106):
```javascript
emergency_contact: Joi.object({
  name: Joi.string().required(),      // ⚠️ Required si object présent
  phone: atomicSchemas.phone.required(),  // ⚠️ Required si object présent
  relationship: Joi.string().optional()
}).optional(),
```

**Incohérence**:
- Frontend: relationship obligatoire si name fourni
- Backend: relationship optionnel même si object fourni
- Backend: phone et name required SEULEMENT si l'object emergency_contact est envoyé

**Impact**: Validation plus stricte frontend que backend (bien pour UX).

---

### Frontend - Email et Téléphone (lignes 147-155)

**Validations de format**:

```javascript
// Email - Si fourni
if (formData.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact.email)) {
  newErrors.email = 'Formato de email inválido';
}

// Téléphone - Si fourni
if (formData.contact.phone && !/^[\+]?[\d\s\-\(\)]{9,}$/.test(formData.contact.phone)) {
  newErrors.phone = 'Formato de teléfono inválido';
}
```

**Backend Joi**:
```javascript
email: Joi.string().email().lowercase().trim().optional(),
phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).optional(),
```

**Différences**:
| Validation | Frontend | Backend Joi | Cohérent? |
|------------|----------|-------------|-----------|
| Email regex | Basique `^[^\s@]+@[^\s@]+\.[^\s@]+$` | Joi .email() (RFC 5322) | ⚠️ Backend plus strict |
| Phone min chars | 9+ | 8-20 | ⚠️ Différent (9 vs 8) |
| Phone format | `[\+]?[\d\s\-\(\)]{9,}` | `[\+]?[0-9\s\-\(\)]{8,20}` | ⚠️ Frontend pas de max |

**Recommandation**: Aligner les regex exactement.

---

## 🔍 DÉTECTION DE DOUBLONS

### Frontend (lignes 89-125)

**Logique de détection**:
```javascript
useEffect(() => {
  if (formData.firstName && formData.lastName && formData.birthDate) {
    checkDuplicates();
  } else {
    setDuplicateWarning(null);
  }
}, [formData.firstName, formData.lastName, formData.birthDate]);
```

**Critères**:
- Même `firstName` ET `lastName` ET `email`
- Recherche locale dans `patientContext` (patients déjà chargés)
- Bloque la création si doublon trouvé (ligne 178-181)

**Backend**:
- ❌ Aucune détection de doublons côté API
- ⚠️ Risque si frontend bypassed ou multiples utilisateurs simultanés

**Recommandation**:
```javascript
// Ajouter dans routes/patients.js
onBeforeCreate: async (data, user, clinicDb) => {
  const Patient = await getModel(clinicDb, 'Patient');

  // Vérifier doublons exacts
  const duplicate = await Patient.findOne({
    where: {
      first_name: data.first_name,
      last_name: data.last_name,
      birth_date: data.birth_date
    }
  });

  if (duplicate) {
    throw new Error('Un patient avec ces informations existe déjà');
  }

  return data;
}
```

---

## 📝 TABLEAU RÉCAPITULATIF

### Champs Obligatoires par Couche

| Champ | Frontend | Backend Joi | Database | Cohérent? | Action |
|-------|----------|-------------|----------|-----------|--------|
| **facility_id** | ❌ Absent | ⚠️ Optional | ✅ Required | ❌ | Ajouter default dans route |
| **first_name** | ✅ Required | ✅ Required | ✅ Required | ✅ | OK |
| **last_name** | ✅ Required | ✅ Required | ✅ Required | ✅ | OK |
| **birth_date** | ✅ Required | ❌ Optional | ✅ Required | ❌ | **CORRIGER Joi** |
| **gender** | ✅ Required | ❌ Optional | ⚠️ Optional | ❌ | **DÉCISION: Required partout?** |
| **idNumber** | ✅ Required | ❌ Absent | ❌ Absent | ❌ | **MAPPER ou SUPPRIMER** |
| email | ⚠️ Format | ⚠️ Format | ⚠️ Format | ⚠️ | Aligner regex |
| phone | ⚠️ Format | ⚠️ Format | ⚠️ Optional | ⚠️ | Aligner regex |

---

## 🔧 CORRECTIONS NÉCESSAIRES

### Priorité CRITIQUE

#### 1. Corriger birth_date dans validationSchemas.js

**Fichier**: `/var/www/medical-pro-backend/src/base/validationSchemas.js`

```javascript
// AVANT (ligne 85)
birth_date: Joi.date().optional(),

// APRÈS
birth_date: Joi.date().iso().required().messages({
  'date.base': 'Birth date must be a valid date',
  'any.required': 'Birth date is required'
}),
```

#### 2. Décider du statut de gender

**Option A - Obligatoire partout** (recommandé pour dossiers médicaux):
```javascript
// validationSchemas.js
gender: Joi.string().valid('M', 'F', 'O', 'N/A').required(),

// Patient.js
gender: {
  type: DataTypes.STRING(10),
  allowNull: false,  // ✅ Obligatoire
  validate: { isIn: [['M', 'F', 'O', 'N/A']] }
}
```

**Option B - Optionnel partout** (si politique confidentialité):
```javascript
// PatientFormModal.js - Supprimer lignes 140-142
// if (!formData.gender) {
//   newErrors.gender = 'El sexo es obligatorio';
// }
```

#### 3. Gérer idNumber

**Option A - Mapper vers social_security**:
```javascript
// dataTransform.js - transformPatientToBackend
social_security_number: patient.idNumber,

// validationSchemas.js - Ajouter
id_number: Joi.string().max(50).optional(),

// OU mapper différemment selon pays
// Espagne: DNI/NIE
// France: Numéro sécu
```

**Option B - Ajouter colonne id_number**:
```sql
ALTER TABLE patients ADD COLUMN id_number VARCHAR(50);
```

#### 4. Vérifier facility_id default

**Fichier**: `/var/www/medical-pro-backend/src/routes/patients.js`

Vérifier qu'il existe:
```javascript
const patientRoutes = clinicCrudRoutes('Patient', {
  // ...
  onBeforeCreate: async (data, user, clinicDb) => {
    if (!data.facility_id) {
      data.facility_id = '00000000-0000-0000-0000-000000000001';
    }
    return data;
  }
});
```

---

### Priorité MOYENNE

#### 5. Aligner validations email/phone

```javascript
// Frontend - PatientFormModal.js lignes 148-155
// AVANT
if (formData.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact.email))
if (formData.contact.phone && !/^[\+]?[\d\s\-\(\)]{9,}$/.test(formData.contact.phone))

// APRÈS - Utiliser mêmes patterns que backend
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;  // Ou déléguer à backend
const phoneRegex = /^[\+]?[0-9\s\-\(\)]{8,20}$/;  // Aligné avec Joi
```

#### 6. Ajouter détection doublons backend

Voir code dans section "Détection de Doublons" ci-dessus.

---

## ✅ CHECKLIST DE VÉRIFICATION

Avant déploiement en production:

- [ ] birth_date obligatoire dans Joi schema
- [ ] gender: décision prise et appliquée partout
- [ ] idNumber mappé ou supprimé du frontend
- [ ] facility_id default vérifié dans route
- [ ] Validations email/phone alignées
- [ ] Détection doublons backend ajoutée
- [ ] Tests création patient avec champs minimum
- [ ] Tests création patient avec tous champs
- [ ] Tests validation erreurs (champs manquants)
- [ ] Tests validation format (email/phone invalides)
- [ ] Documentation mise à jour

---

## 📋 EXEMPLE DE PAYLOAD MINIMUM

### Frontend → Backend (après transformation)

```json
{
  "first_name": "Juan",
  "last_name": "García",
  "birth_date": "1985-05-15",
  "gender": "M"
}
```

**Résultat actuel**: ❌ ÉCHEC
- Backend Joi: ✅ Passe (birth_date optionnel)
- Database: ❌ birth_date accepté, gender accepté NULL

**Résultat après corrections**:
```json
{
  "facility_id": "00000000-0000-0000-0000-000000000001",  // Ajouté par route
  "first_name": "Juan",
  "last_name": "García",
  "birth_date": "1985-05-15",
  "gender": "M"
}
```
- Backend Joi: ✅ Passe
- Database: ✅ Insertion réussie

---

## 📖 EXEMPLE COMPLET

### Payload Complet avec Tous Champs Optionnels

```json
{
  "facility_id": "00000000-0000-0000-0000-000000000001",
  "first_name": "María",
  "last_name": "Rodríguez García",
  "birth_date": "1990-03-20",
  "gender": "F",
  "nationality": "Española",
  "email": "maria.rodriguez@example.com",
  "phone": "+34612345678",
  "mobile": "+34698765432",
  "address_line1": "Calle Mayor 123",
  "address_line2": "Piso 2, Puerta B",
  "postal_code": "28001",
  "city": "Madrid",
  "country": "ES",
  "emergency_contact_name": "Pedro Rodríguez",
  "emergency_contact_phone": "+34611223344",
  "emergency_contact_relationship": "Hermano",
  "insurance_provider": "Adeslas",
  "insurance_number": "12345678",
  "blood_type": "A+",
  "allergies": "Penicilina",
  "chronic_conditions": "Hipertensión",
  "current_medications": "Enalapril 10mg"
}
```

---

**Auteur**: Claude Code
**Date**: 2025-12-06
**Version**: 1.0.0
