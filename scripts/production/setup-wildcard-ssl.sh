#!/bin/bash
# =============================================================================
# MedicalPro - Wildcard SSL Certificate Setup
# =============================================================================
# Obtains a wildcard SSL certificate for *.medimaestro.com
# Uses DNS challenge with Cloudflare (recommended) or manual DNS
#
# Prerequisites:
# - Domain configured with Cloudflare (recommended) or other DNS provider
# - For Cloudflare: API token with Zone:DNS:Edit permissions
#
# Usage: sudo ./setup-wildcard-ssl.sh
# =============================================================================

set -euo pipefail

DOMAIN="medimaestro.com"
EMAIL="${ADMIN_EMAIL:-admin@medimaestro.com}"
SECRETS_DIR="/root/.secrets"

log() {
    echo -e "\033[0;32m[$(date '+%Y-%m-%d %H:%M:%S')]\033[0m $1"
}

error() {
    echo -e "\033[0;31m[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:\033[0m $1"
    exit 1
}

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
fi

log "=========================================="
log "Wildcard SSL Certificate Setup"
log "=========================================="
log "Domain: *.$DOMAIN"
log ""

# Check if using Cloudflare
echo "Which DNS provider are you using?"
echo "1) Cloudflare (recommended - automatic)"
echo "2) Other (manual DNS challenge)"
read -p "Choice [1/2]: " DNS_PROVIDER

case "$DNS_PROVIDER" in
    1)
        log "Setting up Cloudflare DNS plugin..."

        # Install Cloudflare plugin
        apt install -y python3-certbot-dns-cloudflare

        # Get API token
        echo ""
        echo "Create a Cloudflare API token with these permissions:"
        echo "  - Zone > DNS > Edit"
        echo "  - Zone > Zone > Read"
        echo ""
        echo "Get your token at: https://dash.cloudflare.com/profile/api-tokens"
        echo ""
        read -p "Enter your Cloudflare API token: " CF_TOKEN

        # Save credentials
        mkdir -p "$SECRETS_DIR"
        cat > "$SECRETS_DIR/cloudflare.ini" << EOF
dns_cloudflare_api_token = $CF_TOKEN
EOF
        chmod 600 "$SECRETS_DIR/cloudflare.ini"

        log "Requesting wildcard certificate..."

        certbot certonly \
            --dns-cloudflare \
            --dns-cloudflare-credentials "$SECRETS_DIR/cloudflare.ini" \
            --dns-cloudflare-propagation-seconds 30 \
            -d "$DOMAIN" \
            -d "*.$DOMAIN" \
            --email "$EMAIL" \
            --agree-tos \
            --non-interactive
        ;;

    2)
        log "Using manual DNS challenge..."
        log "You will need to create TXT records manually."
        echo ""

        certbot certonly \
            --manual \
            --preferred-challenges dns \
            -d "$DOMAIN" \
            -d "*.$DOMAIN" \
            --email "$EMAIL" \
            --agree-tos
        ;;

    *)
        error "Invalid choice"
        ;;
esac

# Verify certificate
if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    log ""
    log "=========================================="
    log "Wildcard certificate installed successfully!"
    log "=========================================="
    log ""
    log "Certificate location:"
    log "  /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    log "  /etc/letsencrypt/live/$DOMAIN/privkey.pem"
    log ""
    log "Next steps:"
    log "  1. Update Nginx configuration to use wildcard cert"
    log "  2. Reload Nginx: systemctl reload nginx"
else
    error "Certificate installation failed"
fi

exit 0
