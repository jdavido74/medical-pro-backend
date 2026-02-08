#!/bin/bash
# =============================================================================
# MedicalPro - Secrets Setup Script
# =============================================================================
# Generates and configures all production secrets
# Run this script during initial server setup
#
# Usage: sudo ./setup-secrets.sh
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SECRETS_DIR="/root/.secrets"
PROFILE_SCRIPT="/etc/profile.d/medicalpro-env.sh"

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
    log "ERROR: $1"
    exit 1
}

generate_secret() {
    local NAME="$1"
    local LENGTH="${2:-32}"
    local FILE="$SECRETS_DIR/$NAME"

    if [[ -f "$FILE" ]]; then
        log "  ⚠ $NAME already exists, skipping"
        return 0
    fi

    openssl rand -base64 "$LENGTH" > "$FILE"
    chmod 600 "$FILE"
    log "  ✓ Generated $NAME"
}

# -----------------------------------------------------------------------------
# Check Prerequisites
# -----------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    error_exit "This script must be run as root"
fi

if ! command -v openssl &> /dev/null; then
    error_exit "openssl is required but not installed"
fi

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

log "=========================================="
log "MedicalPro Secrets Setup"
log "=========================================="

# Create secrets directory
log "Creating secrets directory..."
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# Generate secrets
log "Generating secrets..."
generate_secret "db_password" 32
generate_secret "jwt_secret" 64
generate_secret "jwt_refresh_secret" 64
generate_secret "backup_key" 32
generate_secret "encryption_key" 32

# Create environment loader script
log "Creating environment loader script..."
cat > "$PROFILE_SCRIPT" << 'EOFSCRIPT'
#!/bin/bash
# MedicalPro Environment Variables
# Loads secrets from /root/.secrets/ into environment

# Only load for users with access to secrets
if [[ -r /root/.secrets/db_password ]]; then
    export DB_PASSWORD=$(cat /root/.secrets/db_password 2>/dev/null)
    export JWT_SECRET=$(cat /root/.secrets/jwt_secret 2>/dev/null)
    export JWT_REFRESH_SECRET=$(cat /root/.secrets/jwt_refresh_secret 2>/dev/null)
fi
EOFSCRIPT

chmod +x "$PROFILE_SCRIPT"
log "  ✓ Created $PROFILE_SCRIPT"

# Display generated passwords
log ""
log "=========================================="
log "Generated Secrets (SAVE THESE SECURELY!)"
log "=========================================="
echo ""
echo "Database Password:"
echo "  $(cat "$SECRETS_DIR/db_password")"
echo ""
echo "JWT Secret:"
echo "  $(cat "$SECRETS_DIR/jwt_secret")"
echo ""
echo "JWT Refresh Secret:"
echo "  $(cat "$SECRETS_DIR/jwt_refresh_secret")"
echo ""
echo "Backup Encryption Key:"
echo "  $(cat "$SECRETS_DIR/backup_key")"
echo ""
echo "Data Encryption Key:"
echo "  $(cat "$SECRETS_DIR/encryption_key")"
echo ""
log "=========================================="
log "Secrets stored in: $SECRETS_DIR"
log ""
log "IMPORTANT:"
log "1. Save these secrets in a secure password manager"
log "2. The secrets are loaded via: source $PROFILE_SCRIPT"
log "3. PM2 processes need to be started with these env vars"
log "=========================================="

exit 0
