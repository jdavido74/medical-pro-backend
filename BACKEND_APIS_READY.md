# Backend APIs - Configuration Clinique ✅

## Résumé

Les APIs backend sont maintenant créées et prêtes à être utilisées pour gérer la configuration de la clinique.

## ✅ Migrations Appliquées

1. **011_add_provider_availability.sql** - Ajout du champ `availability` et `color` à `healthcare_providers`
2. **012_create_clinic_roles.sql** - Création de la table `clinic_roles`
3. **013_create_clinic_settings.sql** - Création de la table `clinic_settings`

## ✅ Routes Créées

Toutes les routes utilisent le middleware `clinicRoutingMiddleware` pour accéder à la base clinic correcte.

### 1. Healthcare Providers (Utilisateurs de la clinique)

**Base URL**: `/api/v1/healthcare-providers`

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/` | Liste tous les utilisateurs (praticiens, infirmiers, secrétaires, etc.) |
| GET | `/:id` | Récupérer un utilisateur par ID |
| POST | `/` | Créer un nouvel utilisateur |
| PUT | `/:id` | Mettre à jour un utilisateur |
| DELETE | `/:id` | Désactiver un utilisateur |

**Query params** (GET liste):
- `page` (default: 1)
- `limit` (default: 100)
- `search` (recherche dans nom, email, profession)
- `role` (super_admin, admin, practitioner, nurse, secretary, readonly)
- `is_active` (true/false)

**Exemple POST** (Créer un utilisateur):
```json
{
  "facility_id": "uuid-de-l-etablissement",
  "email": "marie.dubois@clinic.com",
  "password_hash": "SuperSecure123!",
  "first_name": "Marie",
  "last_name": "Dubois",
  "title": "Dr.",
  "profession": "Médecin",
  "specialties": ["Médecine Générale"],
  "role": "practitioner",
  "phone": "+33123456789",
  "availability": {
    "monday": {
      "enabled": true,
      "slots": [
        {"start": "09:00", "end": "12:00"},
        {"start": "14:00", "end": "18:00"}
      ]
    }
  },
  "color": "blue"
}
```

### 2. Clinic Settings (Configuration de la clinique)

**Base URL**: `/api/v1/clinic-settings`

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/` | Récupérer la configuration (crée les défauts si n'existe pas) |
| PUT | `/` | Mettre à jour la configuration |
| POST | `/closed-dates` | Ajouter une date de fermeture |
| DELETE | `/closed-dates/:dateId` | Supprimer une date de fermeture |

**Exemple PUT** (Mettre à jour les horaires):
```json
{
  "operating_hours": {
    "monday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "tuesday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "friday": {"enabled": true, "start": "08:00", "end": "17:00"},
    "saturday": {"enabled": false}
  },
  "slot_settings": {
    "defaultDuration": 30,
    "bufferTime": 5,
    "maxAdvanceBooking": 90
  }
}
```

**Exemple POST** (Ajouter date de fermeture):
```json
{
  "date": "2025-12-25",
  "reason": "Noël",
  "type": "holiday"
}
```

### 3. Clinic Roles (Rôles personnalisés)

**Base URL**: `/api/v1/clinic-roles`

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/` | Liste tous les rôles |
| GET | `/:id` | Récupérer un rôle par ID |
| POST | `/` | Créer un nouveau rôle personnalisé |
| PUT | `/:id` | Mettre à jour un rôle (sauf system roles) |
| DELETE | `/:id` | Supprimer un rôle (sauf system roles) |

**Exemple POST** (Créer un rôle):
```json
{
  "name": "Technicien de laboratoire",
  "description": "Accès limité aux résultats de laboratoire",
  "level": 40,
  "permissions": [
    "patients.view",
    "medical_records.view",
    "medical_records.create"
  ],
  "color": "cyan"
}
```

### 4. Facilities (Profil établissement / Company Settings)

**Base URL**: `/api/v1/facilities`

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/current` | Récupérer le profil de l'établissement actuel |
| PUT | `/current` | Mettre à jour le profil de l'établissement |

**Exemple PUT** (Mettre à jour le profil):
```json
{
  "name": "Cabinet Médical Dubois",
  "address_line1": "123 Rue de la Santé",
  "postal_code": "75014",
  "city": "Paris",
  "phone": "+33123456789",
  "email": "contact@cabinet-dubois.fr",
  "website": "https://cabinet-dubois.fr",
  "specialties": ["Médecine Générale", "Pédiatrie"]
}
```

## 📋 Schémas de Validation

Tous les schémas se trouvent dans `/src/base/clinicConfigSchemas.js`:

- `createHealthcareProviderSchema` - Création utilisateur
- `updateHealthcareProviderSchema` - Mise à jour utilisateur
- `clinicSettingsSchema` - Configuration clinique
- `updateClinicSettingsSchema` - Mise à jour configuration
- `createClinicRoleSchema` - Création rôle
- `updateClinicRoleSchema` - Mise à jour rôle
- `updateFacilitySchema` - Mise à jour établissement

## 🔐 Authentification

Toutes les routes nécessitent :
1. **authMiddleware** - Token JWT valide dans le header `Authorization: Bearer <token>`
2. **clinicRoutingMiddleware** - Extrait le `companyId` du JWT et route vers la bonne base clinic

## 🧪 Tester les APIs

```bash
# 1. Login pour obtenir un token
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"josedavid.orts@gmail.com","password":"Vistule94!"}'

# Extraire le token de la réponse
TOKEN="<votre-token>"

# 2. Lister les utilisateurs de la clinique
curl -X GET http://localhost:3001/api/v1/healthcare-providers \
  -H "Authorization: Bearer $TOKEN"

# 3. Récupérer la configuration de la clinique
curl -X GET http://localhost:3001/api/v1/clinic-settings \
  -H "Authorization: Bearer $TOKEN"

# 4. Récupérer le profil de l'établissement
curl -X GET http://localhost:3001/api/v1/facilities/current \
  -H "Authorization: Bearer $TOKEN"
```

## 📊 Structure de Données

### Healthcare Provider (utilisateur)
```json
{
  "id": "uuid",
  "facility_id": "uuid",
  "email": "user@clinic.com",
  "first_name": "Marie",
  "last_name": "Dubois",
  "title": "Dr.",
  "profession": "Médecin",
  "specialties": ["Médecine Générale"],
  "role": "practitioner",
  "permissions": {},
  "phone": "+33123456789",
  "availability": {
    "monday": {
      "enabled": true,
      "slots": [{"start": "09:00", "end": "12:00"}]
    }
  },
  "color": "blue",
  "is_active": true,
  "email_verified": false,
  "last_login": "2025-12-07T10:00:00Z",
  "created_at": "2025-12-01T10:00:00Z",
  "updated_at": "2025-12-07T10:00:00Z"
}
```

### Clinic Settings
```json
{
  "id": "uuid",
  "facility_id": "uuid",
  "operating_hours": {
    "monday": {"enabled": true, "start": "08:00", "end": "18:00"}
  },
  "slot_settings": {
    "defaultDuration": 30,
    "bufferTime": 5,
    "maxAdvanceBooking": 90
  },
  "closed_dates": [
    {"id": "uuid", "date": "2025-12-25", "reason": "Noël", "type": "holiday"}
  ],
  "appointment_types": [...],
  "notifications": {...}
}
```

## ⚠️ Points d'Attention

1. **Mapping camelCase ↔ snake_case** :
   - Frontend: `firstName`, `lastName`, `specialties` (avec IES)
   - Backend: `first_name`, `last_name`, `specialties` (JSONB array)

2. **speciality vs specialty** :
   - Frontend LocalStorage utilise "speciality" (avec Y)
   - Backend utilise "specialties" (pluriel, avec IES)
   - La transformation sera gérée dans `dataTransform.js`

3. **Permissions** :
   - Format backend: JSONB object `{}` pour les utilisateurs
   - Format rôles: JSONB array `["patients.view", ...]`

## 🚀 Prochaines Étapes

1. ✅ Migrations créées et appliquées
2. ✅ Schémas de validation créés
3. ✅ Routes backend créées et enregistrées
4. ⏳ **PROCHAINE**: Créer `dataTransform.js` pour transformer les données
5. ⏳ Créer les clients API frontend
6. ⏳ Connecter les composants frontend aux APIs
