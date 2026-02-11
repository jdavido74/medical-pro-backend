# Equipe de soins et visibilite des patients

## Principe

Le systeme d'equipe de soins (`patient_care_team`) controle quels praticiens ont acces a quels patients. Il implemente le **secret medical** (Article L1110-4 du CSP) : un patient n'est visible que par les professionnels de sante impliques dans sa prise en charge.

---

## Comment un patient appartient a une equipe de soins

### 1. Attribution automatique a la creation

Quand un utilisateur cree un patient (`POST /api/v1/patients`), il est **automatiquement** ajoute comme medecin principal du patient :

```
Createur du patient
  -> healthcare_providers (via central_user_id)
  -> patient_care_team entry:
       role: primary_physician
       access_level: full
       granted_at: maintenant
```

**Fichier** : `src/routes/patients.js` (hook `onAfterCreate`, lignes 322-364)

### 2. Attribution manuelle par un praticien autorise

Un praticien deja dans l'equipe de soins peut accorder l'acces a un autre praticien :

```
POST /api/v1/care-team/grant
{
  "patientId": "uuid-du-patient",
  "providerId": "uuid-du-praticien",
  "role": "specialist",
  "accessLevel": "full",
  "expiresAt": null,
  "notes": "Consultation cardiologie"
}
```

**Qui peut accorder l'acces :**
- Un admin de la clinique
- Le medecin principal (`primary_physician`) avec acces `full`
- Un specialiste avec acces `full`

### 3. Acces temporaire (urgences, remplacement)

```
POST /api/v1/care-team/grant
{
  "patientId": "uuid",
  "providerId": "uuid-remplacant",
  "role": "temporary_access",
  "accessLevel": "emergency",
  "expiresAt": "2026-02-12T08:00:00Z",
  "notes": "Remplacement Dr Martin - 24h"
}
```

L'acces expire automatiquement a la date indiquee. Il reste en base pour audit.

---

## Roles dans l'equipe de soins

| Role | Description | Peut accorder l'acces | Peut revoquer |
|------|-------------|----------------------|---------------|
| `primary_physician` | Medecin traitant principal | Oui | Oui (sauf lui-meme) |
| `specialist` | Specialiste consulte | Oui | Non |
| `nurse` | Personnel infirmier | Non | Non |
| `care_team_member` | Membre general (defaut) | Non | Non |
| `temporary_access` | Acces temporaire | Non | Non |

## Niveaux d'acces

| Niveau | Lecture | Ecriture | Description |
|--------|---------|----------|-------------|
| `full` | Oui | Oui | Acces complet au dossier |
| `read_only` | Oui | Non | Consultation uniquement |
| `limited` | Partiel | Non | Informations de base (nom, age, contact) |
| `emergency` | Oui | Oui | Acces urgence (temporaire, audit renforce) |

---

## Visibilite des patients : deux modes

Le systeme supporte deux modes de visibilite, controles par la permission `PATIENTS_VIEW_ALL`.

### Mode actuel (Option B) : Vue clinique complete

Les roles avec `PATIENTS_VIEW_ALL` voient **tous** les patients, sans filtrage par equipe de soins.

| Role | Permission | Voit tous les patients |
|------|-----------|----------------------|
| `super_admin` | Toutes | Oui |
| `admin` | `PATIENTS_VIEW_ALL` | Oui |
| `secretary` | `PATIENTS_VIEW_ALL` | Oui (pas les donnees medicales) |
| `practitioner` | `PATIENTS_VIEW_ALL` | Oui |
| `physician` | `PATIENTS_VIEW` uniquement | **Non — filtre par equipe de soins** |
| `readonly` | `PATIENTS_VIEW` uniquement | **Non — filtre par equipe de soins** |

> **Consequence actuelle** : Un medecin (`physician`) ne voit que les patients auxquels il a ete ajoute dans `patient_care_team`. Un praticien (`practitioner`) voit tous les patients.

### Mode futur (Option A) : Filtrage strict

Pour activer le filtrage strict pour tous :
1. Retirer `PATIENTS_VIEW_ALL` des roles `practitioner` et `secretary` dans `permissionConstants.js`
2. Tous les praticiens ne voient que leurs patients assignes
3. Necessite une UI frontend pour gerer les equipes de soins

---

## Schema de la base de donnees

### Table `patient_care_team` (base clinique)

```sql
CREATE TABLE patient_care_team (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id),
  provider_id UUID NOT NULL REFERENCES healthcare_providers(id),

  role VARCHAR(50) NOT NULL DEFAULT 'care_team_member',
  access_level VARCHAR(20) NOT NULL DEFAULT 'full',

  -- Audit d'attribution
  granted_at TIMESTAMP DEFAULT NOW(),
  granted_by UUID,

  -- Revocation
  revoked_at TIMESTAMP,         -- NULL = acces actif
  revoked_by UUID,
  revocation_reason TEXT,

  -- Expiration
  expires_at TIMESTAMP,          -- NULL = acces permanent

  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,

  UNIQUE(patient_id, provider_id)
);
```

**Migration** : `migrations/clinic_025_patient_care_team.sql`

### Vue `active_patient_care_team`

Vue pre-filtree qui ne retourne que les acces actifs (non revoques, non expires) :

```sql
SELECT pct.*, p.first_name, p.last_name, hp.first_name, hp.last_name, hp.specialty
FROM patient_care_team pct
JOIN patients p ON pct.patient_id = p.id
JOIN healthcare_providers hp ON pct.provider_id = hp.id
WHERE pct.revoked_at IS NULL
  AND (pct.expires_at IS NULL OR pct.expires_at > CURRENT_TIMESTAMP);
```

---

## Chaine de resolution d'identite

```
Token JWT (central users.id)
    |
    v
authMiddleware -> req.user.id, req.user.role, req.user.companyId
    |
    v
healthcare_providers WHERE central_user_id = req.user.id
    |
    v
patient_care_team WHERE provider_id = healthcare_providers.id
    |
    v
Liste des patients accessibles
```

---

## Endpoints API

| Methode | Endpoint | Description | Autorisation |
|---------|----------|-------------|-------------|
| GET | `/care-team/patient/:patientId` | Equipe de soins d'un patient | Admin ou membre de l'equipe |
| GET | `/care-team/provider/:providerId/patients` | Patients d'un praticien | Le praticien lui-meme ou admin |
| GET | `/care-team/my-patients` | Mes patients (raccourci) | Authentifie |
| GET | `/care-team/check/:patientId` | Verifier mon acces a un patient | Authentifie |
| POST | `/care-team/grant` | Accorder l'acces | Admin ou medecin principal |
| POST | `/care-team/revoke` | Revoquer l'acces | Admin ou medecin principal |
| PUT | `/care-team/:accessId` | Modifier un acces | Admin ou medecin principal |

---

## Regles metier

### Acces actif
Un acces est considere **actif** si :
- `revoked_at IS NULL` (pas revoque)
- ET (`expires_at IS NULL` OU `expires_at > maintenant`) (pas expire)

### Protection contre l'auto-revocation
Le medecin principal ne peut pas revoquer son propre acces. Il doit d'abord transferer le role de medecin principal a un autre praticien.

### Re-attribution
Si un praticien a eu son acces revoque puis qu'on lui re-accorde l'acces, le systeme reactualise l'enregistrement existant (unique constraint sur `patient_id + provider_id`) en effacant `revoked_at` et en mettant a jour le role/niveau.

### Equipes (teams) vs Equipe de soins (care team)
- **Teams** (`teams` table) = organisation interne de la clinique (departements, services). **N'affecte PAS la visibilite des patients.**
- **Equipe de soins** (`patient_care_team` table) = qui a acces a quel patient. **C'est la source de verite pour la visibilite.**

Un praticien peut etre dans une team "Cardiologie" mais n'avoir acces qu'aux patients qui lui sont specifiquement assignes.

---

## Fichiers de reference

| Fichier | Contenu |
|---------|---------|
| `src/routes/patients.js` | Creation patient + auto-attribution care team (lignes 322-364) |
| `src/routes/patientCareTeam.js` | Tous les endpoints grant/revoke/list |
| `src/models/clinic/PatientCareTeam.js` | Modele + methodes `hasAccess`, `getAccessiblePatientIds`, `grantAccess`, `revokeAccess` |
| `src/utils/permissionConstants.js` | `PATIENTS_VIEW` vs `PATIENTS_VIEW_ALL` par role |
| `migrations/clinic_025_patient_care_team.sql` | Schema + migration initiale |

---

## Etat actuel du frontend

Il n'existe **pas encore d'interface frontend** pour gerer l'equipe de soins d'un patient. L'onglet "Acces" dans le detail patient affiche l'historique d'acces mais ne permet pas d'ajouter/retirer des praticiens.

Pour permettre la gestion des equipes de soins dans l'interface :
1. Ajouter un onglet "Equipe de soins" dans `PatientDetailModal`
2. Lister les praticiens avec leur role et niveau d'acces
3. Permettre l'ajout/suppression via les endpoints `/care-team/grant` et `/care-team/revoke`
