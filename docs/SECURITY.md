# 🔐 Guide de Sécurité - Medical Pro

## Vue d'ensemble

Ce guide décrit les principes de sécurité fondamentaux de l'application Medical Pro et comment les mettre en œuvre dans les développements futurs.

**OBJECTIF:** Prévenir les failles de sécurité liées à:
- Modification du rôle/permissions au client
- Accès non autorisé à d'autres cliniques
- Tampering du JWT
- Audit trails non-sécurisés
- Exécution d'actions sans permissions

---

## 🔑 Principes Fondamentaux

### 1. La Vérité Unique au Backend

**RÈGLE:** Les rôles, permissions et données sensibles sont TOUJOURS valides côté serveur.

✅ **CORRECT:**
```javascript
// Backend: Valider le rôle depuis la BD
const user = await User.findByPk(req.user.id);
if (user.role !== req.user.role) {
  throw new Error('Token tampering detected');
}
```

❌ **INTERDIT:**
```javascript
// Frontend: Faire confiance au localStorage
const role = localStorage.getItem('user_role');
if (role === 'admin') {
  // ❌ DANGEREUX!
}
```

### 2. Isolation Multi-Tenant

**RÈGLE:** Chaque requête vérifie que l'utilisateur opère sur sa propre clinique.

✅ **CORRECT:**
```javascript
// Backend: Vérifier que companyId du JWT = companyId en BD
const user = await User.findByPk(req.user.id, {
  attributes: ['company_id']
});

if (user.company_id !== req.user.companyId) {
  throw new ForbiddenException('Company mismatch');
}

// Requête avec WHERE clause sur companyId
const patients = await Patient.findAll({
  where: {
    clinic_id: user.company_id  // ← Toujours filtrer!
  }
});
```

❌ **INTERDIT:**
```javascript
// Frontend modifie companyId dans le JWT
const auth = localStorage.getItem('auth');
auth.user.companyId = 'other_clinic_id';

// Accès à d'autres données de clinique
```

### 3. Permission Checks au Backend

**RÈGLE:** JAMAIS faire confiance aux permissions du client.

✅ **CORRECT:**
```javascript
// Backend: Vérifier les permissions depuis la BD
const { requirePermission } = require('../middleware/permissions');

router.post('/patients',
  authMiddleware,
  requirePermission('PATIENTS_CREATE'),  // ← Middleware
  createPatient
);

// Ou dans le handler
async function createPatient(req, res) {
  // req.user.permissions contient les permissions validées
  if (!req.user.permissions.includes('PATIENTS_CREATE')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  // ...
}
```

❌ **INTERDIT:**
```javascript
// Frontend décide si afficher le bouton (SEULEMENT pour l'affichage)
const canCreate = localStorage.getItem('permissions')?.includes('PATIENTS_CREATE');
if (canCreate) {
  // ❌ API CALL SANS VÉRIFICATION BACKEND!
  await api.post('/patients', data);
}
```

### 4. Authentification Forte

**RÈGLE:** Chaque requête valide le JWT et les données associées.

✅ **CORRECT:**
```javascript
// Backend: authMiddleware valide tout
const authMiddleware = (req, res, next) => {
  const token = extractToken(req);
  const decoded = verifyAccessToken(token);  // ← Vérifier la signature

  if (isExpired(decoded)) {
    return res.status(401).json({ error: 'Token expired' });
  }

  req.user = decoded;
  next();
};

// Chaque route protected appelle authMiddleware
router.get('/patients', authMiddleware, getPatients);
```

---

## 🛡️ Patterns de Sécurité

### Pattern 1: Permission Middleware

Utiliser le middleware `requirePermission()` pour toutes les routes sensibles:

```javascript
// Backend: routes/patients.js
const { requirePermission } = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionConstants');

// Créer patient
router.post('/',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_CREATE),
  createPatient
);

// Modifier patient
router.put('/:id',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_EDIT),
  updatePatient
);

// Supprimer patient
router.delete('/:id',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_DELETE),
  deletePatient
);

// Voir patients (lecture)
router.get('/',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_VIEW),
  listPatients
);
```

### Pattern 2: Audit Logging

Logger TOUTES les actions sensibles:

```javascript
// Backend: Dans les handlers
const { logResourceCreated } = require('../services/auditService');

async function createPatient(req, res) {
  try {
    // Créer le patient
    const patient = await Patient.create({...});

    // 🔐 Logger l'action
    await logResourceCreated(
      req.user.id,
      req.user.companyId,
      'Patient',
      patient.id,
      patient.toJSON(),
      req.ip,
      req.get('User-Agent')
    );

    res.json({ success: true, data: patient });
  } catch (error) {
    // Logger l'erreur aussi
    await logResourceCreated(
      req.user.id,
      req.user.companyId,
      'Patient',
      null,
      data,
      req.ip,
      req.get('User-Agent')
    );
    throw error;
  }
}
```

### Pattern 3: Validation des Inputs

Valider TOUS les inputs avec Joi:

```javascript
// Backend: Schémas de validation
const createPatientSchema = Joi.object({
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^[\d\s\-\+\(\)]{7,20}$/).optional(),
  dateOfBirth: Joi.date().iso().required(),
  // ...
});

// Dans le handler
async function createPatient(req, res) {
  const { error, value } = createPatientSchema.validate(req.body);

  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: 'Validation failed', details: error.message }
    });
  }

  // Utiliser 'value' (les données validées), pas req.body
  const patient = await Patient.create(value);
  // ...
}
```

### Pattern 4: Frontend - Permissions

Utiliser `SecurePermissionGuard` pour l'affichage SEULEMENT:

```javascript
// Frontend: React component
import { useAuth } from '../hooks/useAuth';
import SecurePermissionGuard from '../components/auth/SecurePermissionGuard';

function PatientsList() {
  const { hasPermission } = useAuth();

  // Affichage conditionnel (UNIQUEMENT pour UX)
  return (
    <>
      {/* Bouton créer (visible ou pas) */}
      <SecurePermissionGuard permission="PATIENTS_CREATE">
        <button onClick={createPatient}>Créer Patient</button>
      </SecurePermissionGuard>

      {/* Données */}
      <PatientTable
        canEdit={hasPermission('PATIENTS_EDIT')}
        canDelete={hasPermission('PATIENTS_DELETE')}
      />
    </>
  );
}
```

**IMPORTANT:** Même si le bouton n'est pas visible, le backend DOIT valider les permissions!

---

## 📋 Checklist de Sécurité

### Avant chaque commit

- [ ] Toutes les routes sensibles ont `requirePermission()` middleware?
- [ ] Les vérifications de `companyId` sont en place (multi-tenant)?
- [ ] Les actions sensibles sont loggées en audit?
- [ ] Les inputs sont validés avec Joi?
- [ ] Les rôles/permissions ne sont pas hardcodés au frontend?
- [ ] Pas de `eval()` ou `Function()` constructors?
- [ ] Pas de données sensibles en localStorage (sauf JWT)?
- [ ] Pas de SQL injections possibles (utiliser ORM)?
- [ ] Pas de console.log() en production de données sensibles?
- [ ] Les tests incluent des cas d'erreur d'authentification?

### Avant une release

- [ ] Audit logs sont testés et intacts?
- [ ] Tous les 401/403 retournent les bons messages?
- [ ] Rate limiting est activé?
- [ ] CORS est configuré correctement?
- [ ] JWT secret est sécurisé et long?
- [ ] HTTPS est activé en production?
- [ ] Les migrations DB sont testées?
- [ ] Backup et DR plan existent?

---

## ⚠️ Erreurs Courantes

### Erreur 1: Faire confiance aux données du client

❌ **DANGEREUX:**
```javascript
router.get('/patients/:id', (req, res) => {
  // Utilisateur modifie :id dans l'URL
  const patient = await Patient.findByPk(req.params.id);
  // ❌ Pas de vérification que patient.clinicId === req.user.companyId!
  res.json(patient);
});
```

✅ **CORRECT:**
```javascript
router.get('/patients/:id',
  authMiddleware,
  verifyCompanyContext,
  async (req, res) => {
    const patient = await Patient.findByPk(req.params.id);

    // Vérifier que c'est la bonne clinique
    if (patient.clinic_id !== req.user.validatedCompanyId) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(patient);
  }
);
```

### Erreur 2: Stocker des données sensibles en localStorage

❌ **DANGEREUX:**
```javascript
// Frontend: localStorage contient la permission
localStorage.setItem('can_delete_user', true);
if (localStorage.getItem('can_delete_user')) {
  // ❌ Utilisateur peut modifier localStorage!
  await api.delete('/users/123');
}
```

✅ **CORRECT:**
```javascript
// Frontend: État vient du backend
const { permissions } = useSecureAuth();

const canDelete = permissions.includes('USERS_DELETE');
if (canDelete) {
  // API call s'ajoute le Authorization header
  // Backend valide la permission NOUVEAU
  await api.delete('/users/123');
}
```

### Erreur 3: Permissions non-cohérentes

❌ **DANGEREUX:**
```javascript
// Frontend a une liste de permissions
const PERMISSIONS = {
  CREATE_PATIENT: 'create_patient',
  EDIT_PATIENT: 'edit_patient'
};

// Backend a une autre liste
const PERMISSIONS = {
  PATIENTS_CREATE: 'patients.create',
  PATIENTS_EDIT: 'patients.edit'
};
// ❌ Décalage → bugs de sécurité!
```

✅ **CORRECT:**
```javascript
// Backend: Source unique (permissionConstants.js)
const PERMISSIONS = { ... };

// Frontend: Importe depuis le backend
// Ou reçoit les permissions via API /auth/me
```

---

## 🔍 Tester la Sécurité

### Script: Essayer de modifier son rôle

```javascript
// Dans la console du navigateur
const auth = JSON.parse(localStorage.getItem('clinicmanager_auth'));
auth.user.role = 'super_admin';
localStorage.setItem('clinicmanager_auth', JSON.stringify(auth));

// Appeler l'API pour voir si elle est bloquée
fetch('/api/v1/users', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('clinicmanager_token')
  }
})
.then(r => r.json())
.then(data => console.log(data));

// ✅ CORRECT: Erreur 403 Permission Denied
// ❌ DANGEREUX: Données retournées
```

### Script: Tester l'isolation multi-tenant

```javascript
// Modifier companyId
const auth = JSON.parse(localStorage.getItem('clinicmanager_auth'));
auth.user.companyId = 'other_clinic_id';
localStorage.setItem('clinicmanager_auth', JSON.stringify(auth));

// Tenter d'accéder aux patients
fetch('/api/v1/patients', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('clinicmanager_token')
  }
})
.then(r => r.json())
.then(data => console.log(data));

// ✅ CORRECT: Erreur 403 Forbidden
// ❌ DANGEREUX: Patients d'une autre clinique
```

### Script: Vérifier l'audit logging

```bash
# SSH vers le serveur
psql -h localhost -U medicalpro -d medicalpro_central << EOF
  SELECT * FROM audit_logs
  WHERE user_id = 'user_uuid'
  ORDER BY timestamp DESC
  LIMIT 20;
EOF
```

---

## 📞 Support et Questions

Pour toute question ou signalement de faille: contactez l'équipe de sécurité.

**IMPORTANT:** Documenter toute dérogation à ces principes et faire approuver par l'équipe de sécurité.
