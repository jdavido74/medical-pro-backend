#!/bin/bash
# =============================================================================
# MedicalPro - Production Backup Script
# =============================================================================
# Backs up all PostgreSQL databases (central + clinic databases)
# Encrypts backups using GPG with AES256
# Maintains 30-day retention policy
#
# Usage: /opt/scripts/backup-medicalpro.sh
# Cron:  0 3 * * * root /opt/scripts/backup-medicalpro.sh
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
BACKUP_DIR="/var/backups/medicalpro"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
LOG="/var/log/medicalpro-backup.log"
SECRETS_DIR="/root/.secrets"

# External backup (uncomment if configured)
# RCLONE_REMOTE="hetzner:medicalpro-backups/"
# RCLONE_CONFIG="/root/.config/rclone/rclone.conf"

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

check_secrets() {
    if [[ ! -f "$SECRETS_DIR/db_password" ]]; then
        error_exit "Database password file not found: $SECRETS_DIR/db_password"
    fi
    if [[ ! -f "$SECRETS_DIR/backup_key" ]]; then
        error_exit "Backup encryption key not found: $SECRETS_DIR/backup_key"
    fi
}

# -----------------------------------------------------------------------------
# Main Script
# -----------------------------------------------------------------------------

log "=========================================="
log "Starting MedicalPro backup..."
log "=========================================="

# Check prerequisites
check_secrets

# Load secrets
DB_PASSWORD=$(cat "$SECRETS_DIR/db_password")
ENCRYPTION_KEY=$(cat "$SECRETS_DIR/backup_key")

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# -----------------------------------------------------------------------------
# Backup Central Database
# -----------------------------------------------------------------------------
log "Backing up central database..."

CENTRAL_BACKUP="$BACKUP_DIR/central_${DATE}.dump.gpg"

PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h localhost \
    -U medicalpro \
    -Fc \
    medicalpro_central 2>/dev/null \
    | gpg --batch --symmetric --cipher-algo AES256 --passphrase "$ENCRYPTION_KEY" \
    > "$CENTRAL_BACKUP"

if [[ -f "$CENTRAL_BACKUP" && -s "$CENTRAL_BACKUP" ]]; then
    log "Central database backed up: $(du -h "$CENTRAL_BACKUP" | cut -f1)"
else
    log "WARNING: Central database backup may be empty"
fi

# -----------------------------------------------------------------------------
# Backup Clinic Databases
# -----------------------------------------------------------------------------
log "Backing up clinic databases..."

# Get list of active clinic databases
CLINIC_DBS=$(PGPASSWORD="$DB_PASSWORD" psql \
    -h localhost \
    -U medicalpro \
    -d medicalpro_central \
    -t \
    -c "SELECT 'medicalpro_clinic_' || REPLACE(id::text, '-', '_') FROM companies WHERE is_active = true" \
    2>/dev/null || echo "")

CLINIC_COUNT=0

if [[ -n "$CLINIC_DBS" ]]; then
    while IFS= read -r db; do
        # Trim whitespace
        db=$(echo "$db" | xargs)

        if [[ -n "$db" ]]; then
            CLINIC_BACKUP="$BACKUP_DIR/${db}_${DATE}.dump.gpg"

            if PGPASSWORD="$DB_PASSWORD" pg_dump \
                -h localhost \
                -U medicalpro \
                -Fc \
                "$db" 2>/dev/null \
                | gpg --batch --symmetric --cipher-algo AES256 --passphrase "$ENCRYPTION_KEY" \
                > "$CLINIC_BACKUP" 2>/dev/null; then

                if [[ -f "$CLINIC_BACKUP" && -s "$CLINIC_BACKUP" ]]; then
                    log "  ✓ $db: $(du -h "$CLINIC_BACKUP" | cut -f1)"
                    ((CLINIC_COUNT++))
                else
                    log "  ✗ $db: Backup empty, removing"
                    rm -f "$CLINIC_BACKUP"
                fi
            else
                log "  ✗ $db: Backup failed"
                rm -f "$CLINIC_BACKUP"
            fi
        fi
    done <<< "$CLINIC_DBS"
fi

log "Clinic databases backed up: $CLINIC_COUNT"

# -----------------------------------------------------------------------------
# Cleanup Old Backups
# -----------------------------------------------------------------------------
log "Cleaning up backups older than $RETENTION_DAYS days..."

DELETED_COUNT=$(find "$BACKUP_DIR" -name "*.dump.gpg" -mtime +$RETENTION_DAYS -delete -print | wc -l)
log "Deleted $DELETED_COUNT old backup files"

# -----------------------------------------------------------------------------
# Sync to External Storage (Optional)
# -----------------------------------------------------------------------------
# Uncomment the following section if you have configured rclone for external backups

# if [[ -n "${RCLONE_REMOTE:-}" && -f "${RCLONE_CONFIG:-}" ]]; then
#     log "Syncing to external storage..."
#     if rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --config "$RCLONE_CONFIG" 2>/dev/null; then
#         log "External sync completed successfully"
#     else
#         log "WARNING: External sync failed"
#     fi
# fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "*_${DATE}.dump.gpg" | wc -l)

log "=========================================="
log "Backup completed successfully"
log "  - Total backups created: $BACKUP_COUNT"
log "  - Backup directory size: $TOTAL_SIZE"
log "=========================================="

exit 0
