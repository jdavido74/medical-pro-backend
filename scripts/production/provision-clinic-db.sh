#!/bin/bash
# =============================================================================
# MedicalPro - Clinic Database Provisioning Script
# =============================================================================
# Creates a new clinic database with all required migrations
#
# Usage: ./provision-clinic-db.sh <clinic_id>
# Example: ./provision-clinic-db.sh 550e8400-e29b-41d4-a716-446655440000
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SECRETS_DIR="/root/.secrets"
MIGRATIONS_DIR="/var/www/medical-pro-backend/migrations"
LOG="/var/log/medicalpro-provision.log"

# -----------------------------------------------------------------------------
# Arguments
# -----------------------------------------------------------------------------
CLINIC_ID="${1:-}"

if [[ -z "$CLINIC_ID" ]]; then
    echo "Usage: $0 <clinic_id>"
    echo "Example: $0 550e8400-e29b-41d4-a716-446655440000"
    exit 1
fi

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

error_exit() {
    log "ERROR: $1"
    exit 1
}

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

# Validate UUID format
if ! [[ "$CLINIC_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    error_exit "Invalid clinic ID format. Must be a valid UUID."
fi

# Check secrets
if [[ ! -f "$SECRETS_DIR/db_password" ]]; then
    error_exit "Database password file not found"
fi

DB_PASSWORD=$(cat "$SECRETS_DIR/db_password")

# Transform UUID to database name format (replace - with _)
DB_NAME="medicalpro_clinic_${CLINIC_ID//-/_}"

log "=========================================="
log "Provisioning clinic database"
log "=========================================="
log "Clinic ID: $CLINIC_ID"
log "Database: $DB_NAME"

# -----------------------------------------------------------------------------
# Create Database
# -----------------------------------------------------------------------------

log "Creating database..."

# Check if database exists
DB_EXISTS=$(PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME" && echo "yes" || echo "no")

if [[ "$DB_EXISTS" == "yes" ]]; then
    log "Database $DB_NAME already exists"
else
    PGPASSWORD="$DB_PASSWORD" createdb -h localhost -U medicalpro "$DB_NAME"
    log "Database $DB_NAME created"
fi

# -----------------------------------------------------------------------------
# Run Migrations
# -----------------------------------------------------------------------------

log "Running clinic migrations..."

MIGRATION_COUNT=0
MIGRATION_ERRORS=0

# Get sorted list of clinic migrations
CLINIC_MIGRATIONS=$(find "$MIGRATIONS_DIR" -name "[0-9][0-9][0-9]_*.sql" ! -name "central_*" | sort)

for migration in $CLINIC_MIGRATIONS; do
    MIGRATION_NAME=$(basename "$migration")

    # Run migration
    if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -d "$DB_NAME" -f "$migration" >/dev/null 2>&1; then
        log "  ✓ $MIGRATION_NAME"
        ((MIGRATION_COUNT++))
    else
        # Check if it's a duplicate key error (already applied)
        if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -d "$DB_NAME" -f "$migration" 2>&1 | grep -q "already exists"; then
            log "  ⊘ $MIGRATION_NAME (already applied)"
        else
            log "  ✗ $MIGRATION_NAME (failed)"
            ((MIGRATION_ERRORS++))
        fi
    fi
done

# -----------------------------------------------------------------------------
# Update Central Database
# -----------------------------------------------------------------------------

log "Updating central database..."

PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -d medicalpro_central << EOSQL
UPDATE companies
SET clinic_db_provisioned = true, updated_at = NOW()
WHERE id = '$CLINIC_ID';
EOSQL

log "Central database updated"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

log "=========================================="
log "Provisioning complete"
log "  - Migrations applied: $MIGRATION_COUNT"
log "  - Errors: $MIGRATION_ERRORS"
log "=========================================="

if [[ $MIGRATION_ERRORS -gt 0 ]]; then
    exit 1
fi

exit 0
