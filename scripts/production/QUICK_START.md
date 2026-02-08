# MedicalPro Production - Quick Start Guide

## Vue d'ensemble des scripts

Ce répertoire contient tous les scripts nécessaires pour installer et maintenir MedicalPro en production.

```
scripts/production/
├── server-init.sh              # Installation complète du serveur
├── setup-secrets.sh            # Génération des secrets (JWT, DB, etc.)
├── install-production-scripts.sh # Installation des scripts dans /opt/scripts
├── backup-medicalpro.sh        # Sauvegarde quotidienne des bases
├── restore-medicalpro.sh       # Restauration depuis sauvegarde
├── health-check.sh             # Vérification santé système
├── provision-clinic-db.sh      # Création base clinique
├── nginx-medicalpro.conf       # Configuration Nginx
└── QUICK_START.md              # Ce fichier
```

## Installation rapide (serveur neuf)

### 1. Connexion au serveur

```bash
ssh root@VOTRE_IP_SERVEUR
```

### 2. Télécharger le script d'initialisation

```bash
# Option A: Depuis GitHub (recommandé)
curl -O https://raw.githubusercontent.com/jdavido74/medical-pro-backend/master/scripts/production/server-init.sh

# Option B: Copier depuis votre machine locale
scp scripts/production/server-init.sh root@VOTRE_IP_SERVEUR:/root/
```

### 3. Configurer et exécuter

```bash
chmod +x server-init.sh

# Variables optionnelles (valeurs par défaut si non définies)
export DOMAIN="app.votreclinique.es"
export SSH_PORT="2222"
export ADMIN_USER="adminpro"
export ADMIN_EMAIL="admin@votreclinique.es"

# Lancer l'installation
sudo ./server-init.sh
```

### 4. Actions post-installation

1. **Ajouter votre clé SSH** dans `/home/adminpro/.ssh/authorized_keys`
2. **Cloner les repositories** dans `/var/www/`
3. **Configurer le fichier .env** du backend
4. **Obtenir le certificat SSL** avec Certbot
5. **Démarrer l'application** avec PM2

## Commandes fréquentes

### Application

```bash
# Status de l'application
pm2 status

# Redémarrer l'application
pm2 restart all

# Voir les logs en temps réel
pm2 logs

# Recharger sans interruption
pm2 reload medical-pro-backend
```

### Base de données

```bash
# Connexion à la base centrale
PGPASSWORD=$(cat /root/.secrets/db_password) psql -U medicalpro -d medicalpro_central

# Lister les bases cliniques
PGPASSWORD=$(cat /root/.secrets/db_password) psql -U medicalpro -d medicalpro_central -c "SELECT id, name, clinic_db_provisioned FROM companies"

# Créer une nouvelle base clinique
/opt/scripts/provision-clinic-db.sh UUID_DE_LA_CLINIQUE
```

### Sauvegardes

```bash
# Lancer une sauvegarde manuelle
sudo /opt/scripts/backup-medicalpro.sh

# Lister les sauvegardes
ls -lah /var/backups/medicalpro/

# Restaurer une sauvegarde (test dry-run)
sudo /opt/scripts/restore-medicalpro.sh --dry-run fichier.dump.gpg medicalpro_central

# Restaurer réellement
sudo /opt/scripts/restore-medicalpro.sh fichier.dump.gpg medicalpro_central
```

### Monitoring

```bash
# Vérification manuelle de santé
sudo /opt/scripts/health-check.sh

# Voir les alertes récentes
tail -50 /var/log/medicalpro-alerts.log

# Status des services
systemctl status postgresql nginx
```

### SSL/Nginx

```bash
# Tester la configuration Nginx
nginx -t

# Recharger Nginx
systemctl reload nginx

# Renouveler le certificat SSL
certbot renew --dry-run
```

## Secrets et configuration

### Emplacement des secrets

```
/root/.secrets/
├── db_password           # Mot de passe PostgreSQL
├── jwt_secret            # Clé secrète JWT
├── jwt_refresh_secret    # Clé refresh JWT
├── backup_key            # Clé de chiffrement des sauvegardes
└── encryption_key        # Clé de chiffrement des données
```

### Variables d'environnement

Les secrets sont chargés automatiquement via `/etc/profile.d/medicalpro-env.sh`.

Pour recharger manuellement:
```bash
source /etc/profile.d/medicalpro-env.sh
```

## Dépannage

### L'API ne répond pas

```bash
# Vérifier PM2
pm2 status
pm2 logs medical-pro-backend --lines 50

# Vérifier PostgreSQL
systemctl status postgresql
sudo -u postgres psql -c "SELECT 1"
```

### Erreur de connexion base de données

```bash
# Vérifier les credentials
PGPASSWORD=$(cat /root/.secrets/db_password) psql -h localhost -U medicalpro -d medicalpro_central -c "SELECT 1"

# Vérifier pg_hba.conf
cat /etc/postgresql/16/main/pg_hba.conf
```

### Problème de certificat SSL

```bash
# Vérifier le certificat
certbot certificates

# Forcer le renouvellement
certbot renew --force-renewal
```

### Espace disque insuffisant

```bash
# Vérifier l'espace
df -h

# Nettoyer les anciens logs PM2
pm2 flush

# Nettoyer les anciennes sauvegardes (modifie RETENTION_DAYS dans le script)
find /var/backups/medicalpro -name "*.dump.gpg" -mtime +7 -delete
```

## Support

Pour toute question ou problème:
- Documentation complète: `docs/PRODUCTION_DEPLOYMENT.md`
- GitHub Issues: https://github.com/jdavido74/medical-pro-backend/issues
