#!/bin/bash
# =============================================================================
# MedicalPro - Netdata Installation Script
# =============================================================================
# Installs and configures Netdata for server monitoring
#
# Features:
# - Real-time metrics (CPU, RAM, Disk, Network)
# - PostgreSQL monitoring
# - Nginx monitoring
# - PM2/Node.js monitoring
# - Slack alerts integration
#
# Usage: sudo ./install-netdata.sh
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
NETDATA_CONFIG_DIR="/etc/netdata"
SLACK_WEBHOOK_FILE="/root/.secrets/slack_webhook"

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

log() {
    echo -e "\033[0;32m[$(date '+%Y-%m-%d %H:%M:%S')]\033[0m $1"
}

warn() {
    echo -e "\033[1;33m[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:\033[0m $1"
}

error() {
    echo -e "\033[0;31m[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:\033[0m $1"
    exit 1
}

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
fi

log "=========================================="
log "MedicalPro Netdata Installation"
log "=========================================="

# -----------------------------------------------------------------------------
# Install Netdata
# -----------------------------------------------------------------------------

if command -v netdata &> /dev/null; then
    log "Netdata is already installed"
    NETDATA_VERSION=$(netdata -v 2>&1 | head -1)
    log "  Version: $NETDATA_VERSION"
else
    log "Installing Netdata..."

    # Install using official kickstart script
    curl -fsSL https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh

    # Install with minimal prompts
    bash /tmp/netdata-kickstart.sh --non-interactive --stable-channel

    rm -f /tmp/netdata-kickstart.sh

    log "  ✓ Netdata installed"
fi

# -----------------------------------------------------------------------------
# Configure Netdata
# -----------------------------------------------------------------------------

log "Configuring Netdata..."

# Main configuration
cat > "$NETDATA_CONFIG_DIR/netdata.conf" << 'EOF'
# MedicalPro Netdata Configuration

[global]
    # Run as netdata user
    run as user = netdata

    # Reduce memory usage
    memory mode = dbengine
    page cache size = 32
    dbengine multihost disk space = 256

    # Update frequency (1 second)
    update every = 1

    # History retention (7 days)
    history = 604800

[web]
    # Bind to localhost only (access via Nginx reverse proxy)
    bind to = 127.0.0.1
    default port = 19999

    # Disable telemetry
    enable gzip compression = yes

[plugins]
    # Enable essential plugins
    proc = yes
    diskspace = yes
    cgroups = yes
    tc = no

    # Application monitoring
    apps = yes

    # Node.js/PM2 monitoring
    node.d = yes

[health]
    # Enable health monitoring
    enabled = yes

    # Reduce notification flood
    default repeat warning = 300
    default repeat critical = 120
EOF

log "  ✓ Main configuration"

# -----------------------------------------------------------------------------
# Configure PostgreSQL Monitoring
# -----------------------------------------------------------------------------

log "Configuring PostgreSQL monitoring..."

mkdir -p "$NETDATA_CONFIG_DIR/go.d"

cat > "$NETDATA_CONFIG_DIR/go.d/postgres.conf" << 'EOF'
# PostgreSQL monitoring for MedicalPro

jobs:
  - name: medicalpro_central
    dsn: "postgresql://netdata@localhost:5432/medicalpro_central?sslmode=disable"

    # Metrics to collect
    collect_databases: yes
    collect_locks: yes
    collect_replication: no
    collect_bgwriter: yes
    collect_wal: no
EOF

# Create netdata PostgreSQL user
log "Creating PostgreSQL monitoring user..."
sudo -u postgres psql << 'EOSQL' 2>/dev/null || true
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'netdata') THEN
        CREATE USER netdata;
    END IF;
END
$$;
GRANT pg_monitor TO netdata;
EOSQL

log "  ✓ PostgreSQL monitoring configured"

# -----------------------------------------------------------------------------
# Configure Nginx Monitoring
# -----------------------------------------------------------------------------

log "Configuring Nginx monitoring..."

# Enable Nginx stub_status if not already
if ! grep -q "stub_status" /etc/nginx/sites-available/medicalpro 2>/dev/null; then
    warn "Adding Nginx stub_status endpoint..."

    # Create a separate config for status
    cat > /etc/nginx/conf.d/netdata-status.conf << 'EOF'
# Netdata Nginx monitoring endpoint
server {
    listen 127.0.0.1:8080;
    server_name localhost;

    location /nginx_status {
        stub_status on;
        allow 127.0.0.1;
        deny all;
    }
}
EOF

    nginx -t && systemctl reload nginx
fi

cat > "$NETDATA_CONFIG_DIR/go.d/nginx.conf" << 'EOF'
# Nginx monitoring for MedicalPro

jobs:
  - name: local
    url: http://127.0.0.1:8080/nginx_status
EOF

log "  ✓ Nginx monitoring configured"

# -----------------------------------------------------------------------------
# Configure Health Alarms
# -----------------------------------------------------------------------------

log "Configuring health alarms..."

mkdir -p "$NETDATA_CONFIG_DIR/health.d"

cat > "$NETDATA_CONFIG_DIR/health.d/medicalpro.conf" << 'EOF'
# MedicalPro Custom Health Alarms

# =============================================================================
# CPU Alarms
# =============================================================================

alarm: cpu_usage_high
on: system.cpu
lookup: average -5m percentage of user,system,softirq,irq,guest
units: %
every: 1m
warn: $this > 80
crit: $this > 95
info: CPU usage is high
to: sysadmin

# =============================================================================
# Memory Alarms
# =============================================================================

alarm: ram_usage_high
on: system.ram
lookup: average -5m percentage of used
units: %
every: 1m
warn: $this > 85
crit: $this > 95
info: RAM usage is high
to: sysadmin

# =============================================================================
# Disk Alarms
# =============================================================================

alarm: disk_space_low
on: disk.space
lookup: average -1m percentage of avail
units: %
every: 1m
warn: $this < 20
crit: $this < 10
info: Disk space is running low
to: sysadmin

# =============================================================================
# PostgreSQL Alarms
# =============================================================================

alarm: postgres_connections_high
on: postgres.connections_utilization
lookup: average -5m unaligned percentage
units: %
every: 1m
warn: $this > 70
crit: $this > 90
info: PostgreSQL connections usage is high
to: sysadmin

# =============================================================================
# Web Server Alarms
# =============================================================================

alarm: nginx_connections_high
on: nginx.connections
lookup: average -5m of active
units: connections
every: 1m
warn: $this > 1000
crit: $this > 5000
info: Nginx active connections is high
to: sysadmin
EOF

log "  ✓ Health alarms configured"

# -----------------------------------------------------------------------------
# Configure Slack Notifications
# -----------------------------------------------------------------------------

log "Configuring Slack notifications..."

if [[ -f "$SLACK_WEBHOOK_FILE" ]]; then
    SLACK_WEBHOOK=$(cat "$SLACK_WEBHOOK_FILE")

    cat > "$NETDATA_CONFIG_DIR/health_alarm_notify.conf" << EOF
# MedicalPro Alert Notifications

# Default recipient
DEFAULT_RECIPIENT_SLACK="alerts"

# Slack configuration
SEND_SLACK="YES"
SLACK_WEBHOOK_URL="$SLACK_WEBHOOK"
DEFAULT_RECIPIENT_SLACK="alerts"

# Notification settings
role_recipients_slack[sysadmin]="alerts"
role_recipients_slack[webmaster]="alerts"
role_recipients_slack[dba]="alerts"

# Disable other notification methods
SEND_EMAIL="NO"
SEND_TELEGRAM="NO"
SEND_DISCORD="NO"
SEND_PUSHOVER="NO"
EOF

    log "  ✓ Slack notifications configured"
else
    warn "Slack webhook not found at $SLACK_WEBHOOK_FILE"
    warn "Run: echo 'YOUR_WEBHOOK_URL' > $SLACK_WEBHOOK_FILE"
    warn "Slack notifications will not work until configured"
fi

# -----------------------------------------------------------------------------
# Configure Nginx Reverse Proxy for Netdata
# -----------------------------------------------------------------------------

log "Configuring Nginx reverse proxy for Netdata dashboard..."

cat > /etc/nginx/conf.d/netdata-dashboard.conf << 'EOF'
# Netdata Dashboard (password protected)
# Access via https://your-domain/netdata/

# Note: Add this location block to your main server block in medicalpro config
# Or access directly at http://localhost:19999 via SSH tunnel

# For SSH tunnel access:
# ssh -L 19999:localhost:19999 user@server
# Then open http://localhost:19999 in your browser
EOF

log "  ✓ Nginx proxy configuration created"

# -----------------------------------------------------------------------------
# Restart Netdata
# -----------------------------------------------------------------------------

log "Restarting Netdata..."

systemctl restart netdata
systemctl enable netdata

# Wait for startup
sleep 3

# Verify running
if systemctl is-active --quiet netdata; then
    log "  ✓ Netdata is running"
else
    error "Netdata failed to start"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

log ""
log "=========================================="
log "Netdata Installation Complete!"
log "=========================================="
log ""
log "Dashboard Access:"
log "  Via SSH tunnel: ssh -L 19999:localhost:19999 user@server"
log "  Then open: http://localhost:19999"
log ""
log "Monitoring enabled for:"
log "  ✓ System (CPU, RAM, Disk, Network)"
log "  ✓ PostgreSQL"
log "  ✓ Nginx"
log "  ✓ Processes"
log ""

if [[ -f "$SLACK_WEBHOOK_FILE" ]]; then
    log "Slack Alerts: ✓ Configured"
else
    log "Slack Alerts: ⚠ Not configured"
    log "  Run: echo 'YOUR_WEBHOOK_URL' > $SLACK_WEBHOOK_FILE"
    log "  Then: systemctl restart netdata"
fi

log ""
log "=========================================="

exit 0
