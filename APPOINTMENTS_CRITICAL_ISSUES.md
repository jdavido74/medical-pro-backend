# 🚨 PROBLÈMES CRITIQUES - Module Rendez-vous

**Date**: 2025-12-06
**Statut**: ❌ **NON FONCTIONNEL** - Incohérences majeures Frontend-Backend

## Résumé Exécutif

Le module Rendez-vous présente des **incompatibilités critiques** entre:
1. Le frontend (formulaire + API client)
2. Le backend (validation schema)
3. La base de données (modèle Sequelize)

**Impact**: Les rendez-vous ne peuvent PAS être créés/modifiés via l'API.

---

## 🔴 PROBLÈME #1: NOMS DE CHAMPS INCOMPATIBLES

### practitioner_id vs provider_id

**Frontend envoie**:
```javascript
{
  practitioner_id: "uuid-here"
}
```

**Backend attend** (modèle DB):
```javascript
{
  provider_id: "uuid-here"  // ❌ DIFFÉRENT!
}
```

**Fichiers concernés**:
- Frontend: `/var/www/medical-pro/src/api/appointmentsApi.js:226`
- Backend: `/var/www/medical-pro-backend/src/models/clinic/Appointment.js:46`

**Conséquence**: ❌ **Erreur SQL** - Colonne practitioner_id n'existe pas

---

## 🔴 PROBLÈME #2: FORMAT DATE/HEURE INCOMPATIBLE

### ISO Timestamp vs Date + Time séparés

**Frontend envoie**:
```javascript
{
  start_time: "2025-12-06T14:30:00.000Z",  // ISO timestamp complet
  end_time: "2025-12-06T15:00:00.000Z"     // ISO timestamp complet
}
```

**Backend attend** (modèle DB):
```javascript
{
  appointment_date: "2025-12-06",   // DATEONLY
  start_time: "14:30:00",           // TIME uniquement
  end_time: "15:00:00"              // TIME uniquement
}
```

**Fichiers concernés**:
- Frontend: `/var/www/medical-pro/src/api/appointmentsApi.js:209-222`
- Backend: `/var/www/medical-pro-backend/src/models/clinic/Appointment.js:64-75`

**Conséquence**: ❌ **Erreur de type** - PostgreSQL TIME vs TIMESTAMP

---

## 🔴 PROBLÈME #3: VALIDATION SCHEMA INCOMPATIBLE AVEC MODÈLE

### Le schéma Joi ne correspond PAS au modèle Sequelize

**Validation Joi** (validationSchemas.js):
```javascript
{
  patient_id: UUID required,
  practitioner_id: UUID required,     // ❌ Model utilise provider_id!
  start_time: ISO date required,      // ❌ Model utilise TIME + date séparée!
  end_time: ISO date required,        // ❌ Model utilise TIME + date séparée!
  reason: optional,                   // ✅ OK
  notes: object optional,             // ❌ Model utilise TEXT!
  status: optional                    // ✅ OK
}
```

**Modèle Sequelize** (Appointment.js):
```javascript
{
  facility_id: UUID required,         // ❌ Manquant dans validation!
  patient_id: UUID required,          // ✅ OK
  provider_id: UUID required,         // ❌ Validation dit practitioner_id!
  appointment_number: STRING,         // ❌ Manquant dans validation!
  appointment_date: DATEONLY required,// ❌ Manquant dans validation!
  start_time: TIME required,          // ❌ Validation dit ISO timestamp!
  end_time: TIME required,            // ❌ Validation dit ISO timestamp!
  duration_minutes: INTEGER,          // ❌ Manquant dans validation!
  type: STRING required,              // ❌ Manquant dans validation!
  reason: TEXT,                       // ✅ OK
  notes: TEXT,                        // ❌ Validation dit object!
  status: STRING,                     // ✅ OK
  // + 10 autres champs manquants...
}
```

**Conséquence**: ❌ La validation passe mais l'insert SQL échoue

---

## 🔴 PROBLÈME #4: CHAMPS MANQUANTS

### Champs collectés par le frontend mais PAS envoyés

**Frontend collecte** (AppointmentFormModal.js):
```javascript
{
  patientId: '',           // ✅ Envoyé
  practitionerId: '',      // ⚠️ Mauvais nom (provider_id)
  type: 'consultation',    // ❌ NON envoyé!
  title: '',               // ❌ NON envoyé!
  description: '',         // ❌ NON envoyé!
  date: '',                // ⚠️ Combiné avec time en ISO
  startTime: '',           // ⚠️ Mauvais format
  endTime: '',             // ⚠️ Mauvais format
  duration: 30,            // ❌ NON envoyé!
  status: 'scheduled',     // ✅ Envoyé
  priority: 'normal',      // ❌ NON envoyé!
  location: '',            // ❌ NON envoyé!
  notes: '',               // ⚠️ String au lieu de TEXT
  additionalSlots: [],     // ❌ NON envoyé!
  reminders: { ... }       // ❌ NON envoyé!
}
```

**Backend REQUIERT**:
- ✅ `patient_id`
- ❌ `provider_id` (reçoit practitioner_id)
- ❌ `facility_id` (jamais envoyé!)
- ❌ `appointment_date` (pas dans le bon format)
- ❌ `start_time` (TIME, pas ISO)
- ❌ `end_time` (TIME, pas ISO)
- ❌ `type` (collecté mais pas envoyé!)

---

## 🔴 PROBLÈME #5: TYPE notes INCOMPATIBLE

**Frontend transformation**:
```javascript
notes: appointment.notes || {}  // Envoie un objet vide si notes est vide
```

**Backend attend**:
```javascript
notes: DataTypes.TEXT  // String/TEXT, PAS un objet!
```

**Validation dit**:
```javascript
notes: Joi.object().optional()  // Object! ❌
```

**Conséquence**: Si notes est un objet, PostgreSQL refusera l'insert

---

## 📊 TABLEAU COMPARATIF COMPLET

| Champ Frontend | Transformé en | Backend attend | Modèle DB | Statut |
|----------------|---------------|----------------|-----------|---------|
| patientId | patient_id | patient_id | patient_id | ✅ OK |
| practitionerId | practitioner_id | practitioner_id | **provider_id** | ❌ ERREUR |
| date + startTime | start_time (ISO) | start_time (ISO) | appointment_date + start_time (TIME) | ❌ ERREUR |
| date + endTime | end_time (ISO) | end_time (ISO) | appointment_date + end_time (TIME) | ❌ ERREUR |
| type | ❌ Non envoyé | ❌ Pas dans schema | type (REQUIRED) | ❌ MANQUANT |
| duration | ❌ Non envoyé | ❌ Pas dans schema | duration_minutes | ⚠️ OPTIONNEL |
| title | ❌ Non envoyé | ❌ Pas dans schema | reason? | ⚠️ À mapper |
| description | ❌ Non envoyé | ❌ Pas dans schema | reason? | ⚠️ À mapper |
| notes (string) | notes (object) | notes (object) | notes (TEXT) | ❌ ERREUR |
| status | status | status | status | ✅ OK |
| - | ❌ Non envoyé | ❌ Pas dans schema | facility_id (REQUIRED) | ❌ MANQUANT |
| - | ❌ Non envoyé | ❌ Pas dans schema | appointment_number | ⚠️ Auto-généré |
| priority | ❌ Non envoyé | ❌ Pas dans schema | ❌ Pas dans DB | ⚠️ IGNORÉ |
| location | ❌ Non envoyé | ❌ Pas dans schema | ❌ Pas dans DB | ⚠️ IGNORÉ |
| additionalSlots | ❌ Non envoyé | ❌ Pas dans schema | ❌ Pas dans DB | ⚠️ IGNORÉ |
| reminders | ❌ Non envoyé | ❌ Pas dans schema | reminder_sent, etc. | ⚠️ À IMPLÉMENTER |

---

## 🔧 CORRECTIONS NÉCESSAIRES

### Priorité CRITIQUE (Bloquants)

#### 1. Corriger le nom du champ provider

**File**: `/var/www/medical-pro/src/api/appointmentsApi.js`

```javascript
// AVANT (ligne 226)
practitioner_id: appointment.practitionerId,

// APRÈS
provider_id: appointment.practitionerId,
```

#### 2. Corriger le format date/heure

**File**: `/var/www/medical-pro/src/api/appointmentsApi.js`

```javascript
// AVANT (lignes 209-222)
let startTime, endTime;
if (appointment.date && appointment.startTime && appointment.endTime) {
  const [startHour, startMin] = appointment.startTime.split(':');
  const [endHour, endMin] = appointment.endTime.split(':');

  startTime = new Date(`${appointment.date}T${startHour}:${startMin}:00`).toISOString();
  endTime = new Date(`${appointment.date}T${endHour}:${endMin}:00`).toISOString();
}

return {
  patient_id: appointment.patientId,
  practitioner_id: appointment.practitionerId,  // ❌
  start_time: startTime,                        // ❌ ISO
  end_time: endTime,                            // ❌ ISO
  reason: appointment.reason,
  notes: appointment.notes || {},
  status: appointment.status || 'scheduled'
};

// APRÈS
return {
  patient_id: appointment.patientId,
  provider_id: appointment.practitionerId,              // ✅ Corrigé
  appointment_date: appointment.date,                   // ✅ DATEONLY
  start_time: appointment.startTime,                    // ✅ TIME (HH:MM:SS)
  end_time: appointment.endTime,                        // ✅ TIME (HH:MM:SS)
  duration_minutes: appointment.duration,               // ✅ Ajouté
  type: appointment.type || 'consultation',             // ✅ Ajouté
  reason: appointment.title || appointment.description, // ✅ Mappé
  notes: typeof appointment.notes === 'string' ? appointment.notes : '', // ✅ TEXT
  status: appointment.status || 'scheduled'
};
```

#### 3. Ajouter facility_id

**File**: `/var/www/medical-pro/src/api/appointmentsApi.js`

```javascript
// Obtenir facility_id depuis le contexte ou utiliser default
const facility_id = appointment.facilityId || '00000000-0000-0000-0000-000000000001';

return {
  facility_id: facility_id,  // ✅ Ajouté
  patient_id: appointment.patientId,
  provider_id: appointment.practitionerId,
  // ...
};
```

#### 4. Corriger le schéma de validation

**File**: `/var/www/medical-pro-backend/src/base/validationSchemas.js`

```javascript
// AVANT
module.exports.createAppointmentSchema = Joi.object({
  patient_id: Joi.string().uuid().required(),
  practitioner_id: Joi.string().uuid().required(),  // ❌
  start_time: Joi.date().iso().required(),          // ❌
  end_time: Joi.date().iso().required(),            // ❌
  reason: atomicSchemas.reason.optional(),
  notes: Joi.object().optional(),                   // ❌
  status: atomicSchemas.appointmentStatus.default('scheduled')
});

// APRÈS
module.exports.createAppointmentSchema = Joi.object({
  facility_id: Joi.string().uuid().optional(),          // ✅ Ajouté (default si absent)
  patient_id: Joi.string().uuid().required(),
  provider_id: Joi.string().uuid().required(),          // ✅ Corrigé
  appointment_date: Joi.date().iso().required(),        // ✅ Ajouté
  start_time: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(), // ✅ TIME format
  end_time: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(),   // ✅ TIME format
  duration_minutes: Joi.number().integer().min(1).optional(),
  type: Joi.string().valid('consultation', 'followup', 'emergency', 'checkup', 'procedure', 'teleconsultation').required(),
  reason: Joi.string().max(1000).optional(),            // ✅ TEXT
  notes: Joi.string().max(5000).optional(),             // ✅ TEXT au lieu d'object
  status: atomicSchemas.appointmentStatus.default('scheduled')
});
```

#### 5. Corriger la transformation inverse (Backend → Frontend)

**File**: `/var/www/medical-pro/src/api/appointmentsApi.js`

```javascript
// AVANT (ligne 174)
practitionerId: appointment.practitioner_id,

// APRÈS
practitionerId: appointment.provider_id,  // ✅ Corrigé

// AVANT (lignes 178-180) - Format incorrect
startTime: startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
endTime: endDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),

// APRÈS - Utiliser les champs séparés
date: appointment.appointment_date,
startTime: appointment.start_time,  // Déjà au format HH:MM:SS
endTime: appointment.end_time,      // Déjà au format HH:MM:SS
duration: appointment.duration_minutes,
type: appointment.type,
```

---

## 📝 TESTS NÉCESSAIRES

### Test 1: Création de Rendez-vous

```bash
curl -X POST http://localhost:3001/api/v1/appointments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "facility_id": "00000000-0000-0000-0000-000000000001",
    "patient_id": "uuid-patient",
    "provider_id": "uuid-provider",
    "appointment_date": "2025-12-10",
    "start_time": "14:30:00",
    "end_time": "15:00:00",
    "duration_minutes": 30,
    "type": "consultation",
    "reason": "Consultation générale",
    "status": "scheduled"
  }'
```

**Attendu**: ✅ Succès avec appointment créé

### Test 2: Mapping Frontend

```javascript
// Test que le formulaire envoie les bonnes données
const formData = {
  patientId: "uuid-patient",
  practitionerId: "uuid-provider",
  date: "2025-12-10",
  startTime: "14:30",
  endTime: "15:00",
  type: "consultation",
  title: "Consultation",
  status: "scheduled"
};

const backendData = transformAppointmentToBackend(formData);

expect(backendData).toEqual({
  patient_id: "uuid-patient",
  provider_id: "uuid-provider",     // ✅ Pas practitioner_id
  appointment_date: "2025-12-10",   // ✅ Séparé
  start_time: "14:30:00",           // ✅ TIME format
  end_time: "15:00:00",             // ✅ TIME format
  type: "consultation",
  reason: "Consultation",
  status: "scheduled"
});
```

---

## 🎯 PLAN D'ACTION

### Phase 1: Corrections Critiques (Immédiat)
1. ✅ Corriger practitioner_id → provider_id
2. ✅ Corriger format date/heure (ISO → date + TIME)
3. ✅ Corriger type notes (object → TEXT)
4. ✅ Ajouter facility_id
5. ✅ Ajouter type dans transformation

### Phase 2: Validation (Court terme)
6. ✅ Mettre à jour schema de validation Joi
7. ✅ Tester création rendez-vous
8. ✅ Tester modification rendez-vous
9. ✅ Tester lecture rendez-vous

### Phase 3: Champs Optionnels (Moyen terme)
10. ⏳ Implémenter reminders mapping
11. ⏳ Implémenter additionalSlots
12. ⏳ Implémenter priority (si nécessaire dans DB)
13. ⏳ Implémenter location (si nécessaire dans DB)

---

## ⚠️ IMPACT SUR L'EXISTANT

**Risque**: ❌ **ÉLEVÉ** - Le module rendez-vous est actuellement NON FONCTIONNEL

**Actions à prendre**:
1. Vérifier si des rendez-vous existent en base
2. Tester les corrections sur environnement de dev
3. Créer des tests de non-régression
4. Documenter les changements

---

**Auteur**: Claude Code
**Date**: 2025-12-06 02:00 UTC
**Priorité**: 🔴 CRITIQUE
