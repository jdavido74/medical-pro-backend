#!/bin/bash
# Script to apply Phase 1 Security Fix migration to all existing clinic databases
# This adds central_user_id column and makes password_hash nullable
#
# Usage: ./scripts/apply_phase1_migration.sh
#
# IMPORTANT: Run this AFTER updating the backend code but BEFORE restarting the server

set -e

# Database connection settings
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-medicalpro}"
DB_PASSWORD="${DB_PASSWORD:-medicalpro2024}"

MIGRATION_FILE="/var/www/medical-pro-backend/migrations/clinic_026_phase1_auth_security_fix.sql"

echo "=============================================="
echo "Phase 1 Security Fix - Migration Script"
echo "=============================================="
echo ""
echo "This script will:"
echo "  1. Find all clinic databases (medicalpro_clinic_*)"
echo "  2. Apply the Phase 1 security migration to each"
echo "  3. Add central_user_id column"
echo "  4. Make password_hash nullable"
echo ""

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "ERROR: Migration file not found: $MIGRATION_FILE"
    exit 1
fi

# Get list of all clinic databases
echo "Finding clinic databases..."
CLINIC_DBS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%'")

if [ -z "$CLINIC_DBS" ]; then
    echo "No clinic databases found."
    exit 0
fi

# Count databases
DB_COUNT=$(echo "$CLINIC_DBS" | wc -l)
echo "Found $DB_COUNT clinic database(s)"
echo ""

# Apply migration to each database
SUCCESS_COUNT=0
FAIL_COUNT=0

for DB_NAME in $CLINIC_DBS; do
    DB_NAME=$(echo "$DB_NAME" | xargs)  # Trim whitespace
    if [ -z "$DB_NAME" ]; then
        continue
    fi

    echo "----------------------------------------"
    echo "Applying migration to: $DB_NAME"

    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d "$DB_NAME" -f "$MIGRATION_FILE" 2>&1; then
        echo "  SUCCESS"
        ((SUCCESS_COUNT++))
    else
        echo "  FAILED (may already be applied)"
        ((FAIL_COUNT++))
    fi
done

echo ""
echo "=============================================="
echo "Migration Complete"
echo "=============================================="
echo "  Successful: $SUCCESS_COUNT"
echo "  Failed/Skipped: $FAIL_COUNT"
echo ""
echo "Next steps:"
echo "  1. Restart the backend server: pm2 restart medical-pro-backend"
echo "  2. Test authentication with an existing user"
echo "  3. Verify logs for 'authSource: central_db'"
echo ""
