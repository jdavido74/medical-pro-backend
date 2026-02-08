#!/bin/bash
# =============================================================================
# MedicalPro - Production Restore Script
# =============================================================================
# Restores a PostgreSQL database from encrypted backup
#
# Usage:
#   ./restore-medicalpro.sh <backup_file.dump.gpg> <database_name>
#   ./restore-medicalpro.sh central_20240115_030000.dump.gpg medicalpro_central
#   ./restore-medicalpro.sh medicalpro_clinic_xyz_20240115_030000.dump.gpg medicalpro_clinic_xyz
#
# Options:
#   --dry-run    Show what would be done without executing
#   --no-clean   Don't drop existing objects before restore
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
BACKUP_DIR="/var/backups/medicalpro"
SECRETS_DIR="/root/.secrets"
LOG="/var/log/medicalpro-restore.log"

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------
DRY_RUN=false
CLEAN_FLAG="--clean --if-exists"

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-clean)
            CLEAN_FLAG=""
            shift
            ;;
        *)
            break
            ;;
    esac
done

BACKUP_FILE="${1:-}"
DB_NAME="${2:-}"

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

usage() {
    cat << EOF
Usage: $0 [options] <backup_file.dump.gpg> <database_name>

Options:
  --dry-run    Show what would be done without executing
  --no-clean   Don't drop existing objects before restore

Examples:
  $0 central_20240115_030000.dump.gpg medicalpro_central
  $0 --dry-run medicalpro_clinic_xyz.dump.gpg medicalpro_clinic_xyz
  $0 /var/backups/medicalpro/central_20240115.dump.gpg medicalpro_central

Available backups:
EOF
    ls -lh "$BACKUP_DIR"/*.dump.gpg 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    exit 1
}

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [[ -z "$BACKUP_FILE" || -z "$DB_NAME" ]]; then
    usage
fi

# Handle relative or absolute paths
if [[ "$BACKUP_FILE" != /* ]]; then
    BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    error_exit "Backup file not found: $BACKUP_FILE"
fi

if [[ ! -f "$SECRETS_DIR/db_password" ]]; then
    error_exit "Database password file not found: $SECRETS_DIR/db_password"
fi

if [[ ! -f "$SECRETS_DIR/backup_key" ]]; then
    error_exit "Backup encryption key not found: $SECRETS_DIR/backup_key"
fi

# Load secrets
DB_PASSWORD=$(cat "$SECRETS_DIR/db_password")
ENCRYPTION_KEY=$(cat "$SECRETS_DIR/backup_key")

# -----------------------------------------------------------------------------
# Confirmation
# -----------------------------------------------------------------------------

log "=========================================="
log "MedicalPro Database Restore"
log "=========================================="
log "Backup file: $BACKUP_FILE"
log "Target database: $DB_NAME"
log "Dry run: $DRY_RUN"
log "Clean before restore: $([ -n "$CLEAN_FLAG" ] && echo "yes" || echo "no")"

if [[ "$DRY_RUN" == "false" ]]; then
    echo ""
    echo "WARNING: This will overwrite data in database '$DB_NAME'!"
    echo ""
    read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

    if [[ "$CONFIRM" != "yes" ]]; then
        log "Restore cancelled by user"
        exit 0
    fi
fi

# -----------------------------------------------------------------------------
# Pre-restore checks
# -----------------------------------------------------------------------------

log "Verifying backup file integrity..."

# Test decryption without actually restoring
if ! gpg --batch --decrypt --passphrase "$ENCRYPTION_KEY" "$BACKUP_FILE" 2>/dev/null | head -c 100 | pg_restore -l >/dev/null 2>&1; then
    error_exit "Backup file appears corrupted or encryption key is incorrect"
fi

log "Backup file verified successfully"

# Check if database exists
DB_EXISTS=$(PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME" && echo "yes" || echo "no")

if [[ "$DB_EXISTS" == "no" ]]; then
    log "WARNING: Database '$DB_NAME' does not exist. It will be created."

    if [[ "$DRY_RUN" == "false" ]]; then
        PGPASSWORD="$DB_PASSWORD" createdb -h localhost -U medicalpro "$DB_NAME" 2>/dev/null || true
    fi
fi

# -----------------------------------------------------------------------------
# Restore
# -----------------------------------------------------------------------------

if [[ "$DRY_RUN" == "true" ]]; then
    log "DRY RUN - Would execute:"
    log "  gpg --decrypt $BACKUP_FILE | pg_restore -h localhost -U medicalpro -d $DB_NAME $CLEAN_FLAG"
    log ""
    log "Contents of backup:"
    gpg --batch --decrypt --passphrase "$ENCRYPTION_KEY" "$BACKUP_FILE" 2>/dev/null | pg_restore -l | head -50
else
    log "Starting restore..."

    # Create temporary file for better error handling
    TEMP_DUMP=$(mktemp)
    trap "rm -f $TEMP_DUMP" EXIT

    # Decrypt backup
    log "Decrypting backup..."
    gpg --batch --decrypt --passphrase "$ENCRYPTION_KEY" "$BACKUP_FILE" > "$TEMP_DUMP" 2>/dev/null

    # Get backup size
    BACKUP_SIZE=$(du -h "$TEMP_DUMP" | cut -f1)
    log "Decrypted backup size: $BACKUP_SIZE"

    # Restore
    log "Restoring to database '$DB_NAME'..."

    if PGPASSWORD="$DB_PASSWORD" pg_restore \
        -h localhost \
        -U medicalpro \
        -d "$DB_NAME" \
        $CLEAN_FLAG \
        --no-owner \
        --no-privileges \
        "$TEMP_DUMP" 2>&1 | tee -a "$LOG"; then

        log "Restore completed successfully"
    else
        # pg_restore returns non-zero for warnings too, check if critical
        log "Restore completed with some warnings (check log for details)"
    fi

    # Verify restore
    log "Verifying restore..."
    TABLE_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h localhost -U medicalpro -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | xargs)
    log "Tables in restored database: $TABLE_COUNT"
fi

log "=========================================="
log "Restore process completed"
log "=========================================="

exit 0
