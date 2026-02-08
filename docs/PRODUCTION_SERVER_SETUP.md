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
│    ├── medimaestro.com      → Redirect to app.*             │
│    ├── app.medimaestro.com  → Frontend + API                │
│    └── *.medimaestro.com    → Frontend + API (wildcard)     │
├─────────────────────────────────────────────────────────────┤
│  Headers:                                                    │
│    X-Clinic-Subdomain: <subdomain>  (passé au backend)      │
├─────────────────────────────────────────────────────────────┤
│  Rate Limiting:                                              │
│    - API: 10 req/s (burst 20)                               │
│    - Login: 1 req/s (burst 5)                               │
└─────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
   ┌──────────────┐              ┌──────────────┐
   │   Frontend   │              │   Backend    │
   │  :3000 (PM2) │              │ :3001 (PM2)  │
   │   1 instance │              │ 2 instances  │
   └──────────────┘              └──────────────┘
```

### Fichiers de Log
| Log | Chemin |
|-----|--------|
| Access (app) | `/var/log/nginx/medimaestro_access.log` |
| Error (app) | `/var/log/nginx/medimaestro_error.log` |
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

## Historique des Modifications

| Date | Modification |
|------|--------------|
| 2026-02-08 | Installation initiale complète |
| 2026-02-08 | Configuration SSL (principal + wildcard) |
| 2026-02-08 | Sécurisation SSH (clé uniquement) |

---

*Document mis à jour: 8 février 2026*
*Installation réalisée avec Claude Code*
