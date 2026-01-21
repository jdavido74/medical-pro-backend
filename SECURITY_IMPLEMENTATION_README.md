# 🔐 Correctifs de Sécurité - Guide Rapide

## TL;DR - Démarrer en 5 minutes

### 1️⃣ Lire d'abord
```bash
cat docs/SECURITY.md  # Guide de sécurité complet
cat docs/IMPLEMENTATION_GUIDE.md  # Étapes d'intégration
```

### 2️⃣ Exécuter la migration
```bash
# Backend: Exécuter les migrations
./scripts/deploySecurityFixes.sh

# Vérifie:
# ✓ Fichiers de sécurité créés
# ✓ Table audit_logs créée
# ✓ Tous les imports fonctionnent
```

### 3️⃣ Mettre à jour les routes
Ajouter à TOUTES les routes sensibles:
```javascript
const { authMiddleware } = require('../middleware/auth');
const { verifyCompanyContext, requirePermission } = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionConstants');

router.post('/patients',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.PATIENTS_CREATE),
  createPatient
);
```

### 4️⃣ Mettre à jour le frontend
```javascript
// App.js
import { SecureAuthProvider } from './contexts/SecureAuthContext';

export default function App() {
  return (
    <SecureAuthProvider>
      <Router>...</Router>
    </SecureAuthProvider>
  );
}
```

### 5️⃣ Tester
```bash
./scripts/testSecurityFixes.sh  # Vérification de sécurité
npm run test:security           # Tests d'autorisation
```

---

## 📁 Fichiers Clés

### Backend

| Fichier | Rôle | Lignes |
|---------|------|--------|
| `src/utils/permissionConstants.js` | Définition des permissions (SOURCE UNIQUE) | 400 |
| `src/middleware/permissions.js` | Vérification des permissions | 350 |
| `src/services/auditService.js` | Logging des actions sensibles | 500 |
| `src/routes/auth.js` | Endpoint `/auth/me` (NEW) | +150 |
| `migrations/010_audit_logs.sql` | Table d'audit (NEW) | 70 |

### Frontend

| Fichier | Rôle |
|---------|------|
| `src/contexts/SecureAuthContext.js` | Context sécurisé (remplace AuthContext) |
| `src/hooks/useAuth.js` | Hook pour accéder au contexte |
| `src/hooks/useSecureAuth.js` | Hook utilitaire |
| `src/components/auth/SecurePermissionGuard.js` | Guard sécurisé (remplace PermissionGuard) |

### Documentation

- `docs/SECURITY.md` - **LIRE D'ABORD** (guide complet)
- `docs/IMPLEMENTATION_GUIDE.md` - Étapes d'intégration détaillées
- `scripts/testSecurityFixes.sh` - Script de test automatisé
- `scripts/deploySecurityFixes.sh` - Script de déploiement

---

## 🎯 Checklist d'Intégration

### Backend ✅/❌

- [ ] Migration BD exécutée (`010_audit_logs.sql`)
- [ ] Fichiers de sécurité présents et importables
- [ ] `/auth/me` endpoint fonctionnel et testé
- [ ] **TOUTES** les routes sensibles protégées:
  - [ ] GET /patients - `requirePermission(PATIENTS_VIEW)`
  - [ ] POST /patients - `requirePermission(PATIENTS_CREATE)`
  - [ ] PUT /patients/:id - `requirePermission(PATIENTS_EDIT)`
  - [ ] DELETE /patients/:id - `requirePermission(PATIENTS_DELETE)`
  - [ ] (Idem pour /users, /appointments, /invoices, etc.)
- [ ] Audit logging sur les actions sensibles
- [ ] Tests passing: `npm run test:security`

### Frontend ✅/❌

- [ ] `SecureAuthProvider` en place dans App.js
- [ ] LoginPage utilise `useAuth()` pour login
- [ ] localStorage contient **SEULEMENT** le JWT
- [ ] Tous les `PermissionGuard` remplacés par `SecurePermissionGuard`
- [ ] Tests manuels réussis

### Documentation ✅/❌

- [ ] SECURITY.md lu et compris par toute l'équipe
- [ ] IMPLEMENTATION_GUIDE.md appliqué
- [ ] Scripts de test exécutés avec succès

---

## 🚨 Erreurs Courantes à ÉVITER

### ❌ Ne PAS faire

```javascript
// ❌ Faire confiance au localStorage pour les permissions
if (localStorage.getItem('user_role') === 'admin') {
  await api.delete('/users/123');  // DANGEREUX!
}

// ❌ Ne pas vérifier les permissions au backend
router.delete('/users/:id', (req, res) => {
  User.destroy({where: {id: req.params.id}});  // Pas de vérification!
});

// ❌ Stocker les permissions en localStorage
localStorage.setItem('permissions', JSON.stringify(userPerms));  // DANGEREUX!

// ❌ Ne pas valider le companyId
const patient = await Patient.findByPk(req.params.id);
// Pas de vérification: patient.clinic_id === req.user.companyId!
```

### ✅ FAIRE

```javascript
// ✅ Utiliser SecurePermissionGuard pour l'affichage SEULEMENT
<SecurePermissionGuard permission="USERS_DELETE">
  <button onClick={deleteUser}>Supprimer</button>
</SecurePermissionGuard>

// ✅ Vérifier les permissions au backend
router.delete('/users/:id',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.USERS_DELETE),  // ← Vérification
  deleteUser
);

// ✅ Récupérer les permissions depuis /auth/me
const { permissions } = await api.get('/auth/me');

// ✅ Valider le companyId
const patient = await Patient.findByPk(req.params.id);
if (patient.clinic_id !== req.user.validatedCompanyId) {
  throw new ForbiddenException('Not found');
}
```

---

## 📊 Avant/Après

### Avant
```
❌ Rôles modifiables: localStorage.user.role = 'admin'
❌ Multi-tenant compromise: localStorage.user.companyId = 'other'
❌ Aucune permission check au backend
❌ Pas d'audit logging
❌ localStorage = données sensibles
```

### Après
```
✅ Rôles validés: JWT vs BD (double check)
✅ CompanyId vérifié: middleware verifyCompanyContext
✅ Permissions sur CHAQUE route: requirePermission()
✅ Audit logging complet: auditService
✅ localStorage = JWT SEULEMENT
```

---

## 🔍 Tester Rapidement

### Test 1: Vérifier que JWT n'est pas modifiable
```bash
# Frontend console
const token = localStorage.getItem('clinicmanager_token');
const parts = token.split('.');
const decoded = JSON.parse(atob(parts[1]));
console.log(decoded);  // Voir le contenu

// Tenter de modifier et rafraîchir
// Résultat attendu: Token invalide, redirection login
```

### Test 2: Vérifier /auth/me
```bash
TOKEN="votre_jwt_token"
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/auth/me | jq
# Vérifier que permissions viennent de la BD
```

### Test 3: Vérifier que permissions sont appliquées
```bash
# Secretary tente d'accéder à /users (admin-only)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/users
# Résultat attendu: HTTP 403 Permission Denied
```

---

## 📞 Aide et Support

### Si ça ne fonctionne pas

1. **Vérifier les logs:**
   ```bash
   tail -f logs/application.log
   tail -f logs/security.log
   ```

2. **Vérifier la BD:**
   ```bash
   psql -d medicalpro_central -c "SELECT * FROM audit_logs LIMIT 5;"
   ```

3. **Lire le guide détaillé:**
   - `docs/SECURITY.md` - Principes et patterns
   - `docs/IMPLEMENTATION_GUIDE.md` - Étapes et checklist

4. **Exécuter les scripts:**
   ```bash
   ./scripts/testSecurityFixes.sh  # Diagnostic complet
   npm run test:security           # Tests de sécurité
   ```

### Questions courantes

**Q: "Backend dit que mon rôle est tampered"**
A: Vérifier que le rôle en BD = rôle dans le JWT. Voir IMPLEMENTATION_GUIDE.md #Troubleshooting

**Q: "Permission denied alors que j'ai le rôle admin"**
A: Vérifier que le rôle 'admin' a la permission requise dans permissionConstants.js

**Q: "localStorage contient plein de données"**
A: Normal si l'ancien code les y stockait. Les nettoyer. Seul JWT doit rester.

---

## 🎓 Prochaine Lecture

1. **Immédiatement:** `docs/SECURITY.md` (30 min)
2. **Avant de coder:** `docs/IMPLEMENTATION_GUIDE.md` (45 min)
3. **Avant de committer:** Relire ces deux fichiers + checklist

---

**Version:** 1.0
**Date:** 2025-11-19
**Status:** ✅ Prêt pour l'implémentation
