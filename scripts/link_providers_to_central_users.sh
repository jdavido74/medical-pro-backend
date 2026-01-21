#!/bin/bash
# Script to link existing healthcare_providers to their central users
# This populates central_user_id by matching email addresses
#
# Usage: ./scripts/link_providers_to_central_users.sh
#
# IMPORTANT: Run this AFTER apply_phase1_migration.sh

set -e

# Database connection settings
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-medicalpro}"
DB_PASSWORD="${DB_PASSWORD:-medicalpro2024}"
CENTRAL_DB="medicalpro_central"

echo "=============================================="
echo "Link Healthcare Providers to Central Users"
echo "=============================================="
echo ""

# Get list of all clinic databases
CLINIC_DBS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%'")

if [ -z "$CLINIC_DBS" ]; then
    echo "No clinic databases found."
    exit 0
fi

for DB_NAME in $CLINIC_DBS; do
    DB_NAME=$(echo "$DB_NAME" | xargs)
    if [ -z "$DB_NAME" ]; then
        continue
    fi

    echo "----------------------------------------"
    echo "Processing: $DB_NAME"

    # Update healthcare_providers with matching central user IDs
    # This uses a subquery to find users in the central DB by email
    UPDATE_SQL="
    UPDATE healthcare_providers hp
    SET
        central_user_id = u.id,
        auth_migrated_to_central = true
    FROM (
        SELECT id, email FROM dblink(
            'host=$DB_HOST port=$DB_PORT dbname=$CENTRAL_DB user=$DB_USER password=$DB_PASSWORD',
            'SELECT id, email FROM users'
        ) AS t(id UUID, email VARCHAR)
    ) u
    WHERE LOWER(hp.email) = LOWER(u.email)
    AND hp.central_user_id IS NULL;
    "

    # First, check if dblink extension exists
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS dblink;" 2>/dev/null || true

    # Alternative approach without dblink - export emails from central and match
    echo "  Fetching users from central database..."
    CENTRAL_USERS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d "$CENTRAL_DB" -t -c "SELECT id, email FROM users;")

    while IFS='|' read -r USER_ID USER_EMAIL; do
        USER_ID=$(echo "$USER_ID" | xargs)
        USER_EMAIL=$(echo "$USER_EMAIL" | xargs | tr '[:upper:]' '[:lower:]')

        if [ -z "$USER_ID" ] || [ -z "$USER_EMAIL" ]; then
            continue
        fi

        # Update the healthcare_provider with matching email
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d "$DB_NAME" -c "
            UPDATE healthcare_providers
            SET central_user_id = '$USER_ID',
                auth_migrated_to_central = true
            WHERE LOWER(email) = '$USER_EMAIL'
            AND central_user_id IS NULL;
        " 2>/dev/null || true
    done <<< "$CENTRAL_USERS"

    # Report on updated records
    UPDATED=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM healthcare_providers WHERE central_user_id IS NOT NULL;")
    TOTAL=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM healthcare_providers;")

    echo "  Linked: $(echo $UPDATED | xargs) / $(echo $TOTAL | xargs) providers"
done

echo ""
echo "=============================================="
echo "Linking Complete"
echo "=============================================="
echo ""
echo "Providers with central_user_id are now using central authentication."
echo "Providers without central_user_id need manual verification."
echo ""
