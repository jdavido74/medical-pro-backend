# Guide de Sécurité - MedicalPro

## Table des matières

1. [Audit de sécurité (2026-02-14)](#audit-de-sécurité-2026-02-14)
2. [Corrections appliquées](#corrections-appliquées)
3. [Architecture de sécurité](#architecture-de-sécurité)
4. [Principes fondamentaux](#principes-fondamentaux)
5. [Patterns de sécurité](#patterns-de-sécurité)
6. [Checklist de sécurité](#checklist-de-sécurité)
7. [Tests de sécurité](#tests-de-sécurité)

---

## Audit de sécurité (2026-02-14)

Un audit complet de pénétration a été réalisé sur l'ensemble de l'infrastructure MedicalPro :
- **app.medimaestro.com** (frontend React SPA)
- **admin.medimaestro.com** (portail d'administration)
- **Backend API** (Node.js/Express + PostgreSQL)
- **Infrastructure** (Nginx, SSL, SSH, CI/CD)

### Résumé des findings

| Sévérité | Nombre | Statut |
|----------|--------|--------|
| CRITICAL | 6 | Corrigé |
| HIGH | 16 | Corrigé (principaux) |
| MEDIUM | 27 | Corrigé (principaux) |
| LOW | 15 | Partiellement corrigé |

### Corrections CRITICAL

| # | Vulnérabilité | Fichier(s) | Correction |
|---|---|---|---|
| 1 | Secrets JWT hardcodés en fallback | `config/jwt.js`, `routes/auth.js` | Fallbacks supprimés, variables d'environnement obligatoires |
| 2 | Mot de passe DB hardcodé en fallback | `config/database.js`, `connectionManager.js`, `clinicProvisioningService.js`, `auth.js`, `public-consent-signing.js` | Tous les `\|\| 'medicalpro2024'` supprimés |
| 3 | Injection de commandes shell (provisioning) | `clinicProvisioningService.js` | PGPASSWORD passé via `env` option de `execAsync()` au lieu d'interpolation shell |
| 4 | Validation env vars au démarrage | `config/validateEnv.js` (nouveau) | Le serveur refuse de démarrer si `JWT_SECRET`, `JWT_REFRESH_SECRET` ou `DB_PASSWORD` manquent |
| 5 | Endpoint non authentifié | `routes/auth.js` `/resend-invitation` | `authMiddleware` ajouté |
| 6 | Brute-force 2FA sans rate limit | `routes/totp.js` `/validate` | Rate limiter: 5 tentatives / 15 min / IP |

### Corrections HIGH — XSS (DOMPurify)

| # | Fichier | Ligne | Correction |
|---|---|---|---|
| 1 | `ConsentSigningPage.js` | ~424 | `sanitizeHTML()` sur `dangerouslySetInnerHTML` |
| 2 | `PatientDetailModal.js` | ~961 | `sanitizeHTML()` sur `dangerouslySetInnerHTML` |
| 3 | `ConsentPreviewModal.js` | ~435 | `sanitizeHTML()` sur `dangerouslySetInnerHTML` |
| 4 | `ConsentTemplatesModule.js` | ~969 | `sanitizeHTML()` sur `dangerouslySetInnerHTML` |

### Corrections MEDIUM — XSS (autres)

| # | Fichier | Correction |
|---|---|---|
| 1 | `ConsentTemplateEditorModal.js` | `sanitizeHTML()` sur l'aperçu du template |
| 2 | `PDFPreviewModal.js` | `escapeHTML()` sur les valeurs interpolées (`clientName`, `description`, `conditions`, `purchaseOrderNumber`) |
| 3 | `clear-storage.html` | `textContent` + DOM API au lieu de `innerHTML` |
| 4 | `clear-session.html` | `textContent` + DOM API au lieu de `innerHTML` |

### Corrections HIGH — Headers CSP & Sécurité

| Couche | Correction |
|---|---|
| **Backend (Helmet)** | CSP restrictif pour l'API (`default-src 'none'`), HSTS preload, `frameguard: deny`, `Permissions-Policy`, `Referrer-Policy` |
| **Nginx (3 server blocks)** | `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy` ajoutés sur app, admin, et wildcard |

### Corrections HIGH — httpOnly Cookies (JWT)

Migration complète des JWT tokens de `localStorage` vers un système hybride sécurisé :
- **Access token** → mémoire JavaScript uniquement (volatile, inaccessible si XSS)
- **Refresh token** → cookie `httpOnly` (inaccessible via JavaScript)

---

## Corrections appliquées

### 1. Validation des variables d'environnement au démarrage

**Fichier :** `src/config/validateEnv.js` (nouveau)

Le serveur refuse de démarrer si des variables critiques manquent :

```javascript
// Variables obligatoires (le serveur ne démarre pas sans)
JWT_SECRET          // Clé de signature JWT (min 32 caractères recommandé)
JWT_REFRESH_SECRET  // Clé de signature du refresh token
DB_PASSWORD         // Mot de passe PostgreSQL

// Variable recommandée (warning si absente)
TOTP_ENCRYPTION_KEY // Clé de chiffrement TOTP (doit différer de JWT_SECRET)
```

**Appel dans `server.js` :**
```javascript
require('dotenv').config();
const { validateRequiredEnvVars } = require('./src/config/validateEnv');
validateRequiredEnvVars(); // Fail-fast si manquant
```

### 2. Prévention de l'injection de commandes

**Fichier :** `src/services/clinicProvisioningService.js`

**Avant (vulnérable) :**
```javascript
// Le mot de passe est interpolé dans la commande shell
await execAsync(`PGPASSWORD='${dbPassword}' psql -h ${dbHost} ...`);
// Si dbPassword contient '; rm -rf / #, c'est exécuté!
```

**Après (sécurisé) :**
```javascript
// Helper qui passe le mot de passe via l'environnement du processus
function execPsql(command, dbPassword) {
  return execAsync(command, {
    env: { ...process.env, PGPASSWORD: dbPassword }
  });
}

// Le mot de passe n'est jamais dans la commande shell
await execPsql(`psql -h ${dbHost} -U ${dbUser} -d ${dbName} ...`, dbPassword);
```

### 3. Sanitisation HTML (XSS)

**Fichier :** `src/utils/sanitize.js` (frontend, nouveau)

Deux fonctions de protection :

```javascript
import DOMPurify from 'dompurify';

// Pour du contenu HTML riche (templates de consentement, etc.)
export function sanitizeHTML(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'span', 'div',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'img', 'blockquote', 'pre', 'code', 'hr', 'sup', 'sub'],
    ALLOWED_ATTR: ['class', 'style', 'href', 'src', 'alt', 'target', 'rel',
      'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  });
}

// Pour des valeurs texte interpolées dans des templates HTML
export function escapeHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

**Utilisation :**
```jsx
// Contenu riche (consentements, previews)
<div dangerouslySetInnerHTML={{ __html: sanitizeHTML(content) }} />

// Valeurs texte dans templates HTML (PDFs, factures)
const html = `<td>${escapeHTML(item.description)}</td>`;
```

### 4. Headers de sécurité (CSP)

#### Backend — Helmet.js (`server.js`)

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],      // API ne charge rien
      frameAncestors: ["'none'"],  // API ne s'affiche pas dans un iframe
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  permissionsPolicy: {
    features: { camera: [], microphone: [], geolocation: [], payment: [] }
  }
}));
```

#### Nginx — Template (`scripts/production/nginx-multitenant.conf`)

Headers ajoutés aux 3 server blocks (app, admin, wildcard) :

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
```

> **Important :** Après mise à jour du template, copier vers `/etc/nginx/sites-available/medimaestro` sur le serveur de production et recharger : `nginx -t && systemctl reload nginx`.

### 5. Cookies httpOnly (JWT Refresh Token)

#### Architecture avant/après

```
AVANT (vulnérable XSS) :
┌─────────────┐     localStorage      ┌──────────────┐
│  Frontend   │ ←──────────────────── │   Backend    │
│             │  access_token          │              │
│             │  refresh_token         │              │
└─────────────┘  (lisible par JS)     └──────────────┘

APRÈS (sécurisé) :
┌─────────────┐     Mémoire JS        ┌──────────────┐
│  Frontend   │ ←──────────────────── │   Backend    │
│             │  access_token (body)   │              │
│             │                        │              │
│             │ ←─── httpOnly cookie ─ │              │
│             │  refresh_token         │              │
└─────────────┘  (invisible au JS)    └──────────────┘
```

#### Backend — Configuration des cookies (`routes/auth.js`)

```javascript
function setRefreshTokenCookie(res, refreshToken) {
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,                              // Inaccessible via JavaScript
    secure: process.env.NODE_ENV === 'production', // HTTPS only en prod
    sameSite: isProduction ? 'strict' : 'lax',   // Protection CSRF
    path: '/api/v1/auth',                         // Envoyé uniquement aux routes auth
    maxAge: 7 * 24 * 60 * 60 * 1000,             // 7 jours
  });
}
```

**Flux modifiés :**

| Endpoint | Modification |
|---|---|
| `POST /auth/login` | Access token dans le body, refresh token dans cookie httpOnly |
| `POST /auth/refresh` | Lit le refresh token depuis le cookie (fallback: body). Rotation du refresh token à chaque appel. |
| `POST /auth/logout` | `clearCookie('refresh_token')` pour invalider la session |

#### Frontend — Stockage en mémoire (`api/baseClient.js`)

```javascript
// Variable module-level (mémoire volatile, pas localStorage)
let _accessToken = null;

export function setAccessToken(token) { _accessToken = token; }
export function clearAccessToken() {
  _accessToken = null;
  localStorage.removeItem('clinicmanager_token'); // Nettoyage migration
}
function getAuthToken() {
  if (_accessToken) return _accessToken;
  // Migration: lecture unique depuis localStorage, puis nettoyage
  const legacy = localStorage.getItem('clinicmanager_token');
  if (legacy) {
    _accessToken = legacy;
    localStorage.removeItem('clinicmanager_token');
    return _accessToken;
  }
  return null;
}
```

**Toutes les requêtes `fetch()` incluent `credentials: 'include'`** pour envoyer le cookie httpOnly automatiquement.

#### Frontend — Restauration de session (`SecureAuthContext.js`)

Au chargement de la page, la session est restaurée via le cookie refresh :

```javascript
// Pas de localStorage — le refresh token est dans le cookie httpOnly
const response = await baseClient.post('/auth/refresh', {});
// Le cookie est envoyé automatiquement grâce à credentials: 'include'
// Le backend retourne un nouveau access token dans le body
baseClient.setAccessToken(response.data.accessToken);
```

---

## Architecture de sécurité

### Couches de protection

```
┌─────────────────────────────────────────────────────┐
│                    NGINX                             │
│  • TLS 1.2/1.3 (HSTS preload)                      │
│  • Rate limiting (10r/s API, 1r/s login)            │
│  • CSP, X-Frame-Options, X-Content-Type-Options     │
│  • Referrer-Policy, Permissions-Policy              │
│  • Block .env, .git, dotfiles                       │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│                  EXPRESS (Backend)                    │
│  • Helmet.js (CSP, HSTS, frameguard)                │
│  • cookie-parser (httpOnly refresh tokens)          │
│  • CORS (origins whitelist + credentials)           │
│  • Rate limiting (RateLimiterMemory)                │
│  • Env validation au démarrage (fail-fast)          │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│              AUTH MIDDLEWARE                          │
│  • JWT signature verification                       │
│  • User validation contre base CENTRALE             │
│  • Company ID validation (anti-tampering)           │
│  • Role validation (détection de tampering)         │
│  • Membership check (multi-clinic)                  │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│              ROUTES & HANDLERS                       │
│  • Joi validation sur tous les inputs               │
│  • Permission checks via clinic_roles               │
│  • Audit logging des actions sensibles              │
│  • Isolation multi-tenant (base de données séparée) │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│              BASE DE DONNÉES                         │
│  • PostgreSQL avec authentification md5             │
│  • Base centrale (users, companies, subscriptions)  │
│  • Bases cliniques isolées (1 par clinique)          │
│  • Pas de mot de passe en fallback dans le code     │
└─────────────────────────────────────────────────────┘
```

### Flux d'authentification

```
1. LOGIN
   Client → POST /auth/login { email, password, [totpCode] }
   Server → Valide credentials contre base centrale
          → Vérifie 2FA si activé
          → Génère access token (24h) + refresh token (7j)
          → Retourne access token dans body JSON
          → Set refresh token dans cookie httpOnly
   Client → Stocke access token en mémoire (pas localStorage)

2. REQUÊTE API
   Client → GET /api/v1/patients
            Header: Authorization: Bearer <access_token>
            Cookie: refresh_token=<token> (envoyé automatiquement)
   Server → authMiddleware valide le JWT
          → clinicRoutingMiddleware isole la base clinique
          → Handler retourne les données

3. REFRESH
   Client → POST /auth/refresh {}
            Cookie: refresh_token=<token> (envoyé automatiquement)
   Server → Lit refresh token depuis le cookie
          → Valide le user en base centrale
          → Génère nouveau access token + nouveau refresh token
          → Retourne access token dans body
          → Set nouveau refresh token dans cookie (rotation)
   Client → Met à jour l'access token en mémoire

4. LOGOUT
   Client → POST /auth/logout
   Server → clearCookie('refresh_token')
   Client → clearAccessToken() (mémoire)
          → Redirection vers login
```

---

## Principes fondamentaux

### 1. La vérité unique au backend

Les rôles, permissions et données sensibles sont TOUJOURS validés côté serveur. Le frontend ne fait que de l'affichage conditionnel.

```javascript
// Backend : valider le rôle depuis la BD (pas le JWT)
req.user = {
  id: centralUser.id,
  role: centralUser.role,        // De la BD, pas du JWT
  companyId: jwtCompanyId,       // Validé contre la BD
  email: centralUser.email,      // De la BD
};
```

### 2. Isolation multi-tenant

Chaque clinique a sa propre base de données PostgreSQL. L'accès est contrôlé par :
- `clinicRoutingMiddleware` : résout la connexion à la bonne base clinique
- Validation du `companyId` dans le JWT contre la base centrale
- Vérification des `UserClinicMembership` pour les accès multi-cliniques

### 3. Zéro secret dans le code

- Aucun mot de passe, clé JWT ou secret en fallback dans le code source
- Tous les secrets viennent de variables d'environnement
- Le serveur refuse de démarrer si un secret obligatoire manque
- Le fichier `.env` n'est jamais commité (`.gitignore`)

### 4. Défense en profondeur

Chaque couche ajoute sa propre protection :
- **Nginx** : TLS, rate limiting, CSP, block dotfiles
- **Express** : Helmet, CORS, cookies httpOnly, rate limiting applicatif
- **Auth middleware** : validation JWT + validation base de données
- **Handlers** : validation Joi, permission checks, audit logging
- **Base de données** : isolation par base, pas de fallbacks

---

## Patterns de sécurité

### Pattern 1 : Utiliser `sanitizeHTML` pour tout contenu riche

```jsx
import { sanitizeHTML } from '../../utils/sanitize';

// TOUJOURS sanitiser avant dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: sanitizeHTML(content) }} />
```

### Pattern 2 : Utiliser `escapeHTML` pour les interpolations

```javascript
import { escapeHTML } from '../../utils/sanitize';

// TOUJOURS échapper les valeurs dans les templates HTML
const html = `<td>${escapeHTML(userInput)}</td>`;
```

### Pattern 3 : Ne jamais stocker de token en localStorage

```javascript
// INTERDIT
localStorage.setItem('token', accessToken);

// CORRECT
baseClient.setAccessToken(accessToken); // Mémoire volatile
```

### Pattern 4 : Passer les secrets via l'environnement du processus

```javascript
// INTERDIT — injection de commande possible
execAsync(`PGPASSWORD='${password}' psql ...`);

// CORRECT — le mot de passe est dans l'env du processus
execAsync('psql ...', { env: { ...process.env, PGPASSWORD: password } });
```

### Pattern 5 : Permissions vérifiées au backend

```javascript
// Le frontend masque les boutons (UX) mais le backend DOIT vérifier
router.delete('/patients/:id',
  authMiddleware,
  requirePermission('PATIENTS_DELETE'),
  deletePatient
);
```

---

## Fichiers de configuration (.env)

### Variables obligatoires

| Variable | Description | Fichier de référence |
|---|---|---|
| `JWT_SECRET` | Clé de signature JWT (min 32 chars) | `.env.example` |
| `JWT_REFRESH_SECRET` | Clé de signature refresh token | `.env.example` |
| `DB_PASSWORD` | Mot de passe PostgreSQL | `.env.example` |

### Variables recommandées

| Variable | Description | Fallback |
|---|---|---|
| `TOTP_ENCRYPTION_KEY` | Clé de chiffrement des secrets TOTP | `JWT_SECRET` (warning) |
| `CORS_ORIGIN` | Origins autorisés (comma-separated) | `http://localhost:3000` |
| `FRONTEND_URL` | URL du frontend (pour emails) | `http://localhost:3000` |

### Fichiers de référence

| Fichier | Usage |
|---|---|
| `.env.example` | Template pour développement local |
| `.env.production.example` | Template pour production (secrets via `/root/.secrets/`) |

---

## Checklist de sécurité

### Avant chaque commit

- [ ] Pas de secrets hardcodés (grep `password`, `secret`, `key` dans le diff)
- [ ] Tout `dangerouslySetInnerHTML` utilise `sanitizeHTML()`
- [ ] Tout `innerHTML` dans les fichiers HTML utilise `textContent` ou `escapeHTML`
- [ ] Pas de `localStorage` pour les tokens (utiliser `baseClient.setAccessToken`)
- [ ] Les nouveaux endpoints ont `authMiddleware` + `requirePermission()`
- [ ] Les inputs sont validés avec Joi
- [ ] Pas d'interpolation de variables dans les commandes shell
- [ ] Pas de `eval()` ou `Function()` constructors

### Avant un déploiement en production

- [ ] `.env.production.example` est à jour avec toutes les variables
- [ ] Les secrets sont dans `/root/.secrets/` (pas dans `.env`)
- [ ] `TOTP_ENCRYPTION_KEY` est différent de `JWT_SECRET`
- [ ] `CORS_ORIGIN` inclut tous les frontends (app + admin)
- [ ] Le template Nginx est copié et rechargé
- [ ] Les migrations sont appliquées sur la base centrale ET les bases cliniques
- [ ] Rate limiting est activé (`RATE_LIMIT_MAX_REQUESTS`)
- [ ] HTTPS est actif avec certificats valides
- [ ] `X-Robots-Tag: noindex` est présent sur tous les server blocks

### Déploiement du template Nginx mis à jour

```bash
# Sur le serveur de production
ssh -p 2222 root@72.62.51.173

# Copier le template mis à jour
cp /var/www/medical-pro-backend/scripts/production/nginx-multitenant.conf \
   /etc/nginx/sites-available/medimaestro

# Vérifier la syntaxe et recharger
nginx -t && systemctl reload nginx
```

---

## Tests de sécurité

### Test : les tokens ne sont plus dans localStorage

```javascript
// Console du navigateur (après login)
console.log(localStorage.getItem('clinicmanager_token')); // null
console.log(localStorage.getItem('clinicmanager_auth'));   // null
// Le token est uniquement en mémoire JavaScript — invisible aux outils XSS
```

### Test : le cookie refresh est httpOnly

```javascript
// Console du navigateur
console.log(document.cookie); // Le refresh_token N'APPARAÎT PAS
// Car il est httpOnly — JavaScript ne peut pas y accéder
```

### Test : la session survit au rechargement de page

```
1. Se connecter
2. Recharger la page (F5)
3. Vérifier que la session est restaurée (via POST /auth/refresh avec le cookie)
```

### Test : les headers CSP sont présents

```bash
# Vérifier les headers
curl -sI https://app.medimaestro.com | grep -i 'content-security\|strict-transport\|x-frame\|permissions-policy\|referrer-policy'
```

### Test : validation env vars

```bash
# Démarrer le backend sans JWT_SECRET → doit refuser
JWT_SECRET= node server.js
# FATAL: Missing required environment variables:
#   - JWT_SECRET: JWT signing secret (min 32 chars recommended)
```

### Test : tampering du JWT

```javascript
// Modifier le rôle dans le JWT → doit être rejeté
const jwt = require('jsonwebtoken');
const payload = jwt.decode(token);
payload.role = 'super_admin';
const fakeToken = jwt.sign(payload, 'wrong-secret');
// Résultat : 401 TOKEN_INVALID
```
