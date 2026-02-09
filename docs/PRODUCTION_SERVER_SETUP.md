# MedicalPro - Production Server Setup

> **Status**: ✅ Installation complète - Production active
> **Date d'installation**: 8 février 2026

---

## Informations Serveur

| Propriété | Valeur |
|-----------|--------|
| **Adresse IP** | 72.62.51.173 |
| **Port SSH** | 2222 |
| **Domaine principal** | medimaestro.com |
| **Application** | https://app.medimaestro.com |
| **OS** | Ubuntu 24.04 LTS |
| **Hébergeur** | Hostinger VPS |
| **DNS Provider** | Hostinger (dns-parking.com) |

---

## URLs d'Accès

| URL | Description |
|-----|-------------|
| https://app.medimaestro.com | Application principale |
| https://admin.medimaestro.com | Portail admin SaaS (super_admin) |
| https://medimaestro.com | Redirige vers app.medimaestro.com |
| https://[clinique].medimaestro.com | Sous-domaine par clinique (wildcard) |

---

## Stack Technique Installée

| Composant | Version | Status |
|-----------|---------|--------|
| Node.js | 18.x LTS | ✅ Installé |
| PostgreSQL | 16 | ✅ Actif |
| Nginx | 1.24.0 | ✅ Actif |
| PM2 | Latest | ✅ Actif (auto-start) |
| Certbot | Latest | ✅ SSL configuré |
| Fail2ban | Latest | ✅ Actif |
| UFW Firewall | Latest | ✅ Configuré |

---

## Certificats SSL

| Certificat | Domaines | Emplacement | Expiration |
|------------|----------|-------------|------------|
| Principal | medimaestro.com, app.medimaestro.com | `/etc/letsencrypt/live/medimaestro.com/` | 9 mai 2026 |
| Wildcard | *.medimaestro.com | `/etc/letsencrypt/live/medimaestro.com-0001/` | 9 mai 2026 |

> Le renouvellement automatique est configuré via certbot (cron le 1er du mois à 4h)

---

## Configuration Firewall (UFW)

```
Port 2222/tcp  - SSH (port personnalisé)
Port 80/tcp    - HTTP (redirection vers HTTPS)
Port 443/tcp   - HTTPS
```

---

## Configuration SSH

**Fichier**: `/etc/ssh/sshd_config.d/medicalpro.conf`

```
Port 2222
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowTcpForwarding no
```

**Connexion**:
```bash
ssh -p 2222 root@72.62.51.173
```

> ⚠️ Authentification par clé SSH uniquement (mot de passe désactivé)

---

## Déploiement Application

### Backend
| Propriété | Valeur |
|-----------|--------|
| **Emplacement** | `/var/www/medical-pro-backend` |
| **Branche** | `feature/catalog-backend-integration` |
| **Instances PM2** | 2 (mode cluster) |
| **Port** | 3001 |

### Frontend
| Propriété | Valeur |
|-----------|--------|
| **Emplacement** | `/var/www/medical-pro` |
| **Branche** | `feature/catalog-backend-integration` |
| **Instances PM2** | 1 (mode fork) |
| **Port** | 3000 |

---

## Configuration Base de Données

### Base Centrale
| Propriété | Valeur |
|-----------|--------|
| **Nom** | medicalpro_central |
| **Utilisateur** | medicalpro |
| **Hôte** | localhost |
| **Port** | 5432 |

### Migrations Appliquées
- ✅ `central_001_initial_schema.sql`
- ✅ `central_002_add_locale_to_companies.sql`
- ✅ `central_003_user_clinic_memberships.sql`
- ✅ `central_004_add_clinic_db_provisioned.sql`
- ✅ `central_005_add_subdomain.sql`
- ✅ `central_006_add_totp_fields.sql`

### Colonnes Ajoutées Manuellement (companies)
> Ces colonnes existent dans le modèle Sequelize mais n'étaient pas dans les migrations central_001-005.
> Elles ont été ajoutées via ALTER TABLE le 9 février 2026.

- `business_number VARCHAR(20)` — SIRET (FR) / NIF (ES)
- `vat_number VARCHAR(20)` — Numéro de TVA
- `settings JSONB DEFAULT '{}'` — Paramètres clinique
- `setup_completed_at TIMESTAMP` — Date de fin de setup initial

### Architecture Multi-Tenant
Chaque clinique dispose de sa propre base de données:
- Nom format: `medicalpro_clinic_<uuid_sans_tirets>`
- Isolation complète des données patients

---

## Secrets et Credentials

### Emplacement des Secrets
Tous les secrets sont stockés dans `/root/.secrets/` avec permissions 600:

| Fichier | Description |
|---------|-------------|
| `db_password` | Mot de passe PostgreSQL |
| `jwt_secret` | Clé de signature JWT |
| `jwt_refresh_secret` | Clé refresh token JWT |
| `backup_key` | Clé de chiffrement GPG pour backups |
| `encryption_key` | Clé de chiffrement générale |

### Compte SuperAdmin

| Propriété | Valeur |
|-----------|--------|
| **Email** | josedavid.orts@gmail.com |
| **Mot de passe** | SuperAdmin2025! |
| **Rôle** | super_admin |

> ⚠️ **IMPORTANT**: Changez ce mot de passe après la première connexion !

---

## Configuration DNS

### Enregistrements Configurés (Hostinger)

| Type | Nom | Valeur |
|------|-----|--------|
| A | @ | 72.62.51.173 |
| A | app | 72.62.51.173 |
| A | * | 72.62.51.173 |

> L'enregistrement wildcard (`*`) permet le routage automatique des sous-domaines cliniques

---

## Configuration Nginx

**Fichier**: `/etc/nginx/sites-available/medimaestro`

### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                         NGINX                                │
├─────────────────────────────────────────────────────────────┤
│  HTTP (:80)           → Redirect to HTTPS                   │
│  HTTPS (:443)                                               │
│    ├── medimaestro.com        → Redirect to app.*           │
│    ├── app.medimaestro.com    → Frontend + API              │
│    ├── admin.medimaestro.com  → Admin Portal (static)       │
│    └── *.medimaestro.com      → Frontend + API (wildcard)   │
├─────────────────────────────────────────────────────────────┤
│  Headers:                                                    │
│    X-Clinic-Subdomain: <subdomain>  (passé au backend)      │
├─────────────────────────────────────────────────────────────┤
│  Rate Limiting:                                              │
│    - API: 10 req/s (burst 20)                               │
│    - Login: 1 req/s (burst 5)                               │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌──────────────┐   ┌───────────────┐    ┌──────────────┐
   │   Frontend   │   │ Admin Portal  │    │   Backend    │
   │  :3000 (PM2) │   │ Static files  │    │ :3001 (PM2)  │
   │   1 instance │   │ (Nginx only)  │    │ 2 instances  │
   └──────────────┘   └───────────────┘    └──────────────┘
```

### Fichiers de Log
| Log | Chemin |
|-----|--------|
| Access (app) | `/var/log/nginx/medimaestro_access.log` |
| Error (app) | `/var/log/nginx/medimaestro_error.log` |
| Access (admin) | `/var/log/nginx/medimaestro_admin_access.log` |
| Error (admin) | `/var/log/nginx/medimaestro_admin_error.log` |
| Access (clinics) | `/var/log/nginx/medimaestro_clinics_access.log` |
| Error (clinics) | `/var/log/nginx/medimaestro_clinics_error.log` |

---

## Scripts de Production

Tous les scripts sont installés dans `/opt/scripts/`:

| Script | Description | Planification |
|--------|-------------|---------------|
| `backup-medicalpro.sh` | Sauvegarde chiffrée GPG | Quotidien 3h00 |
| `restore-medicalpro.sh` | Restauration depuis backup | Manuel |
| `health-check.sh` | Monitoring système | Toutes les 5 min |
| `manage-clinic-subdomain.sh` | Gestion sous-domaines | Manuel |
| `provision-clinic-db.sh` | Création base clinique | Manuel |
| `setup-wildcard-ssl.sh` | Renouvellement SSL wildcard | Manuel |
| `setup-slack-alerts.sh` | Configuration alertes Slack | Manuel |
| `install-netdata.sh` | Installation monitoring | Manuel |

---

## Tâches Cron

**Fichier**: `/etc/cron.d/medicalpro`

```cron
# Sauvegarde quotidienne à 3h00
0 3 * * * root /opt/scripts/backup-medicalpro.sh >> /var/log/medicalpro-backup.log 2>&1

# Health check toutes les 5 minutes
*/5 * * * * root /opt/scripts/health-check.sh >> /var/log/medicalpro-health.log 2>&1

# Renouvellement SSL le 1er du mois à 4h00
0 4 1 * * root certbot renew --quiet --post-hook "systemctl reload nginx" >> /var/log/certbot-renew.log 2>&1
```

---

## Emplacements des Logs

| Service | Chemin |
|---------|--------|
| PM2 Backend | `/root/.pm2/logs/medical-pro-backend-*.log` |
| PM2 Frontend | `/root/.pm2/logs/medical-pro-frontend-*.log` |
| Nginx Access | `/var/log/nginx/medimaestro_access.log` |
| Nginx Error | `/var/log/nginx/medimaestro_error.log` |
| PostgreSQL | `/var/log/postgresql/postgresql-16-main.log` |
| Backup | `/var/log/medicalpro-backup.log` |
| Health Check | `/var/log/medicalpro-health.log` |
| Fail2ban | `/var/log/fail2ban.log` |
| Certbot | `/var/log/letsencrypt/letsencrypt.log` |

---

## Opérations Courantes

### Vérifier l'état des services
```bash
pm2 status                    # État des applications
systemctl status nginx        # Serveur web
systemctl status postgresql   # Base de données
fail2ban-client status        # Protection brute-force
```

### Consulter les logs
```bash
pm2 logs                      # Tous les logs PM2
pm2 logs medical-pro-backend  # Backend uniquement
tail -f /var/log/nginx/medimaestro_error.log
journalctl -u nginx -f        # Logs Nginx systemd
```

### Redémarrer les services
```bash
pm2 restart all               # Redémarrer applications
pm2 reload all                # Reload sans downtime
systemctl reload nginx        # Recharger config Nginx
systemctl restart postgresql  # Redémarrer BDD
```

### Déployer une mise à jour
```bash
# Backend
cd /var/www/medical-pro-backend
git pull origin master
npm ci --omit=dev
pm2 restart medical-pro-backend

# Frontend
cd /var/www/medical-pro
git pull origin master
npm ci --legacy-peer-deps
npm run build
pm2 restart medical-pro-frontend

# Admin Portal
cd /var/www/medical-pro-admin
git pull origin master
npm ci
npm run build
# Pas de PM2, fichiers statiques servis par Nginx
```

### Gérer les sous-domaines cliniques
```bash
# Lister toutes les cliniques
/opt/scripts/manage-clinic-subdomain.sh list

# Ajouter un sous-domaine
/opt/scripts/manage-clinic-subdomain.sh add <clinic_id> <subdomain>

# Vérifier disponibilité
/opt/scripts/manage-clinic-subdomain.sh check <subdomain>

# Suggérer un sous-domaine
/opt/scripts/manage-clinic-subdomain.sh suggest "Clínica Ozondenia"
```

### Sauvegardes
```bash
# Sauvegarde manuelle
/opt/scripts/backup-medicalpro.sh

# Lister les sauvegardes
ls -la /var/backups/medicalpro/

# Restaurer une sauvegarde
/opt/scripts/restore-medicalpro.sh /var/backups/medicalpro/central_YYYYMMDD.dump.gpg medicalpro_central
```

### Provisionner une nouvelle clinique
```bash
/opt/scripts/provision-clinic-db.sh <clinic_uuid>
```

---

## Sécurité

### Mesures en place

| Mesure | Description |
|--------|-------------|
| **SSH** | Port 2222, clé uniquement, root avec clé |
| **Fail2ban** | Blocage après 3 tentatives SSH échouées |
| **UFW** | Seuls ports 80, 443, 2222 ouverts |
| **PostgreSQL** | Connexions locales uniquement |
| **Secrets** | Stockés hors webroot dans `/root/.secrets/` |
| **Backups** | Chiffrés avec GPG AES256 |
| **HTTPS** | TLS 1.2/1.3, HSTS activé |
| **Headers** | X-Frame-Options, X-Content-Type-Options |
| **Rate Limiting** | API et login protégés |

### Conformité RGPD/LOPD
- Chiffrement en transit (HTTPS/TLS)
- Isolation des données par clinique (multi-tenant)
- Logs d'audit disponibles
- Sauvegardes chiffrées

---

## Dépannage

### L'application ne répond pas
```bash
# Vérifier PM2
pm2 status
pm2 logs --err

# Vérifier Nginx
nginx -t
systemctl status nginx

# Vérifier la BDD
systemctl status postgresql
```

### Erreur 502 Bad Gateway
```bash
# Le backend ne répond pas
pm2 restart medical-pro-backend
pm2 logs medical-pro-backend --err
```

### Erreur 503 Clinic not ready
La base de données de la clinique n'est pas provisionnée:
```bash
/opt/scripts/provision-clinic-db.sh <clinic_uuid>
```

### Certificat SSL expiré
```bash
certbot renew --force-renewal
systemctl reload nginx
```

### Espace disque plein
```bash
# Vérifier l'espace
df -h

# Nettoyer les vieux backups (garde 30 jours)
find /var/backups/medicalpro -name "*.dump.gpg" -mtime +30 -delete

# Nettoyer les logs PM2
pm2 flush
```

---

## Configuration Optionnelle

### Alertes Slack
```bash
/opt/scripts/setup-slack-alerts.sh
```
Nécessite un webhook URL Slack.

### Monitoring Netdata
```bash
/opt/scripts/install-netdata.sh
# Ajouter règle firewall si accès externe souhaité
ufw allow 19999/tcp
```
Accessible sur: `https://app.medimaestro.com:19999`

---

## Contacts Support

| Type | Contact |
|------|---------|
| **Problèmes serveur** | Support Hostinger |
| **Problèmes DNS** | Panel Hostinger |
| **Problèmes applicatifs** | Logs + escalade |

---

## CI/CD - Déploiement Automatique

### Architecture de Déploiement

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        GitHub Repositories                              │
├─────────────────────────────────────────────────────────────────────────┤
│  medical-pro-backend     medical-pro-admin     medical-pro (frontend)  │
│         │                       │                      │               │
│         ▼                       ▼                      ▼               │
│   push to master          push to master         push to master        │
│         │                       │                      │               │
│         ▼                       ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    GitHub Actions                                │   │
│  │  - Workflow: deploy-production.yml (backend/admin)               │   │
│  │  - Workflow: build-and-deploy.yml (frontend: build + deploy)    │   │
│  │  - Uses: appleboy/ssh-action                                    │   │
│  │  - Secrets: PROD_HOST, PROD_SSH_KEY, PROD_SSH_PORT              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                 │                                       │
│                                 ▼ SSH (port 2222)                       │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Production Server (72.62.51.173)                   │
├─────────────────────────────────────────────────────────────────────────┤
│  User: deploy (permissions limitées)                                    │
│  Actions autorisées:                                                    │
│    - git fetch/pull dans /var/www/                                      │
│    - npm ci / npm run build                                             │
│    - sudo pm2 restart (NOPASSWD)                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Secrets GitHub Configurés

| Repository | Secret | Description |
|------------|--------|-------------|
| medical-pro-backend | `PROD_HOST` | 72.62.51.173 |
| medical-pro-backend | `PROD_SSH_PORT` | 2222 |
| medical-pro-backend | `PROD_SSH_KEY` | Clé privée ED25519 (deploy user) |
| medical-pro-admin | `PROD_HOST` | 72.62.51.173 |
| medical-pro-admin | `PROD_SSH_PORT` | 2222 |
| medical-pro-admin | `PROD_SSH_KEY` | Clé privée ED25519 (deploy user) |
| medical-pro (frontend) | `PROD_HOST` | 72.62.51.173 |
| medical-pro (frontend) | `PROD_SSH_PORT` | 2222 |
| medical-pro (frontend) | `PROD_SSH_KEY` | Clé privée ED25519 (deploy user) |

### Utilisateur Deploy

| Propriété | Valeur |
|-----------|--------|
| **Username** | deploy |
| **Home** | /home/deploy |
| **Clé SSH** | /home/deploy/.ssh/id_ed25520 (GitHub Actions deploy key) |
| **Permissions sudo** | pm2 uniquement (NOPASSWD) |
| **Groupes** | deploy, www-data |

### Workflow de Déploiement

1. **Push sur master/main** → GitHub Actions déclenché automatiquement
2. **SSH vers production** → Connexion avec clé deploy
3. **git fetch + reset** → Récupération du code
4. **npm ci** → Installation des dépendances
5. **npm run build** → Compilation (frontend/admin)
6. **pm2 restart** → Redémarrage du service
7. **Health check** → Vérification du endpoint /health

### Déclenchement Manuel

Possible via GitHub → Actions → "Run workflow"

---

## Sécurité Admin Portal

### Double Authentification (2FA/TOTP)

| Composant | Description |
|-----------|-------------|
| **Type** | TOTP (Time-based One-Time Password) |
| **Apps compatibles** | Google Authenticator, Authy, 1Password |
| **Algorithme** | HMAC-SHA1, 6 digits, 30 secondes |
| **Backup codes** | 10 codes à usage unique, hashés bcrypt |
| **Chiffrement secret** | AES-256 avec clé dans `TOTP_ENCRYPTION_KEY` |

### Flux d'Authentification Admin

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Admin Login Flow                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Saisie email/password                                               │
│         │                                                                │
│         ▼                                                                │
│  2. Vérification credentials (bcrypt)                                   │
│         │                                                                │
│         ├─── Échec ──► Incrément rate limit ──► Message erreur          │
│         │                                                                │
│         ▼ Succès                                                         │
│  3. Vérification 2FA activé ?                                           │
│         │                                                                │
│         ├─── Non ──► Connexion réussie ──► Dashboard                    │
│         │                                                                │
│         ▼ Oui                                                            │
│  4. Demande code TOTP                                                   │
│         │                                                                │
│         ▼                                                                │
│  5. Vérification code (TOTP ou backup)                                  │
│         │                                                                │
│         ├─── Échec ──► Message erreur ──► Retry                         │
│         │                                                                │
│         ▼ Succès                                                         │
│  6. Génération tokens JWT ──► Stockage sessionStorage                   │
│         │                                                                │
│         ▼                                                                │
│  7. Accès Dashboard Admin                                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Endpoints 2FA

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/v1/auth/2fa/status` | GET | État 2FA de l'utilisateur |
| `/api/v1/auth/2fa/setup` | POST | Initialiser configuration 2FA |
| `/api/v1/auth/2fa/verify-setup` | POST | Valider et activer 2FA |
| `/api/v1/auth/2fa/validate` | POST | Valider code pendant login |
| `/api/v1/auth/2fa/disable` | POST | Désactiver 2FA |
| `/api/v1/auth/2fa/regenerate-backup` | POST | Nouveaux codes backup |

### Migration Base de Données

**Fichier**: `migrations/central_006_add_totp_fields.sql`

```sql
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN totp_secret VARCHAR(255);       -- Chiffré AES-256
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT[];       -- Hashés bcrypt
ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMP;
```

### Mesures de Sécurité Implémentées

| Mesure | Implémentation |
|--------|----------------|
| **Rate limiting login** | 5 tentatives / 15 minutes (client-side) |
| **Stockage tokens** | sessionStorage (pas localStorage) |
| **Expiration token** | Vérification côté client avant requêtes |
| **Validation input** | Email format, password 8+ chars |
| **Headers sécurité** | X-Requested-With pour CSRF |
| **Timeout requêtes** | 10 secondes max |

---

## Configuration CORS Backend

**Fichier**: `/var/www/medical-pro-backend/.env` (sur le serveur prod)

```
CORS_ORIGIN=https://app.medimaestro.com,https://admin.medimaestro.com
```

> Le backend accepte les requêtes cross-origin depuis les deux domaines.
> L'admin utilise des URLs relatives (`REACT_APP_API_URL=` vide) pour éviter le CORS via le proxy Nginx,
> mais le CORS est configuré comme filet de sécurité.

### Configuration Admin API

**Fichier**: `/var/www/medical-pro-admin/.env.production`

```
REACT_APP_API_URL=
```

> **Important**: Les variables `REACT_APP_*` sont intégrées au build React.
> Après modification, il faut rebuilder l'app : `npm run build`

---

## Admin Portal (medical-pro-admin)

### Informations

| Propriété | Valeur |
|-----------|--------|
| **URL** | https://admin.medimaestro.com |
| **Emplacement** | /var/www/medical-pro-admin |
| **Repository** | github.com/jdavido74/medical-pro-admin |
| **Serveur** | Nginx (fichiers statiques, pas de PM2) |
| **Port dev** | 3002 |

### Fonctionnalités

- Gestion des cliniques (CRUD)
- Gestion des utilisateurs super_admin
- Provisionnement des bases de données cliniques
- Monitoring santé des services
- Configuration 2FA obligatoire pour accès

---

## Historique des Modifications

| Date | Modification |
|------|--------------|
| 2026-02-08 | Installation initiale complète |
| 2026-02-08 | Configuration SSL (principal + wildcard) |
| 2026-02-08 | Sécurisation SSH (clé uniquement) |
| 2026-02-09 | Ajout 2FA (TOTP) pour admin portal |
| 2026-02-09 | Configuration CI/CD GitHub Actions |
| 2026-02-09 | Création utilisateur deploy avec permissions limitées |
| 2026-02-09 | CI/CD frontend (medical-pro): build-and-deploy.yml avec appleboy/ssh-action |
| 2026-02-09 | Fix permissions deploy SSH: .ssh 700, authorized_keys owner deploy:deploy |
| 2026-02-09 | Secrets GitHub configurés pour les 3 repos (backend, admin, frontend) |
| 2026-02-09 | Déploiement admin portal: clone, build, config Nginx admin.medimaestro.com |
| 2026-02-09 | Anti-crawling: robots.txt + X-Robots-Tag sur tous les server blocks Nginx |
| 2026-02-09 | Fix CORS admin: REACT_APP_API_URL vide (URLs relatives) + CORS_ORIGIN multi-origines |
| 2026-02-09 | Migration central_006 (TOTP) + colonnes manquantes companies (business_number, etc.) |
| 2026-02-09 | Fix Sequelize raw queries: bind syntax `{ bind: [...] }` dans auth.js, totp.js, clinicSubdomain.js |
| 2026-02-09 | Export getCentralDbConnection depuis config/database.js |
| 2026-02-09 | Reset mot de passe super_admin (bcrypt hash régénéré) |

---

*Document mis à jour: 9 février 2026*
*Installation et maintenance avec Claude Code*
