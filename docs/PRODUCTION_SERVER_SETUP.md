# MedicalPro - Production Server Setup

## Server Information

| Property | Value |
|----------|-------|
| **IP Address** | 72.62.51.173 |
| **SSH Port** | 2222 |
| **Domain** | medimaestro.com |
| **OS** | Ubuntu 24.04 LTS |
| **Provider** | Hostinger VPS |

## Installed Stack

| Component | Version | Status |
|-----------|---------|--------|
| Node.js | 18.x LTS | ✅ Installed |
| PostgreSQL | 16 | ✅ Running |
| Nginx | Latest | ✅ Running |
| PM2 | Latest | ✅ Running (auto-start enabled) |
| Certbot | Latest | ✅ Installed |
| Fail2ban | Latest | ✅ Active |
| UFW Firewall | Latest | ✅ Configured |

## Firewall Rules (UFW)

```
Port 2222/tcp  - SSH (custom port)
Port 80/tcp   - HTTP
Port 443/tcp  - HTTPS
```

## Application Deployment

### Backend
- **Location**: `/var/www/medical-pro-backend`
- **Branch**: `feature/catalog-backend-integration`
- **PM2 Instances**: 2 (cluster mode)
- **Port**: 3001

### Frontend
- **Location**: `/var/www/medical-pro`
- **Branch**: `feature/catalog-backend-integration`
- **PM2 Instances**: 1 (fork mode)
- **Port**: 3000

## Database Configuration

### Central Database
- **Name**: `medicalpro_central`
- **User**: `medicalpro`
- **Host**: localhost
- **Port**: 5432

### Migrations Applied
- `central_001_initial_schema.sql`
- `central_002_add_locale_to_companies.sql`
- `central_003_user_clinic_memberships.sql`
- `central_004_add_clinic_db_provisioned.sql`
- `central_005_add_subdomain.sql`

## Secrets Location

All secrets are stored in `/root/.secrets/` with 600 permissions:

| File | Description |
|------|-------------|
| `db_password` | PostgreSQL password |
| `jwt_secret` | JWT signing key |
| `jwt_refresh_secret` | JWT refresh token key |
| `backup_key` | GPG encryption key for backups |
| `encryption_key` | General encryption key |

## SuperAdmin Account

| Property | Value |
|----------|-------|
| **Email** | josedavid.orts@gmail.com |
| **Password** | SuperAdmin2025! |
| **Role** | super_admin |

> ⚠️ **IMPORTANT**: Change this password after first login!

## Production Scripts

All scripts are installed in `/opt/scripts/`:

| Script | Description |
|--------|-------------|
| `backup-medicalpro.sh` | Daily encrypted backup (runs at 3:00 AM) |
| `restore-medicalpro.sh` | Restore from encrypted backup |
| `health-check.sh` | System health monitoring (runs every 5 min) |
| `manage-clinic-subdomain.sh` | Manage clinic subdomains |
| `provision-clinic-db.sh` | Create new clinic database |
| `setup-wildcard-ssl.sh` | Obtain wildcard SSL certificate |
| `setup-slack-alerts.sh` | Configure Slack notifications |
| `install-netdata.sh` | Install Netdata monitoring |

## Cron Jobs

Located in `/etc/cron.d/medicalpro`:

```cron
# Backup daily at 3:00 AM
0 3 * * * root /opt/scripts/backup-medicalpro.sh

# Health check every 5 minutes
*/5 * * * * root /opt/scripts/health-check.sh

# SSL renewal on 1st of month at 4:00 AM
0 4 1 * * root certbot renew --quiet --post-hook "systemctl reload nginx"
```

## Logs Location

| Log | Path |
|-----|------|
| PM2 Backend | `~/.pm2/logs/medical-pro-backend-*.log` |
| PM2 Frontend | `~/.pm2/logs/medical-pro-frontend-*.log` |
| Nginx Access | `/var/log/nginx/medimaestro_access.log` |
| Nginx Error | `/var/log/nginx/medimaestro_error.log` |
| Backup | `/var/log/medicalpro-backup.log` |
| Health Check | `/var/log/medicalpro-health.log` |

---

## DNS Configuration Required

### Current DNS (to be updated)
```
A    @    84.32.84.32  (OLD - development server)
```

### New DNS Configuration
Update your DNS records to point to the new production server:

```
A    @               72.62.51.173
A    app             72.62.51.173
A    *               72.62.51.173   (wildcard for clinic subdomains)
```

> The wildcard record (`*`) enables automatic subdomain routing for clinics
> (e.g., `ozondenia.medimaestro.com`, `clinica-dental.medimaestro.com`)

---

## Post-DNS Setup Steps

### 1. Obtain Wildcard SSL Certificate

Once DNS is propagated (check with `host app.medimaestro.com`):

```bash
ssh -p 2222 root@72.62.51.173
/opt/scripts/setup-wildcard-ssl.sh
```

Choose option 1 (Cloudflare) if using Cloudflare DNS, or option 2 for manual DNS challenge.

### 2. Apply HTTPS Nginx Configuration

```bash
cp /var/www/medical-pro-backend/scripts/production/nginx-multitenant.conf \
   /etc/nginx/sites-available/medimaestro
nginx -t && systemctl reload nginx
```

### 3. Configure Slack Alerts (Optional)

```bash
/opt/scripts/setup-slack-alerts.sh
```

You'll need a Slack webhook URL from your workspace.

### 4. Install Netdata Monitoring (Optional)

```bash
/opt/scripts/install-netdata.sh
```

Access at: `https://app.medimaestro.com:19999` (requires firewall rule)

### 5. Re-secure SSH Access

After confirming SSH key access works:

```bash
# Disable password authentication
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config.d/medicalpro.conf
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/medicalpro.conf
systemctl restart ssh
```

---

## Common Operations

### Check Service Status
```bash
pm2 status                    # Application status
systemctl status nginx        # Web server
systemctl status postgresql   # Database
```

### View Logs
```bash
pm2 logs                      # All PM2 logs
pm2 logs medical-pro-backend  # Backend only
tail -f /var/log/nginx/medimaestro_error.log
```

### Restart Services
```bash
pm2 restart all              # Restart applications
systemctl reload nginx       # Reload Nginx config
systemctl restart postgresql # Restart database
```

### Deploy Updates
```bash
cd /var/www/medical-pro-backend
git pull origin master
npm ci --omit=dev
pm2 restart medical-pro-backend

cd /var/www/medical-pro
git pull origin master
npm ci --legacy-peer-deps
npm run build
pm2 restart medical-pro-frontend
```

### Create Clinic Subdomain
```bash
/opt/scripts/manage-clinic-subdomain.sh list
/opt/scripts/manage-clinic-subdomain.sh add <clinic_id> <subdomain>
/opt/scripts/manage-clinic-subdomain.sh check <subdomain>
```

### Manual Backup
```bash
/opt/scripts/backup-medicalpro.sh
ls -la /var/backups/medicalpro/
```

### Restore Backup
```bash
/opt/scripts/restore-medicalpro.sh /var/backups/medicalpro/central_YYYYMMDD.dump.gpg medicalpro_central
```

---

## Security Notes

1. **SSH**: Custom port 2222, root login temporarily enabled (disable after setup)
2. **Fail2ban**: Blocks IPs after 3 failed SSH attempts
3. **PostgreSQL**: Local connections only (no external access)
4. **Secrets**: Stored outside web root in `/root/.secrets/`
5. **Backups**: Encrypted with GPG AES256

---

## Support Contacts

- **Technical Issues**: Check logs first, then escalate
- **DNS Issues**: Contact domain registrar
- **Server Issues**: Hostinger support

---

*Document generated: 2026-02-08*
*Server installation completed successfully*
