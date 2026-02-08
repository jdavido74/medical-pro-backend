#!/bin/bash
# =============================================================================
# MedicalPro - Clinic Subdomain Manager
# =============================================================================
# Manages clinic subdomains in the database
#
# Usage:
#   ./manage-clinic-subdomain.sh list                    # List all clinics
#   ./manage-clinic-subdomain.sh add <clinic_id> <subdomain>
#   ./manage-clinic-subdomain.sh remove <clinic_id>
#   ./manage-clinic-subdomain.sh check <subdomain>       # Check if available
#
# Note: DNS is handled via wildcard (*.medimaestro.com)
#       No manual DNS configuration needed per clinic!
# =============================================================================

set -euo pipefail

SECRETS_DIR="/root/.secrets"
ACTION="${1:-help}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Load database password
if [[ -f "$SECRETS_DIR/db_password" ]]; then
    DB_PASSWORD=$(cat "$SECRETS_DIR/db_password")
else
    error "Database password not found"
fi

# Database query helper
db_query() {
    PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -d medicalpro_central -t -c "$1" 2>/dev/null
}

db_query_pretty() {
    PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -d medicalpro_central -c "$1" 2>/dev/null
}

# Validate subdomain format
validate_subdomain() {
    local subdomain="$1"

    # Check length
    if [[ ${#subdomain} -lt 3 || ${#subdomain} -gt 30 ]]; then
        error "Subdomain must be between 3 and 30 characters"
    fi

    # Check format (lowercase, alphanumeric, hyphens)
    if ! [[ "$subdomain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
        error "Subdomain must be lowercase, alphanumeric, can contain hyphens but not at start/end"
    fi

    # Check reserved subdomains
    local reserved="app www api admin mail ftp smtp pop imap ns1 ns2 dns"
    for r in $reserved; do
        if [[ "$subdomain" == "$r" ]]; then
            error "Subdomain '$subdomain' is reserved"
        fi
    done
}

case "$ACTION" in
    list)
        log "Listing all clinics with subdomains..."
        echo ""
        db_query_pretty "
            SELECT
                name AS \"Clinic Name\",
                subdomain AS \"Subdomain\",
                CASE WHEN subdomain IS NOT NULL
                    THEN subdomain || '.medimaestro.com'
                    ELSE '-'
                END AS \"URL\",
                CASE WHEN is_active THEN 'Yes' ELSE 'No' END AS \"Active\",
                CASE WHEN clinic_db_provisioned THEN 'Yes' ELSE 'No' END AS \"DB Ready\"
            FROM companies
            ORDER BY name
        "
        ;;

    add)
        CLINIC_ID="${2:-}"
        SUBDOMAIN="${3:-}"

        if [[ -z "$CLINIC_ID" || -z "$SUBDOMAIN" ]]; then
            error "Usage: $0 add <clinic_id> <subdomain>"
        fi

        # Validate subdomain
        validate_subdomain "$SUBDOMAIN"

        # Check if subdomain is already taken
        EXISTING=$(db_query "SELECT id FROM companies WHERE subdomain = '$SUBDOMAIN' LIMIT 1" | xargs)
        if [[ -n "$EXISTING" ]]; then
            error "Subdomain '$SUBDOMAIN' is already taken by clinic: $EXISTING"
        fi

        # Check if clinic exists
        CLINIC_NAME=$(db_query "SELECT name FROM companies WHERE id = '$CLINIC_ID' LIMIT 1" | xargs)
        if [[ -z "$CLINIC_NAME" ]]; then
            error "Clinic not found: $CLINIC_ID"
        fi

        log "Adding subdomain '$SUBDOMAIN' to clinic '$CLINIC_NAME'..."

        db_query "UPDATE companies SET subdomain = '$SUBDOMAIN', updated_at = NOW() WHERE id = '$CLINIC_ID'"

        log "Subdomain configured successfully!"
        echo ""
        echo "Clinic: $CLINIC_NAME"
        echo "URL:    https://$SUBDOMAIN.medimaestro.com"
        echo ""
        warn "Make sure wildcard DNS (*.medimaestro.com) is configured!"
        ;;

    remove)
        CLINIC_ID="${2:-}"

        if [[ -z "$CLINIC_ID" ]]; then
            error "Usage: $0 remove <clinic_id>"
        fi

        CLINIC_INFO=$(db_query "SELECT name, subdomain FROM companies WHERE id = '$CLINIC_ID'" | xargs)
        if [[ -z "$CLINIC_INFO" ]]; then
            error "Clinic not found: $CLINIC_ID"
        fi

        log "Removing subdomain from clinic..."

        db_query "UPDATE companies SET subdomain = NULL, updated_at = NOW() WHERE id = '$CLINIC_ID'"

        log "Subdomain removed successfully!"
        ;;

    check)
        SUBDOMAIN="${2:-}"

        if [[ -z "$SUBDOMAIN" ]]; then
            error "Usage: $0 check <subdomain>"
        fi

        validate_subdomain "$SUBDOMAIN"

        EXISTING=$(db_query "SELECT name FROM companies WHERE subdomain = '$SUBDOMAIN' LIMIT 1" | xargs)

        if [[ -n "$EXISTING" ]]; then
            echo -e "${RED}✗${NC} Subdomain '$SUBDOMAIN' is taken by: $EXISTING"
            exit 1
        else
            echo -e "${GREEN}✓${NC} Subdomain '$SUBDOMAIN' is available!"
            exit 0
        fi
        ;;

    suggest)
        CLINIC_NAME="${2:-}"

        if [[ -z "$CLINIC_NAME" ]]; then
            error "Usage: $0 suggest <clinic_name>"
        fi

        # Generate subdomain suggestion
        SUGGESTED=$(echo "$CLINIC_NAME" | \
            sed 's/^[Cc]l[ií]nica //; s/^[Cc]linic //; s/^[Cc]entro //; s/^[Cc]entre //' | \
            iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | \
            tr '[:upper:]' '[:lower:]' | \
            tr ' ' '-' | \
            sed 's/[^a-z0-9-]//g; s/-\+/-/g; s/^-//; s/-$//')

        # Check if available
        EXISTING=$(db_query "SELECT id FROM companies WHERE subdomain = '$SUGGESTED' LIMIT 1" | xargs)

        if [[ -z "$EXISTING" ]]; then
            echo -e "${GREEN}✓${NC} Suggested subdomain: $SUGGESTED"
            echo "  URL: https://$SUGGESTED.medimaestro.com"
        else
            # Try with number suffix
            for i in 2 3 4 5; do
                VARIANT="${SUGGESTED}${i}"
                EXISTING=$(db_query "SELECT id FROM companies WHERE subdomain = '$VARIANT' LIMIT 1" | xargs)
                if [[ -z "$EXISTING" ]]; then
                    echo -e "${YELLOW}!${NC} '$SUGGESTED' is taken. Suggested: $VARIANT"
                    echo "  URL: https://$VARIANT.medimaestro.com"
                    break
                fi
            done
        fi
        ;;

    help|*)
        echo "MedicalPro - Clinic Subdomain Manager"
        echo ""
        echo "Usage: $0 <command> [arguments]"
        echo ""
        echo "Commands:"
        echo "  list                         List all clinics with subdomains"
        echo "  add <clinic_id> <subdomain>  Add subdomain to a clinic"
        echo "  remove <clinic_id>           Remove subdomain from a clinic"
        echo "  check <subdomain>            Check if subdomain is available"
        echo "  suggest <clinic_name>        Suggest subdomain for clinic name"
        echo ""
        echo "Examples:"
        echo "  $0 list"
        echo "  $0 add 550e8400-e29b-41d4-a716-446655440000 ozondenia"
        echo "  $0 check ozondenia"
        echo "  $0 suggest \"Clínica Ozondenia\""
        ;;
esac

exit 0
