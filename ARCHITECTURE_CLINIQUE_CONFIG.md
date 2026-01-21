# Architecture Base de Données - Configuration Clinique

## Vue d'ensemble

L'architecture suit un modèle multi-tenant avec :
- **Base centrale** (`medicalpro_central`) : Gestion des companies et admins
- **Bases cliniques** (`medicalpro_clinic_<clinic_id>`) : Données isolées par clinique

## Structure Actuelle - Base Clinic

### 1. `medical_facilities` - Les établissements

**Utilisation** : Chaque clinique peut avoir PLUSIEURS établissements (cabinets, centres, etc.)

**Champs clés pour la configuration** :
```sql
settings JSONB DEFAULT '{}'::jsonb  -- Configuration horaires, créneaux, etc.
specialties JSONB DEFAULT '[]'::jsonb
services JSONB DEFAULT '[]'::jsonb
timezone VARCHAR(50) DEFAULT 'Europe/Paris'
language VARCHAR(5) DEFAULT 'fr-FR'
```

**Structure proposée pour `settings` JSONB** :
```json
{
  "operatingHours": {
    "monday": { "enabled": true, "start": "08:00", "end": "18:00" },
    "tuesday": { "enabled": true, "start": "08:00", "end": "18:00" },
    ...
  },
  "slotSettings": {
    "defaultDuration": 30,
    "availableDurations": [15, 20, 30, 45, 60],
    "bufferTime": 5,
    "maxAdvanceBooking": 90,
    "minAdvanceBooking": 1
  },
  "closedDates": [
    { "date": "2025-12-25", "reason": "Noël", "type": "holiday" }
  ],
  "appointmentTypes": [
    { "id": "consultation", "name": "Consultation", "duration": 30, "color": "blue" }
  ],
  "notifications": {
    "patientReminders": {
      "enabled": true,
      "timeBefore": [24, 2],
      "methods": ["email", "sms"]
    }
  }
}
```

### 2. `healthcare_providers` - TOUS les utilisateurs de la clinique

**Utilisation** : Praticiens, infirmiers, secrétaires, admins

**Champs existants** :
```sql
id UUID PRIMARY KEY
facility_id UUID NOT NULL REFERENCES medical_facilities(id)
email VARCHAR(255) UNIQUE NOT NULL
password_hash VARCHAR(255) NOT NULL
first_name VARCHAR(100) NOT NULL
last_name VARCHAR(100) NOT NULL
profession VARCHAR(100) NOT NULL  -- médecin, infirmier, secrétaire, etc.
role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'admin', 'practitioner', 'nurse', 'secretary', 'readonly'))
permissions JSONB DEFAULT '{}'::jsonb
specialties JSONB DEFAULT '[]'::jsonb
```

**Champs à ajouter** :
```sql
-- À ajouter via migration
availability JSONB DEFAULT '{}'::jsonb  -- Disponibilités par jour de la semaine
```

**Structure proposée pour `availability` JSONB** :
```json
{
  "monday": {
    "enabled": true,
    "slots": [
      { "start": "09:00", "end": "12:00" },
      { "start": "14:00", "end": "18:00" }
    ]
  },
  "tuesday": {
    "enabled": true,
    "slots": [...]
  },
  ...
}
```

## Migrations Nécessaires

### Migration 1 : Ajouter `availability` à `healthcare_providers`

```sql
-- Fichier: migrations/011_add_provider_availability.sql
ALTER TABLE healthcare_providers
ADD COLUMN availability JSONB DEFAULT '{
  "monday": {"enabled": true, "slots": []},
  "tuesday": {"enabled": true, "slots": []},
  "wednesday": {"enabled": true, "slots": []},
  "thursday": {"enabled": true, "slots": []},
  "friday": {"enabled": true, "slots": []},
  "saturday": {"enabled": false, "slots": []},
  "sunday": {"enabled": false, "slots": []}
}'::jsonb;
```

### Migration 2 (Optionnelle) : Table `clinic_roles` pour rôles personnalisés

```sql
-- Fichier: migrations/012_create_clinic_roles.sql
CREATE TABLE clinic_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID REFERENCES medical_facilities(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    description TEXT,
    level INTEGER NOT NULL DEFAULT 50,  -- Niveau de priorité
    is_system_role BOOLEAN DEFAULT false,

    permissions JSONB DEFAULT '[]'::jsonb,  -- Array de permissions
    color VARCHAR(20) DEFAULT 'gray',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(facility_id, name)
);

CREATE INDEX idx_clinic_roles_facility ON clinic_roles(facility_id);
```

### Migration 3 (Optionnelle) : Table `clinic_settings` centralisée

Si vous préférez une table dédiée plutôt que `medical_facilities.settings` :

```sql
-- Fichier: migrations/013_create_clinic_settings.sql
CREATE TABLE clinic_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID UNIQUE NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,

    -- Horaires d'ouverture
    operating_hours JSONB DEFAULT '{}'::jsonb,

    -- Configuration des créneaux
    slot_settings JSONB DEFAULT '{
      "defaultDuration": 30,
      "bufferTime": 5,
      "maxAdvanceBooking": 90,
      "minAdvanceBooking": 1
    }'::jsonb,

    -- Jours de fermeture
    closed_dates JSONB DEFAULT '[]'::jsonb,

    -- Types de rendez-vous
    appointment_types JSONB DEFAULT '[]'::jsonb,

    -- Notifications
    notifications JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clinic_settings_facility ON clinic_settings(facility_id);
```

## Mapping Frontend ↔ Backend

### Utilisateurs (LocalStorage → healthcare_providers)

**LocalStorage** :
```javascript
{
  id: 'user_1',
  email: 'admin@clinic.com',
  firstName: 'Marie',
  lastName: 'Dubois',
  role: 'admin',
  department: 'Direction',  // ← À mapper vers profession
  speciality: 'Gestion',     // ← À mapper vers specialties
  licenseNumber: 'A001'      // ← À mapper vers order_number
}
```

**Backend** (snake_case) :
```json
{
  "id": "uuid",
  "email": "admin@clinic.com",
  "first_name": "Marie",
  "last_name": "Dubois",
  "role": "admin",
  "profession": "Direction",
  "specialties": ["Gestion"],
  "order_number": "A001"
}
```

### Praticiens (LocalStorage → healthcare_providers)

**LocalStorage** :
```javascript
{
  id: 'prac_1',
  firstName: 'Dr. Pierre',
  lastName: 'Martin',
  speciality: 'Cardiologie',  // ⚠️ NOTE: "speciality" avec Y
  license: 'CA789012',
  type: 'doctor',
  color: 'red',
  availability: {
    monday: { enabled: true, slots: [...] }
  }
}
```

**Backend** (snake_case) :
```json
{
  "id": "uuid",
  "first_name": "Dr. Pierre",
  "last_name": "Martin",
  "profession": "médecin",
  "specialties": ["Cardiologie"],  // ⚠️ NOTE: "specialties" avec IES au pluriel
  "rpps": "CA789012",
  "role": "practitioner",
  "availability": {
    "monday": { "enabled": true, "slots": [...] }
  }
}
```

### Configuration Clinique (LocalStorage → medical_facilities.settings)

**LocalStorage** :
```javascript
{
  operatingHours: { monday: {...}, ... },
  slotSettings: { defaultDuration: 30, ... },
  closedDates: [...],
  appointmentTypes: [...]
}
```

**Backend** (dans `medical_facilities.settings` JSONB) :
```json
{
  "operating_hours": { "monday": {...}, ... },
  "slot_settings": { "default_duration": 30, ... },
  "closed_dates": [...],
  "appointment_types": [...]
}
```

## Points d'Attention - Cohérence camelCase/snake_case

### ⚠️ Pièges à éviter (comme avec patients)

1. **speciality vs specialty** :
   - Frontend utilise "speciality" (avec Y)
   - Backend pourrait utiliser "specialty" (sans Y) ou "specialties" (pluriel)
   - **DÉCISION** : Uniformiser sur "specialties" (pluriel) côté backend

2. **Champs imbriqués** :
   - `data.data` vs `response.data`
   - Toujours utiliser `response.data` directement, sans `unwrapResponse` quand on a besoin de pagination

3. **Empty values** :
   - Backend doit accepter `null`, `''`, `[]`, `{}` avec `.allow(null, '').optional()`
   - Frontend doit nettoyer avec `isEmpty()` avant d'envoyer

4. **Validation schema create vs update** :
   - TOUJOURS aligner les champs
   - Update = tous les champs du create en `.optional()`

## Prochaines Étapes

1. ✅ Créer les migrations manquantes
2. ⏳ Créer les schémas de validation Joi
3. ⏳ Créer les routes backend
4. ⏳ Créer dataTransform.js
5. ⏳ Créer les API clients frontend
6. ⏳ Connecter les composants
7. ⏳ Script de migration LocalStorage → Backend
