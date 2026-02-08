# MedicalPro - Guide de Déploiement Production

## Table des matières

1. [Prérequis](#prérequis)
2. [Phase 0: Préparation Serveur](#phase-0-préparation-serveur)
3. [Phase 1: Installation Stack](#phase-1-installation-stack)
4. [Phase 2: Configuration PostgreSQL](#phase-2-configuration-postgresql)
5. [Phase 3: Déploiement Application](#phase-3-déploiement-application)
6. [Phase 4: Nginx + SSL](#phase-4-nginx--ssl)
7. [Phase 5: Sauvegardes](#phase-5-sauvegardes)
8. [Phase 6: CI/CD GitHub Actions](#phase-6-cicd-github-actions)
9. [Phase 7: Monitoring](#phase-7-monitoring)
10. [Conformité RGPD/LOPD](#conformité-rgpdlopd)
11. [Checklist Finale](#checklist-finale)

---

## Prérequis

### Informations à préparer

- [ ] IP du VPS Hostinger production
- [ ] Nom de domaine (ex: app.medimaestro.com)
- [ ] Accès root SSH au nouveau serveur
- [ ] Compte Backblaze/Hetzner pour sauvegardes externes (optionnel)
- [ ] Compte SMTP production (SendGrid, Mailgun, OVH...)

### Spécifications VPS recommandées (1-10 cliniques)

| Ressource | Recommandation |
|-----------|---------------|
| CPU | 2-4 vCPU |
| RAM | 4-8 GB |
| Stockage | 80-160 GB SSD |
| OS | Ubuntu 22.04 LTS ou Debian 12 |

---

## Phase 0: Préparation Serveur

### Option A: Script automatique (recommandé)

```bash
# Connexion au serveur
ssh root@IP_SERVEUR

# Télécharger et exécuter le script d'initialisation
curl -O https://raw.githubusercontent.com/jdavido74/medical-pro-backend/master/scripts/production/server-init.sh
chmod +x server-init.sh

# Personnaliser les variables si nécessaire
export DOMAIN="app.medimaestro.com"
export SSH_PORT="2222"
export ADMIN_USER="adminpro"
export ADMIN_EMAIL="admin@medimaestro.com"

# Exécuter
sudo ./server-init.sh
```

### Option B: Installation manuelle

#### 0.1 Première connexion et sécurisation SSH

```bash
# Mettre à jour le système
apt update && apt upgrade -y

# Créer utilisateur admin
adduser adminpro
usermod -aG sudo adminpro

# Configurer SSH sécurisé
nano /etc/ssh/sshd_config.d/medicalpro.conf
```

Contenu de `medicalpro.conf`:
```
Port 2222
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

```bash
# Ajouter clé SSH
mkdir -p /home/adminpro/.ssh
echo "VOTRE_CLE_PUBLIQUE" >> /home/adminpro/.ssh/authorized_keys
chown -R adminpro:adminpro /home/adminpro/.ssh
chmod 700 /home/adminpro/.ssh
chmod 600 /home/adminpro/.ssh/authorized_keys

# Redémarrer SSH
systemctl restart sshd
```

#### 0.2 Firewall UFW

```bash
apt install ufw -y
ufw default deny incoming
ufw default allow outgoing
ufw allow 2222/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw enable
```

#### 0.3 Fail2ban

```bash
apt install fail2ban -y

cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
EOF

systemctl enable fail2ban
systemctl start fail2ban
```

---

## Phase 1: Installation Stack

### 1.1 Node.js 18 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs
npm install -g pm2
```

### 1.2 PostgreSQL 16

```bash
sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt update
apt install -y postgresql-16 postgresql-contrib-16
systemctl enable postgresql
systemctl start postgresql
```

### 1.3 Nginx & Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
```

### 1.4 Outils essentiels

```bash
apt install -y git curl wget htop unzip gpg rclone mailutils
```

---

## Phase 2: Configuration PostgreSQL

### 2.1 Générer les secrets

```bash
# Exécuter le script de configuration des secrets
sudo /var/www/medical-pro-backend/scripts/production/setup-secrets.sh
```

Ou manuellement:

```bash
mkdir -p /root/.secrets && chmod 700 /root/.secrets
openssl rand -base64 32 > /root/.secrets/db_password
openssl rand -base64 64 > /root/.secrets/jwt_secret
openssl rand -base64 64 > /root/.secrets/jwt_refresh_secret
openssl rand -base64 32 > /root/.secrets/backup_key
chmod 600 /root/.secrets/*
```

### 2.2 Créer utilisateur et base

```bash
sudo -u postgres psql << EOF
CREATE USER medicalpro WITH PASSWORD '$(cat /root/.secrets/db_password)';
ALTER USER medicalpro CREATEDB;
CREATE DATABASE medicalpro_central OWNER medicalpro;
EOF
```

### 2.3 Configuration sécurisée

```bash
# Ajouter à /etc/postgresql/16/main/postgresql.conf
cat >> /etc/postgresql/16/main/postgresql.conf << 'EOF'
ssl = on
password_encryption = scram-sha-256
log_connections = on
log_disconnections = on
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB
EOF

# Remplacer pg_hba.conf
cat > /etc/postgresql/16/main/pg_hba.conf << 'EOF'
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF

systemctl restart postgresql

# Extension pgcrypto
sudo -u postgres psql -d medicalpro_central -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

---

## Phase 3: Déploiement Application

### 3.1 Structure des répertoires

```bash
mkdir -p /var/www/medical-pro /var/www/medical-pro-backend
chown -R adminpro:www-data /var/www/medical-pro*
chmod -R 775 /var/www/medical-pro*
```

### 3.2 Cloner les repos

```bash
cd /var/www
git clone git@github.com:jdavido74/medical-pro.git
git clone git@github.com:jdavido74/medical-pro-backend.git
```

### 3.3 Configuration production

```bash
# Copier le template
cp /var/www/medical-pro-backend/.env.production.example /var/www/medical-pro-backend/.env

# Éditer avec vos valeurs
nano /var/www/medical-pro-backend/.env
```

Variables essentielles à configurer:
- `CORS_ORIGIN` - Votre domaine production
- `SMTP_*` - Configuration email
- `FROM_EMAIL` - Email d'envoi

### 3.4 Installer dépendances et construire

```bash
cd /var/www/medical-pro-backend && npm ci --production
cd /var/www/medical-pro && npm ci && npm run build
```

### 3.5 Démarrer avec PM2

```bash
cd /var/www/medical-pro-backend
pm2 start ecosystem.production.config.js
pm2 save
pm2 startup
```

### 3.6 Migrations base de données

```bash
cd /var/www/medical-pro-backend
npm run migrate
```

---

## Phase 4: Nginx + SSL

### 4.1 Installer la configuration Nginx

```bash
# Copier la configuration
sudo /var/www/medical-pro-backend/scripts/production/install-production-scripts.sh

# Activer le site
ln -s /etc/nginx/sites-available/medicalpro /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

# Éditer pour votre domaine
nano /etc/nginx/sites-available/medicalpro
# Remplacer "app.medimaestro.com" par votre domaine

# Tester et recharger
nginx -t
systemctl reload nginx
```

### 4.2 Obtenir certificat SSL

```bash
certbot --nginx -d app.medimaestro.com --non-interactive --agree-tos -m admin@medimaestro.com
```

---

## Phase 5: Sauvegardes

### 5.1 Installer les scripts

```bash
sudo /var/www/medical-pro-backend/scripts/production/install-production-scripts.sh
```

### 5.2 Tester la sauvegarde

```bash
sudo /opt/scripts/backup-medicalpro.sh
```

### 5.3 Vérifier les crons

```bash
cat /etc/cron.d/medicalpro
```

### 5.4 Test de restauration

```bash
# Lister les sauvegardes disponibles
ls -la /var/backups/medicalpro/

# Test de restauration (dry-run)
sudo /opt/scripts/restore-medicalpro.sh --dry-run central_YYYYMMDD_HHMMSS.dump.gpg medicalpro_central
```

---

## Phase 6: CI/CD GitHub Actions

### 6.1 Créer utilisateur déploiement

```bash
useradd -m -s /bin/bash deploy
usermod -aG www-data deploy

# Générer clé SSH
sudo -u deploy ssh-keygen -t ed25519 -N "" -f /home/deploy/.ssh/id_ed25519

# Afficher la clé publique
cat /home/deploy/.ssh/id_ed25519.pub
```

### 6.2 Configurer les secrets GitHub

Dans votre repo GitHub, aller dans **Settings > Secrets > Actions** et ajouter:

| Secret | Valeur |
|--------|--------|
| `PROD_HOST` | IP du serveur |
| `PROD_SSH_KEY` | Contenu de `/home/deploy/.ssh/id_ed25519` |
| `PROD_SSH_PORT` | `2222` (ou votre port SSH) |

### 6.3 Ajouter la clé de déploiement sur GitHub

La clé publique (`/home/deploy/.ssh/id_ed25519.pub`) doit être ajoutée comme **Deploy Key** dans:
- **Settings > Deploy Keys** de chaque repo

### 6.4 Permissions deploy

```bash
chown -R deploy:www-data /var/www/medical-pro*
chmod -R 775 /var/www/medical-pro*
echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2" >> /etc/sudoers.d/deploy
```

---

## Phase 7: Monitoring

### 7.1 PM2 Logrotate

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 7.2 Netdata (Dashboard temps réel)

```bash
# Installer Netdata
sudo /opt/scripts/install-netdata.sh
```

Netdata fournit un dashboard web avec métriques en temps réel :
- CPU, RAM, Disque, Réseau
- PostgreSQL (connexions, requêtes)
- Nginx (requêtes, connexions actives)
- Processus Node.js/PM2

**Accès au dashboard** (via SSH tunnel pour sécurité) :
```bash
ssh -L 19999:localhost:19999 user@server
# Puis ouvrir http://localhost:19999
```

### 7.3 Alertes Slack

```bash
# Configurer Slack
sudo /opt/scripts/setup-slack-alerts.sh

# Tester les alertes
sudo /opt/scripts/test-slack-alert.sh info
sudo /opt/scripts/test-slack-alert.sh warning
sudo /opt/scripts/test-slack-alert.sh critical
```

**Prérequis Slack** :
1. Créer une app sur https://api.slack.com/apps
2. Activer "Incoming Webhooks"
3. Créer un webhook pour votre channel #alerts
4. Copier l'URL du webhook

### 7.4 Health checks automatiques

Les health checks s'exécutent toutes les 5 minutes et vérifient :
- ✅ API Backend (HTTP 200 sur /api/v1/health)
- ✅ Frontend (HTTP 200)
- ✅ PostgreSQL (connexion réussie)
- ✅ PM2 (processus online)
- ✅ Espace disque (warning 85%, critical 95%)
- ✅ Mémoire RAM (warning 90%, critical 95%)

Pour vérifier manuellement :
```bash
/opt/scripts/health-check.sh
```

### 7.5 Logs

```bash
# Logs PM2
pm2 logs

# Logs Nginx
tail -f /var/log/nginx/medicalpro_*.log

# Logs sauvegardes
tail -f /var/log/medicalpro-backup.log

# Logs alertes
tail -f /var/log/medicalpro-alerts.log
```

---

## Conformité RGPD/LOPD

### Exigences implémentées

| Exigence | Solution |
|----------|----------|
| Chiffrement en transit | HTTPS/TLS 1.2+ |
| Chiffrement au repos | pgcrypto |
| Contrôle d'accès | JWT + RBAC |
| Journalisation | audit_logs |
| Sauvegardes chiffrées | GPG AES256 |

### Documents à préparer

1. **Politique de confidentialité** - Informer les patients
2. **Contrat sous-traitance (DPA)** - Entre vous et les cliniques
3. **Registre des traitements** - Article 30 RGPD
4. **Procédure de violation** - Notification AEPD sous 72h
5. **Analyse d'impact (AIPD)** - Requise pour données de santé

### Contact autorité espagnole

- **AEPD** (Agencia Española de Protección de Datos)
- Site: https://www.aepd.es

---

## Checklist Finale

### Sécurité
- [ ] SSH sur port personnalisé, root désactivé
- [ ] UFW actif (ports 2222/80/443)
- [ ] Fail2ban actif
- [ ] PostgreSQL local uniquement
- [ ] Secrets dans /root/.secrets
- [ ] Certificat SSL valide

### Application
- [ ] PM2 démarre au boot (`pm2 startup`)
- [ ] Frontend accessible HTTPS
- [ ] API répond sur /api/v1/health
- [ ] Base de données opérationnelle

### Sauvegardes
- [ ] Script backup testé
- [ ] Cron configuré (3h quotidien)
- [ ] Test de restauration réussi

### CI/CD
- [ ] Utilisateur deploy créé
- [ ] Clés SSH configurées sur GitHub
- [ ] Workflow testé

---

## Commandes utiles

```bash
# Status de l'application
pm2 status

# Redémarrer l'application
pm2 restart all

# Voir les logs
pm2 logs

# Vérifier Nginx
nginx -t && systemctl reload nginx

# Vérifier PostgreSQL
systemctl status postgresql

# Sauvegarde manuelle
/opt/scripts/backup-medicalpro.sh

# Health check manuel
/opt/scripts/health-check.sh
```
