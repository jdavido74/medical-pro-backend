#!/bin/bash
# =============================================================================
# MedicalPro - Install Production Scripts
# =============================================================================
# Copies production scripts to /opt/scripts and sets up permissions
#
# Usage: sudo ./install-production-scripts.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="/opt/scripts"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root"
    exit 1
fi

log "Installing MedicalPro production scripts..."

# Create target directory
mkdir -p "$TARGET_DIR"

# Copy scripts
SCRIPTS=(
    "backup-medicalpro.sh"
    "restore-medicalpro.sh"
    "health-check.sh"
    "setup-secrets.sh"
    "provision-clinic-db.sh"
    "install-netdata.sh"
    "setup-slack-alerts.sh"
    "test-slack-alert.sh"
    "lib-slack.sh"
)

for script in "${SCRIPTS[@]}"; do
    if [[ -f "$SCRIPT_DIR/$script" ]]; then
        cp "$SCRIPT_DIR/$script" "$TARGET_DIR/"
        chmod +x "$TARGET_DIR/$script"
        log "  ✓ Installed $script"
    else
        log "  ⚠ $script not found in $SCRIPT_DIR"
    fi
done

# Copy Nginx config
if [[ -f "$SCRIPT_DIR/nginx-medicalpro.conf" ]]; then
    cp "$SCRIPT_DIR/nginx-medicalpro.conf" /etc/nginx/sites-available/medicalpro
    log "  ✓ Installed Nginx configuration"
    log "    Run: ln -s /etc/nginx/sites-available/medicalpro /etc/nginx/sites-enabled/"
fi

log ""
log "Installation complete!"
log ""
log "Scripts installed to: $TARGET_DIR"
log ""
log "Next steps:"
log "  1. Run setup-secrets.sh to generate secrets"
log "  2. Configure Nginx and obtain SSL certificate"
log "  3. Set up cron jobs (see /etc/cron.d/medicalpro)"

exit 0
