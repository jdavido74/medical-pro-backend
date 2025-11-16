#!/bin/bash
################################################################################
# Emergency Access Script - MedicalPro Admin Recovery
#
# Usage:
#   ./emergency-access.sh --help
#   ./emergency-access.sh --test-recovery
#   ./emergency-access.sh --reset-primary
#   ./emergency-access.sh --reset-all
#
# WARNING: This script bypasses normal authentication!
# Only use in case of genuine emergency!
################################################################################

set -euo pipefail

# Configuration
DB_HOST="localhost"
DB_PORT="5432"
DB_USER="medicalpro"
DB_PASSWORD="${PGPASSWORD:-medicalpro2024}"
DB_NAME="medicalpro_central"
API_URL="${API_URL:-http://localhost:3001}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} $1"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

show_help() {
    cat << EOF
${BLUE}MedicalPro Emergency Access Script${NC}

USAGE:
  ./emergency-access.sh [COMMAND]

COMMANDS:
  --help                 Show this help message

  --test-recovery        Test recovery account access
  --show-accounts        Show all super_admin accounts

  --reset-primary        Reset primary admin password to SuperAdmin123
  --reset-recovery       Reset recovery admin password to SuperAdmin123
  --reset-all            Reset ALL super_admin accounts

  --password <password>  Set custom password (with --reset-* commands)

  --verify               Verify system can access database

EXAMPLES:
  # Test recovery account
  ./emergency-access.sh --test-recovery

  # Reset primary admin with default password
  ./emergency-access.sh --reset-primary

  # Reset with custom password
  ./emergency-access.sh --reset-primary --password "MyNewPassword123"

  # Reset all admins (use with caution!)
  ./emergency-access.sh --reset-all

DISCLAIMER:
  This script requires database access and should ONLY be used in
  genuine emergency situations. Unauthorized use may violate security
  policies.

  All actions are logged in the audit_logs table.
EOF
}

verify_db_access() {
    print_info "Verifying database access..."

    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "SELECT 1" > /dev/null 2>&1 || {
        print_error "Cannot connect to database!"
        print_info "Check: DB_HOST=$DB_HOST, DB_USER=$DB_USER, DB_NAME=$DB_NAME"
        exit 1
    }

    print_success "Database connection OK"
}

show_accounts() {
    print_header "Super Admin Accounts"

    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "SELECT email, role, email_verified, created_at FROM users WHERE role = 'super_admin' ORDER BY created_at;"
}

test_recovery_account() {
    print_header "Testing Recovery Account Access"

    print_info "Recovery Account: recovery-admin@example.com"
    print_info "Password: SuperAdmin123"
    print_info "Attempting login via API..."

    RESPONSE=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d '{
            "email": "recovery-admin@example.com",
            "password": "SuperAdmin123"
        }')

    SUCCESS=$(echo "$RESPONSE" | jq -r '.success' 2>/dev/null || echo "false")

    if [ "$SUCCESS" == "true" ]; then
        print_success "Recovery account login SUCCESSFUL"
        TOKEN=$(echo "$RESPONSE" | jq -r '.data.tokens.accessToken' 2>/dev/null | head -c 50)
        print_info "Access Token: ${TOKEN}..."
    else
        print_error "Recovery account login FAILED"
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        exit 1
    fi
}

generate_password_hash() {
    local PASSWORD="$1"

    # Use Node.js to generate bcrypt hash
    node -e "
        const bcrypt = require('bcryptjs');
        const hash = bcrypt.hashSync('$PASSWORD', 12);
        console.log(hash);
    " 2>/dev/null || {
        print_error "Failed to generate password hash. Ensure Node.js is installed."
        exit 1
    }
}

reset_password() {
    local EMAIL="$1"
    local PASSWORD="${2:-SuperAdmin123}"

    print_warning "Resetting password for: $EMAIL"
    print_info "Generating password hash..."

    HASH=$(generate_password_hash "$PASSWORD")
    print_success "Hash generated"

    print_info "Updating database..."

    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << EOF
UPDATE users
SET password_hash = '$HASH',
    last_login = NULL,
    email_verified = true
WHERE email = '$EMAIL';

-- Log the recovery action
INSERT INTO audit_logs (id, action, entity_type, entity_id, created_at)
VALUES (
    gen_random_uuid(),
    'EMERGENCY_PASSWORD_RESET',
    'super_admin',
    (SELECT id FROM users WHERE email = '$EMAIL'),
    NOW()
);

-- Verify update
SELECT 'PASSWORD_RESET_COMPLETE' as status, email, role FROM users WHERE email = '$EMAIL';
EOF

    print_success "Password reset completed for: $EMAIL"
    print_warning "New password: $PASSWORD"
    print_warning "Please change this password immediately!"
}

reset_all_admins() {
    print_warning "RESETTING ALL SUPER ADMIN ACCOUNTS!"
    print_warning "This action affects ALL super_admin users in the system!"

    read -p "Are you absolutely sure? Type 'YES' to confirm: " CONFIRM

    if [ "$CONFIRM" != "YES" ]; then
        print_error "Reset cancelled"
        exit 1
    fi

    PASSWORD="${1:-SuperAdmin123}"
    HASH=$(generate_password_hash "$PASSWORD")

    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << EOF
UPDATE users
SET password_hash = '$HASH',
    last_login = NULL
WHERE role = 'super_admin';

-- Log the recovery action
INSERT INTO audit_logs (id, action, entity_type, created_at)
VALUES (
    gen_random_uuid(),
    'EMERGENCY_RESET_ALL_ADMINS',
    'super_admin',
    NOW()
);

-- Show results
SELECT COUNT(*) as admins_reset FROM users WHERE role = 'super_admin';
EOF

    print_success "All super_admin passwords have been reset"
    print_warning "New password for all admins: $PASSWORD"
    print_warning "Please change these passwords immediately!"
}

# Main execution
main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi

    COMMAND="$1"
    CUSTOM_PASSWORD=""

    # Parse arguments
    shift || true
    while [ $# -gt 0 ]; do
        case "$1" in
            --password)
                CUSTOM_PASSWORD="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    case "$COMMAND" in
        --help)
            show_help
            ;;
        --verify)
            verify_db_access
            show_accounts
            ;;
        --test-recovery)
            verify_db_access
            test_recovery_account
            ;;
        --show-accounts)
            verify_db_access
            show_accounts
            ;;
        --reset-primary)
            verify_db_access
            PASSWORD="${CUSTOM_PASSWORD:-SuperAdmin123}"
            reset_password "admin@example.com" "$PASSWORD"
            ;;
        --reset-recovery)
            verify_db_access
            PASSWORD="${CUSTOM_PASSWORD:-SuperAdmin123}"
            reset_password "recovery-admin@example.com" "$PASSWORD"
            ;;
        --reset-all)
            verify_db_access
            PASSWORD="${CUSTOM_PASSWORD:-SuperAdmin123}"
            reset_all_admins "$PASSWORD"
            ;;
        *)
            print_error "Unknown command: $COMMAND"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Execute
main "$@"
