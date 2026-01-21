# 🚀 Guide d'Implémentation - Correctifs de Sécurité

## Vue d'ensemble

Ce guide explique **comment implémenter tous les correctifs de sécurité** qui ont été développés pour corriger les failles identifiées.

**Durée estimée:** 3-4 heures (surtout migration BD + tests)

---

## 📋 Étapes d'Implémentation

### Étape 1: Exécuter la migration d'audit logging (30 min)

```bash
# 1. Vérifier que la migration existe
ls -la migrations/010_audit_logs.sql

# 2. Exécuter la migration sur la BD centrale
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -f migrations/010_audit_logs.sql

# 3. Vérifier que la table a été créée
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "\dt audit_logs"

# Résultat attendu:
# Schema | Name        | Type  | Owner
# -----+--------------+-------+---------
# public | audit_logs  | table | medicalpro
```

### Étape 2: Vérifier les fichiers créés (15 min)

Les fichiers suivants doivent exister:

**Backend:**
```
src/
  ├─ utils/
  │  └─ permissionConstants.js     ← Constantes permissions
  ├─ middleware/
  │  └─ permissions.js             ← Middleware permissions
  ├─ services/
  │  └─ auditService.js            ← Service audit logging
  └─ routes/
     └─ auth.js                    ← Endpoint /auth/me ajouté

docs/
  ├─ SECURITY.md                  ← Guide de sécurité
  └─ IMPLEMENTATION_GUIDE.md       ← Ce fichier

migrations/
  └─ 010_audit_logs.sql            ← Migration

tests/security/
  └─ permissionValidation.test.js  ← Tests de sécurité

scripts/
  └─ testSecurityFixes.sh          ← Script de vérification
```

**Frontend:**
```
src/
  ├─ hooks/
  │  ├─ useSecureAuth.js           ← Hook sécurisé
  │  └─ useAuth.js                 ← Hook pour contexte
  ├─ contexts/
  │  └─ SecureAuthContext.js       ← Contexte sécurisé
  └─ components/auth/
     └─ SecurePermissionGuard.js   ← Guard sécurisé
```

### Étape 3: Mettre à jour les routes protégées (1-2h)

Ajouter le middleware `requirePermission()` à TOUTES les routes sensibles.

**Exemple: Route patients**

```javascript
// Backend: src/routes/patients.js

const { authMiddleware } = require('../middleware/auth');
const {
  verifyCompanyContext,
  requirePermission
} = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionConstants');

// AVANT (non sécurisé):
// router.get('/', (req, res) => { ... });

// APRÈS (sécurisé):
router.get(
  '/',
  authMiddleware,                          // 1. Authentifier
  verifyCompanyContext,                    // 2. Vérifier clinique
  requirePermission(PERMISSIONS.PATIENTS_VIEW),  // 3. Vérifier permission
  getPatients                              // 4. Handler
);

router.post(
  '/',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_CREATE),
  createPatient
);

router.put(
  '/:id',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_EDIT),
  updatePatient
);

router.delete(
  '/:id',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_DELETE),
  deletePatient
);
```

**Checklist des routes à protéger:**

- [ ] GET /patients
- [ ] POST /patients
- [ ] PUT /patients/:id
- [ ] DELETE /patients/:id
- [ ] GET /appointments
- [ ] POST /appointments
- [ ] PUT /appointments/:id
- [ ] DELETE /appointments/:id
- [ ] GET /users
- [ ] POST /users
- [ ] PUT /users/:id
- [ ] DELETE /users/:id
- [ ] GET /invoices
- [ ] POST /invoices
- [ ] (et toutes les autres routes sensibles)

### Étape 4: Ajouter audit logging aux handlers (1h)

Importer et utiliser `auditService` dans les handlers critiques:

```javascript
// Backend: src/routes/patients.js

const auditService = require('../services/auditService');

async function createPatient(req, res) {
  try {
    // Validation
    const { error, value } = patientSchema.validate(req.body);
    if (error) {
      // Logger l'erreur de validation
      await auditService.logAudit({
        userId: req.user.id,
        companyId: req.user.companyId,
        eventType: 'PATIENT_CREATE_FAILED',
        action: 'Patient creation validation failed',
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: false,
        errorMessage: error.message
      });
      return res.status(400).json({ error });
    }

    // Créer le patient
    const patient = await Patient.create(value);

    // 🔐 Logger l'action réussie
    await auditService.logResourceCreated(
      req.user.id,
      req.user.companyId,
      'Patient',
      patient.id,
      patient.toJSON(),
      req.ip,
      req.get('User-Agent')
    );

    res.status(201).json({ success: true, data: patient });
  } catch (error) {
    // Logger l'erreur serveur
    await auditService.logUnauthorizedAccess(
      req.user?.id,
      req.user?.companyId,
      'Patient',
      null,
      req.ip,
      req.get('User-Agent'),
      error.message
    );

    throw error;
  }
}
```

**Routes à ajouter du logging:**

- [ ] Créer utilisateur
- [ ] Modifier permissions utilisateur
- [ ] Supprimer utilisateur
- [ ] Créer patient
- [ ] Modifier patient
- [ ] Supprimer patient
- [ ] Créer facture
- [ ] Supprimer facture
- [ ] Créer rendez-vous
- [ ] Confirmer rendez-vous

### Étape 5: Mettre à jour le frontend (1h)

#### 5a. Mettre à jour App.js

```javascript
// Frontend: src/App.js

// AVANT:
import { AuthProvider } from './contexts/AuthContext';

// APRÈS:
import { SecureAuthProvider } from './contexts/SecureAuthContext';

function App() {
  return (
    <SecureAuthProvider>  {/* ← Changer le provider */}
      <Router>
        {/* ... */}
      </Router>
    </SecureAuthProvider>
  );
}
```

#### 5b. Mettre à jour LoginPage

```javascript
// Frontend: src/components/auth/LoginPage.js

import useAuth from '../../hooks/useAuth';

function LoginPage() {
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Appeler login avec email/password
    const success = await login(email, password);

    if (success) {
      // Le contexte charge automatiquement les données utilisateur
      // via loadUserFromBackend() qui appelle /auth/me
      window.location.href = '/dashboard';
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* ... */}
    </form>
  );
}
```

#### 5c. Remplacer PermissionGuard par SecurePermissionGuard

```javascript
// Frontend: Partout où PermissionGuard est utilisé

// AVANT:
import PermissionGuard from '../auth/PermissionGuard';

// APRÈS:
import SecurePermissionGuard from '../auth/SecurePermissionGuard';

function Component() {
  return (
    <SecurePermissionGuard permission="PATIENTS_CREATE">
      <button>Créer Patient</button>
    </SecurePermissionGuard>
  );
}
```

**Fichiers à mettre à jour:**

- [ ] src/App.js
- [ ] src/components/auth/LoginPage.js
- [ ] src/components/dashboard/Dashboard.js
- [ ] src/components/dashboard/Sidebar.js
- [ ] Tous les fichiers utilisant PermissionGuard

### Étape 6: Tester (30-45 min)

#### 6a. Tests unitaires

```bash
# Exécuter les tests de sécurité
npm run test:security

# Ou directement
npm test -- tests/security/permissionValidation.test.js
```

#### 6b. Script de vérification

```bash
# Rendre le script exécutable
chmod +x scripts/testSecurityFixes.sh

# Exécuter le script
./scripts/testSecurityFixes.sh

# Résultat attendu:
# ✓ Secretary should NOT access admin endpoints
# ✓ Secretary can view patients of their clinic
# ✓ GET /auth/me returns permissions from backend
# ✓ PATIENTS_VIEW permission present
# ✓ Secretary correctly lacks USERS_DELETE
```

#### 6c. Tests manuels

**Test 1: Vérifier que localStorage ne contient que le JWT**

```javascript
// Console du navigateur
Object.keys(localStorage).forEach(key => {
  if (key.startsWith('clinicmanager_')) {
    console.log(key, localStorage.getItem(key).substring(0, 50) + '...');
  }
});

// Résultat attendu:
// clinicmanager_token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
// (RIEN D'AUTRE!)
```

**Test 2: Tenter de modifier le rôle**

```javascript
// Console du navigateur
// Rafraîchir la page après
const auth = JSON.parse(localStorage.getItem('clinicmanager_auth') || '{}');
if (auth.user) {
  auth.user.role = 'super_admin';
  localStorage.setItem('clinicmanager_auth', JSON.stringify(auth));
  window.location.reload();
}

// Résultat attendu:
// - Page redirige vers login (token invalid)
// - Pas d'accès aux permissions admin
```

**Test 3: Vérifier l'endpoint /auth/me**

```bash
# Obtenir un token valide d'abord
TOKEN="<votre_jwt_token>"

# Appeler /auth/me
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/auth/me | jq

# Résultat attendu:
# {
#   "success": true,
#   "data": {
#     "user": { ... },
#     "company": { ... },
#     "permissions": ["PATIENTS_VIEW", "APPOINTMENTS_VIEW", ...],
#     "dataSource": "database"
#   }
# }
```

### Étape 7: Vérifier les logs d'audit (15 min)

```bash
# Vérifier que les logs d'audit sont créés
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central << EOF
SELECT
  event_type,
  action,
  success,
  timestamp
FROM audit_logs
ORDER BY timestamp DESC
LIMIT 10;
EOF

# Résultat attendu:
# event_type        │ action                  │ success │ timestamp
# ────────────────────┼──────────────────────────┼─────────┼─────────────────────
# LOGIN               │ User login successful   │ t       │ 2025-11-19 10:30:00
# PATIENT_CREATED     │ Created new Patient     │ t       │ 2025-11-19 10:31:00
# PERMISSION_DENIED   │ Access denied: DELETE   │ f       │ 2025-11-19 10:32:00
```

---

## ✅ Checklist Finale

### Backend

- [ ] Migration 010_audit_logs.sql exécutée
- [ ] permissionConstants.js créé et importable
- [ ] Middleware permissions.js en place
- [ ] auditService.js en place
- [ ] Endpoint GET /auth/me fonctionnel
- [ ] Toutes les routes protégées avec requirePermission()
- [ ] Audit logging sur les actions sensibles
- [ ] Tests de sécurité passing (npm run test:security)
- [ ] Script testSecurityFixes.sh fonctionnel
- [ ] Documentation SECURITY.md à jour

### Frontend

- [ ] useSecureAuth.js hook créé
- [ ] useAuth.js hook créé
- [ ] SecureAuthContext.js contexte créé
- [ ] SecurePermissionGuard.js composant créé
- [ ] App.js utilise SecureAuthProvider
- [ ] LoginPage utilise useAuth hook
- [ ] localStorage contient SEULEMENT le JWT
- [ ] Tous les PermissionGuard remplacés par SecurePermissionGuard
- [ ] Tests manuels réussis
- [ ] Pas de console.log() avec données sensibles

---

## 🔍 Validation Post-Déploiement

Après déploiement en production:

1. **Vérifier les logs d'audit:**
   ```bash
   tail -f /var/log/medicalpro/audit.log
   ```

2. **Vérifier les appels API bloquer les requêtes non-autorisées:**
   ```bash
   curl -H "Authorization: Bearer invalid_token" \
     https://api.medicalpro.com/api/v1/users
   # Doit retourner 401
   ```

3. **Vérifier que les permissions viennent du backend:**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     https://api.medicalpro.com/api/v1/auth/me | jq '.data.permissions'
   ```

4. **Vérifier les tables de BD:**
   ```bash
   SELECT * FROM audit_logs LIMIT 5;
   SELECT * FROM users WHERE id = 'user_id';  # Vérifier rôle
   ```

---

## 🚨 Troubleshooting

### Erreur: "Token tampering detected"

**Cause:** Rôle du JWT ≠ rôle en BD

**Solution:**
```bash
# Vérifier la BD
psql -d medicalpro_central -c \
  "SELECT role FROM users WHERE id = 'user_id';"

# Si rôle modifié en BD, le corriger
UPDATE users SET role = 'secretary' WHERE id = 'user_id';
```

### Erreur: "Company mismatch"

**Cause:** companyId du JWT ≠ companyId en BD

**Solution:**
```bash
# Vérifier la BD
psql -d medicalpro_central -c \
  "SELECT company_id FROM users WHERE id = 'user_id';"

# Les tokens ne peuvent pas être changés, doivent être réémis
```

### Erreur: "Permission denied"

**Cause:** Utilisateur n'a pas la permission requise

**Solution:**
1. Vérifier le rôle de l'utilisateur
2. Vérifier que le rôle a la permission requise dans permissionConstants.js
3. Vérifier les logs d'audit pour voir pourquoi accès refusé

### Audit logs ne sont pas créées

**Cause:** Table audit_logs n'existe pas ou auditService pas appelé

**Solution:**
```bash
# Vérifier la table
psql -d medicalpro_central -c "\dt audit_logs"

# Si pas de table: exécuter la migration
psql -d medicalpro_central -f migrations/010_audit_logs.sql

# Vérifier que auditService.logResourceCreated() est appelé dans les handlers
grep -r "logResourceCreated" src/routes/
```

---

## 📚 Ressources

- **Guide de sécurité:** `/var/www/medical-pro-backend/docs/SECURITY.md`
- **Permission Constants:** `/var/www/medical-pro-backend/src/utils/permissionConstants.js`
- **Middleware:** `/var/www/medical-pro-backend/src/middleware/permissions.js`
- **Audit Service:** `/var/www/medical-pro-backend/src/services/auditService.js`

---

## 🎯 Prochaines Étapes

Après la mise en place de ces correctifs:

1. **Implémenter Rate Limiting** (limiter les tentatives failed login)
2. **Ajouter 2FA** (authentification à deux facteurs)
3. **Implémenter CORS stricte** (limiter les domaines autorisés)
4. **Ajouter CSP headers** (Content Security Policy)
5. **Configurer HTTPS/TLS** (en production uniquement)
6. **Implémenter les sessions revocable** (logout immédiat partout)

---

**Version:** 1.0
**Date:** 2025-11-19
**Auteur:** Security Team
