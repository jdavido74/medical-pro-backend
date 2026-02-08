#!/bin/bash
# =============================================================================
# MedicalPro - Production Server Initialization Script
# =============================================================================
# Complete server setup for MedicalPro SaaS production environment
# Run this script on a fresh Ubuntu 22.04 LTS or Debian 12 server
#
# Usage: sudo ./server-init.sh
#
# Prerequisites:
# - Fresh Ubuntu 22.04 LTS or Debian 12 installation
# - Root access or sudo privileges
# - SSH access configured
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SSH_PORT="${SSH_PORT:-2222}"
ADMIN_USER="${ADMIN_USER:-adminpro}"
DOMAIN="${DOMAIN:-app.votreclinique.es}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@votreclinique.es}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
    exit 1
}

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
fi

log "=========================================="
log "MedicalPro Production Server Setup"
log "=========================================="
log "Domain: $DOMAIN"
log "SSH Port: $SSH_PORT"
log "Admin User: $ADMIN_USER"
log "Admin Email: $ADMIN_EMAIL"
log "=========================================="
echo ""
read -p "Continue with these settings? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    echo "Setup cancelled. Customize settings with environment variables:"
    echo "  DOMAIN=app.example.com SSH_PORT=2222 ADMIN_USER=admin ./server-init.sh"
    exit 0
fi

# -----------------------------------------------------------------------------
# Phase 0.1: System Update
# -----------------------------------------------------------------------------
log "Phase 0.1: Updating system packages..."

apt update
DEBIAN_FRONTEND=noninteractive apt upgrade -y
apt install -y curl wget gnupg2 software-properties-common apt-transport-https ca-certificates

log "  ✓ System updated"

# -----------------------------------------------------------------------------
# Phase 0.2: Create Admin User
# -----------------------------------------------------------------------------
log "Phase 0.2: Creating admin user '$ADMIN_USER'..."

if id "$ADMIN_USER" &>/dev/null; then
    warn "User $ADMIN_USER already exists"
else
    adduser --disabled-password --gecos "" "$ADMIN_USER"
    usermod -aG sudo "$ADMIN_USER"

    # Set up SSH directory
    mkdir -p "/home/$ADMIN_USER/.ssh"
    chmod 700 "/home/$ADMIN_USER/.ssh"
    touch "/home/$ADMIN_USER/.ssh/authorized_keys"
    chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
    chown -R "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh"

    log "  ✓ Admin user created"
    warn "Remember to add your SSH public key to /home/$ADMIN_USER/.ssh/authorized_keys"
fi

# -----------------------------------------------------------------------------
# Phase 0.3: Configure SSH Security
# -----------------------------------------------------------------------------
log "Phase 0.3: Configuring SSH security..."

# Backup original config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Configure secure SSH
cat > /etc/ssh/sshd_config.d/medicalpro.conf << EOF
# MedicalPro Production SSH Configuration
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowTcpForwarding no
EOF

# Restart SSH (but don't lock ourselves out)
warn "SSH will be reconfigured to port $SSH_PORT"
warn "Make sure you have your SSH key in /home/$ADMIN_USER/.ssh/authorized_keys"
warn "Before proceeding, open another terminal and verify you can connect"
echo ""
read -p "Proceed with SSH configuration? (yes/no): " SSH_CONFIRM
if [[ "$SSH_CONFIRM" == "yes" ]]; then
    systemctl restart sshd
    log "  ✓ SSH configured on port $SSH_PORT"
else
    rm /etc/ssh/sshd_config.d/medicalpro.conf
    warn "SSH configuration skipped"
fi

# -----------------------------------------------------------------------------
# Phase 0.4: Firewall (UFW)
# -----------------------------------------------------------------------------
log "Phase 0.4: Configuring firewall..."

apt install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp" comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Enable UFW (this requires confirmation normally, but we use --force)
echo "y" | ufw enable

log "  ✓ Firewall configured"
ufw status

# -----------------------------------------------------------------------------
# Phase 0.5: Fail2ban
# -----------------------------------------------------------------------------
log "Phase 0.5: Installing Fail2ban..."

apt install -y fail2ban

cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = $SSH_PORT
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
EOF

systemctl enable fail2ban
systemctl restart fail2ban

log "  ✓ Fail2ban configured"

# -----------------------------------------------------------------------------
# Phase 1.1: Node.js 18 LTS
# -----------------------------------------------------------------------------
log "Phase 1.1: Installing Node.js 18 LTS..."

curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

log "  ✓ Node.js $(node --version) installed"
log "  ✓ PM2 $(pm2 --version) installed"

# -----------------------------------------------------------------------------
# Phase 1.2: PostgreSQL 16
# -----------------------------------------------------------------------------
log "Phase 1.2: Installing PostgreSQL 16..."

# Add PostgreSQL repository
sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt update
apt install -y postgresql-16 postgresql-contrib-16

systemctl enable postgresql
systemctl start postgresql

log "  ✓ PostgreSQL $(psql --version | awk '{print $3}') installed"

# -----------------------------------------------------------------------------
# Phase 1.3: Nginx
# -----------------------------------------------------------------------------
log "Phase 1.3: Installing Nginx..."

apt install -y nginx

systemctl enable nginx

log "  ✓ Nginx installed"

# -----------------------------------------------------------------------------
# Phase 1.4: Certbot
# -----------------------------------------------------------------------------
log "Phase 1.4: Installing Certbot..."

apt install -y certbot python3-certbot-nginx

log "  ✓ Certbot installed"

# -----------------------------------------------------------------------------
# Phase 1.5: Essential Tools
# -----------------------------------------------------------------------------
log "Phase 1.5: Installing essential tools..."

apt install -y git curl wget htop unzip gpg rclone mailutils

log "  ✓ Essential tools installed"

# -----------------------------------------------------------------------------
# Phase 2: PostgreSQL Configuration
# -----------------------------------------------------------------------------
log "Phase 2: Configuring PostgreSQL..."

# Generate database password
mkdir -p /root/.secrets
chmod 700 /root/.secrets

if [[ ! -f /root/.secrets/db_password ]]; then
    openssl rand -base64 32 > /root/.secrets/db_password
    chmod 600 /root/.secrets/db_password
fi

DB_PASSWORD=$(cat /root/.secrets/db_password)

# Create PostgreSQL user and database
sudo -u postgres psql << EOSQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'medicalpro') THEN
        CREATE USER medicalpro WITH PASSWORD '$DB_PASSWORD';
    ELSE
        ALTER USER medicalpro WITH PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;

ALTER USER medicalpro CREATEDB;

SELECT 'CREATE DATABASE medicalpro_central OWNER medicalpro'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'medicalpro_central')\gexec
EOSQL

# PostgreSQL security configuration
cat >> /etc/postgresql/16/main/postgresql.conf << 'EOF'

# MedicalPro Security Settings
ssl = on
password_encryption = scram-sha-256
log_connections = on
log_disconnections = on

# Performance (adjust based on available RAM)
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB
EOF

# pg_hba.conf - local connections only
cat > /etc/postgresql/16/main/pg_hba.conf << 'EOF'
# PostgreSQL Client Authentication Configuration
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF

systemctl restart postgresql

# Add pgcrypto extension
sudo -u postgres psql -d medicalpro_central -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

log "  ✓ PostgreSQL configured"

# -----------------------------------------------------------------------------
# Phase 3: Application Directories
# -----------------------------------------------------------------------------
log "Phase 3: Setting up application directories..."

mkdir -p /var/www/medical-pro
mkdir -p /var/www/medical-pro-backend
mkdir -p /var/log/pm2
mkdir -p /var/backups/medicalpro
mkdir -p /opt/scripts

chown -R "$ADMIN_USER:www-data" /var/www/medical-pro*
chmod -R 775 /var/www/medical-pro*
chown -R root:root /var/backups/medicalpro
chmod 700 /var/backups/medicalpro

log "  ✓ Directories created"

# -----------------------------------------------------------------------------
# Generate All Secrets
# -----------------------------------------------------------------------------
log "Generating application secrets..."

for SECRET in jwt_secret jwt_refresh_secret backup_key encryption_key; do
    if [[ ! -f "/root/.secrets/$SECRET" ]]; then
        if [[ "$SECRET" == "jwt_secret" || "$SECRET" == "jwt_refresh_secret" ]]; then
            openssl rand -base64 64 > "/root/.secrets/$SECRET"
        else
            openssl rand -base64 32 > "/root/.secrets/$SECRET"
        fi
        chmod 600 "/root/.secrets/$SECRET"
    fi
done

# Create environment loader
cat > /etc/profile.d/medicalpro-env.sh << 'EOF'
#!/bin/bash
if [[ -r /root/.secrets/db_password ]]; then
    export DB_PASSWORD=$(cat /root/.secrets/db_password 2>/dev/null)
    export JWT_SECRET=$(cat /root/.secrets/jwt_secret 2>/dev/null)
    export JWT_REFRESH_SECRET=$(cat /root/.secrets/jwt_refresh_secret 2>/dev/null)
fi
EOF
chmod +x /etc/profile.d/medicalpro-env.sh

log "  ✓ Secrets generated"

# -----------------------------------------------------------------------------
# Create Deploy User
# -----------------------------------------------------------------------------
log "Creating deploy user for CI/CD..."

if id "deploy" &>/dev/null; then
    warn "User deploy already exists"
else
    useradd -m -s /bin/bash deploy
    usermod -aG www-data deploy

    # Generate SSH key for deploy user
    sudo -u deploy mkdir -p /home/deploy/.ssh
    sudo -u deploy ssh-keygen -t ed25519 -N "" -f /home/deploy/.ssh/id_ed25519

    # Allow deploy to restart PM2
    echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2" >> /etc/sudoers.d/deploy
    chmod 440 /etc/sudoers.d/deploy
fi

# Give deploy user access to app directories
chown -R deploy:www-data /var/www/medical-pro*
chmod -R 775 /var/www/medical-pro*

log "  ✓ Deploy user created"

# -----------------------------------------------------------------------------
# Setup PM2 for root startup
# -----------------------------------------------------------------------------
log "Configuring PM2 startup..."

pm2 startup systemd -u root --hp /root
mkdir -p /var/log/pm2

log "  ✓ PM2 startup configured"

# -----------------------------------------------------------------------------
# Create Cron Jobs
# -----------------------------------------------------------------------------
log "Setting up cron jobs..."

cat > /etc/cron.d/medicalpro << EOF
# MedicalPro Scheduled Tasks
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Backup at 3 AM daily
0 3 * * * root /opt/scripts/backup-medicalpro.sh >> /var/log/medicalpro-backup.log 2>&1

# Health check every 5 minutes
*/5 * * * * root /opt/scripts/health-check.sh >> /var/log/medicalpro-health.log 2>&1

# Certbot renewal (monthly)
0 3 1 * * root certbot renew --quiet --post-hook 'systemctl reload nginx'
EOF

chmod 644 /etc/cron.d/medicalpro

log "  ✓ Cron jobs configured"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
log ""
log "=========================================="
log "Server initialization complete!"
log "=========================================="
log ""
log "NEXT STEPS:"
log ""
log "1. Add your SSH public key:"
log "   echo 'your-public-key' >> /home/$ADMIN_USER/.ssh/authorized_keys"
log ""
log "2. Test SSH access on port $SSH_PORT:"
log "   ssh -p $SSH_PORT $ADMIN_USER@YOUR_SERVER_IP"
log ""
log "3. Clone repositories (as $ADMIN_USER):"
log "   cd /var/www && git clone git@github.com:jdavido74/medical-pro.git"
log "   cd /var/www && git clone git@github.com:jdavido74/medical-pro-backend.git"
log ""
log "4. Install dependencies and build:"
log "   cd /var/www/medical-pro-backend && npm ci --production"
log "   cd /var/www/medical-pro && npm ci && npm run build"
log ""
log "5. Configure Nginx (copy nginx config to /etc/nginx/sites-available/)"
log ""
log "6. Obtain SSL certificate:"
log "   certbot --nginx -d $DOMAIN"
log ""
log "7. Start application with PM2:"
log "   cd /var/www/medical-pro-backend"
log "   pm2 start ecosystem.production.config.js"
log "   pm2 save"
log ""
log "SECRETS (save these securely!):"
log "  Database password: $(cat /root/.secrets/db_password)"
log ""
log "Deploy user SSH public key (add to GitHub):"
cat /home/deploy/.ssh/id_ed25519.pub
log ""
log "=========================================="

exit 0
