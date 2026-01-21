# Analyse des Incohérences Frontend-Backend

**Date**: 2025-12-06
**Status**: 🔍 EN COURS D'ANALYSE

## Résumé Exécutif

Analyse complète des incompatibilités de données entre le frontend React et le backend Node.js/Express.

## 1. PATIENTS - Formulaire de Création/Modification

### ❌ CRITIQUE: Gender (Sexe)

**Fichier Frontend**: `/var/www/medical-pro/src/components/dashboard/modals/PatientFormModal.js:352-356`

**Valeurs Frontend** (envoyées):
```javascript
<option value="">Seleccionar sexo</option>
<option value="male">Masculino</option>
<option value="female">Femenino</option>
<option value="other">Otro</option>
```

**Valeurs Backend Attendues**: `/var/www/medical-pro-backend/src/base/validationSchemas.js:31`
```javascript
gender: Joi.string().valid('M', 'F', 'O', 'N/A').optional()
```

**Impact**: ❌ BLOQUANT - Validation Error
```json
{
  "error": {
    "message": "Validation Error",
    "details": "\"gender\" must be one of [M, F, O, N/A]"
  }
}
```

**Transformation**: La transformation `dataTransform.transformPatientToBackend()` envoie la valeur telle quelle sans conversion:
```javascript
// dataTransform.js:109
gender: patient.gender, // ❌ Pas de transformation des valeurs
```

**Solution Requise**:
- Option 1: Frontend envoie "M", "F", "O", "N/A" directement
- Option 2: dataTransform convertit "male" → "M", "female" → "F", "other" → "O"
- Option 3: Backend accepte les deux formats

---

### ⚠️ Champs Structurés vs Plats

**Frontend**: Structure imbriquée
```javascript
formData = {
  firstName: 'Jean',
  lastName: 'Dupont',
  contact: {
    email: 'jean@test.com',
    phone: '+33612345678',
    emergencyContact: {
      name: 'Marie Dupont',
      relationship: 'Cónyuge',
      phone: '+33698765432'
    }
  },
  address: {
    street: 'Rue de la Paix',
    city: 'Paris',
    postalCode: '75001',
    country: 'España'
  },
  insurance: {
    provider: 'Seguridad Social',
    number: '123456789',
    type: 'Pública'
  }
}
```

**Backend Attendu** (après transformation):
```javascript
{
  first_name: 'Jean',
  last_name: 'Dupont',
  email: 'jean@test.com',
  phone: '+33612345678',
  // ❌ MANQUE: emergency contact fields mapping
  address_line1: undefined, // ⚠️ address.street pas mappé
  city: undefined,          // ⚠️ address.city pas mappé
  postal_code: undefined,   // ⚠️ address.postalCode pas mappé
  country: undefined        // ⚠️ address.country pas mappé
}
```

**Problème**: La transformation `transformPatientToBackend` ne mappe pas correctement:
- `address.street` → `address_line1`
- Contact d'urgence
- Assurance

**Fichier**: `/var/www/medical-pro/src/api/dataTransform.js:101-130`

---

### ⚠️ Champs Manquants dans la Transformation

**Champs Frontend Non Envoyés au Backend**:

1. **Emergency Contact** (Contact d'urgence)
   - `formData.contact.emergencyContact.name`
   - `formData.contact.emergencyContact.relationship`
   - `formData.contact.emergencyContact.phone`
   - Backend attendu: `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relationship`

2. **Insurance** (Assurance)
   - `formData.insurance.provider`
   - `formData.insurance.number`
   - `formData.insurance.type`
   - Backend attendu: `insurance_info` (objet JSON)

3. **ID Number**
   - `formData.idNumber`
   - Backend attendu: `social_security_number` ou nouveau champ

4. **Nationality**
   - `formData.nationality`
   - Backend: pas de champ correspondant dans le schéma

---

## 2. VALIDATION SCHEMAS - Comparaison Complète

### Backend Schema (createPatientSchema)

```javascript
// /var/www/medical-pro-backend/src/base/validationSchemas.js:78-113
{
  facility_id: Joi.string().uuid().optional(),
  first_name: required,
  last_name: required,
  email: optional,
  phone: optional,
  mobile: optional,
  birth_date: optional,
  date_of_birth: optional, // backward compatibility
  gender: 'M' | 'F' | 'O' | 'N/A',
  social_security_number: optional (15 digits),
  patient_number: optional,
  address_line1: optional,
  address_line2: optional,
  postal_code: optional,
  city: optional,
  country: optional (2 chars),
  address: optional (objet),
  blood_type: optional,
  allergies: optional,
  chronic_conditions: optional,
  current_medications: optional,
  medical_history: optional (objet),
  emergency_contact: {
    name: required,
    phone: required,
    relationship: optional
  },
  insurance_info: {
    company: optional,
    policy_number: optional,
    coverage_type: optional
  },
  is_incomplete: optional,
  notes: optional
}
```

### Frontend Form Fields

```javascript
// PatientFormModal.js - Champs disponibles
{
  firstName: ✅
  lastName: ✅
  birthDate: ✅ (mappé à date_of_birth)
  gender: ❌ VALEURS INCOMPATIBLES
  idNumber: ⚠️ (pas mappé)
  nationality: ⚠️ (pas dans backend)

  address: {
    street: ⚠️ (devrait être address_line1)
    city: ✅
    postalCode: ✅ (mappé à postal_code)
    country: ✅
  },

  contact: {
    phone: ✅
    email: ✅
    emergencyContact: {
      name: ⚠️ (pas mappé)
      relationship: ⚠️ (pas mappé)
      phone: ⚠️ (pas mappé)
    }
  },

  insurance: {
    provider: ⚠️ (pas mappé à insurance_info.company)
    number: ⚠️ (pas mappé à insurance_info.policy_number)
    type: ⚠️ (pas mappé à insurance_info.coverage_type)
  },

  status: ✅ (mais backend n'a pas de champ status dans schema)
}
```

---

## 3. CHAMPS À CORRIGER PAR PRIORITÉ

### 🔴 PRIORITÉ 1 - BLOQUANTS

1. **Gender Values Mismatch**
   - Frontend: "male", "female", "other"
   - Backend: "M", "F", "O", "N/A"
   - Fix: Modifier les valeurs du select OU ajouter transformation

### 🟡 PRIORITÉ 2 - DONNÉES PERDUES

2. **Emergency Contact Not Sent**
   - Frontend collecte les données
   - Backend ne les reçoit jamais
   - Fix: Ajouter mapping dans transformPatientToBackend

3. **Insurance Info Not Sent**
   - Frontend collecte provider, number, type
   - Backend ne les reçoit jamais
   - Fix: Ajouter mapping dans transformPatientToBackend

4. **Address Structure**
   - Frontend: address.street
   - Backend: address_line1
   - Fix: Mapper correctement dans transformation

### 🟢 PRIORITÉ 3 - CHAMPS OPTIONNELS

5. **ID Number (idNumber)**
   - Frontend collecte mais n'envoie pas
   - Backend a social_security_number mais format différent (15 digits)
   - Fix: Décider du mapping ou créer nouveau champ

6. **Nationality**
   - Frontend collecte
   - Backend n'a pas de champ
   - Fix: Ajouter au schema backend ou retirer du frontend

---

## 4. AUTRES FORMULAIRES À VÉRIFIER

### Appointments (Rendez-vous)
- ⏳ À analyser

### Healthcare Providers (Praticiens)
- ⏳ À analyser

### Medical Records
- ⏳ À analyser

---

## 5. RECOMMANDATIONS

### Approche Recommandée

1. **Court Terme** (Fix Immédiat):
   - Corriger gender values dans PatientFormModal.js
   - Corriger transformPatientToBackend pour tous les champs

2. **Moyen Terme**:
   - Créer des tests automatisés frontend-backend
   - Valider les transformations avec des tests unitaires
   - Documenter les mappings dans un fichier central

3. **Long Terme**:
   - Générer les types TypeScript depuis les schemas Joi
   - Partager les définitions entre frontend et backend
   - CI/CD avec validation automatique des contrats API

---

## 6. FICHIERS À MODIFIER

### Frontend
1. ✅ `/var/www/medical-pro/src/components/dashboard/modals/PatientFormModal.js`
   - Corriger gender options (lignes 352-356)

2. ✅ `/var/www/medical-pro/src/api/dataTransform.js`
   - Compléter transformPatientToBackend (lignes 101-130)
   - Ajouter emergency_contact mapping
   - Ajouter insurance_info mapping
   - Corriger address mapping

### Backend
3. ⚠️ `/var/www/medical-pro-backend/src/base/validationSchemas.js`
   - Optionnel: Accepter "male"/"female"/"other" en plus de "M"/"F"/"O"
   - Ajouter nationality si nécessaire
   - Ajouter id_number distinct de social_security_number

---

## ANNEXE: Tests de Validation

### Test Case 1: Create Patient avec Gender

**Request**:
```json
POST /api/v1/patients
{
  "first_name": "Test",
  "last_name": "Patient",
  "gender": "male",
  "birth_date": "1990-01-01"
}
```

**Expected**: ❌ Validation Error
**Actual**: ❌ Validation Error
**Status**: CONFIRMÉ - Bug reproductible

### Test Case 2: Create Patient avec Gender Corrigé

**Request**:
```json
POST /api/v1/patients
{
  "first_name": "Test",
  "last_name": "Patient",
  "gender": "M",
  "birth_date": "1990-01-01"
}
```

**Expected**: ✅ Success
**Status**: À TESTER après correction

---

**Dernière mise à jour**: 2025-12-06 01:45 UTC
**Analysé par**: Claude Code
