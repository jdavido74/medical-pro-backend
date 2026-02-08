#!/bin/bash
# =============================================================================
# MedicalPro - Health Check Script
# =============================================================================
# Monitors API health, disk space, and memory usage
# Sends alerts via email when thresholds are exceeded
#
# Usage: /opt/scripts/health-check.sh
# Cron:  */5 * * * * root /opt/scripts/health-check.sh
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
API_URL="http://localhost:3001/api/v1/health"
API_TIMEOUT=10

# Thresholds
DISK_WARNING_PERCENT=85
DISK_CRITICAL_PERCENT=95
MEMORY_WARNING_PERCENT=90
MEMORY_CRITICAL_PERCENT=95

# Alert configuration
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@votreclinique.es}"
ALERT_LOG="/var/log/medicalpro-alerts.log"

# Cooldown: don't send same alert within this period (seconds)
COOLDOWN_FILE="/tmp/medicalpro-alert-cooldown"
COOLDOWN_PERIOD=3600  # 1 hour

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

alert() {
    local LEVEL="$1"
    local SUBJECT="$2"
    local MESSAGE="$3"
    local ALERT_KEY="$4"

    # Check cooldown
    if [[ -f "$COOLDOWN_FILE" ]]; then
        LAST_ALERT=$(grep "^$ALERT_KEY=" "$COOLDOWN_FILE" 2>/dev/null | cut -d= -f2 || echo "0")
        CURRENT_TIME=$(date +%s)

        if (( CURRENT_TIME - LAST_ALERT < COOLDOWN_PERIOD )); then
            log "Alert '$ALERT_KEY' in cooldown, skipping"
            return
        fi
    fi

    # Log alert
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$LEVEL] $SUBJECT: $MESSAGE" >> "$ALERT_LOG"

    # Send email
    if command -v mail &> /dev/null; then
        echo -e "Server: $(hostname)\nTime: $(date)\n\n$MESSAGE" | \
            mail -s "[$LEVEL] MedicalPro - $SUBJECT" "$ADMIN_EMAIL"
        log "Alert sent to $ADMIN_EMAIL: $SUBJECT"
    else
        log "WARNING: mail command not found, cannot send alert"
    fi

    # Update cooldown
    mkdir -p "$(dirname "$COOLDOWN_FILE")"
    if [[ -f "$COOLDOWN_FILE" ]]; then
        grep -v "^$ALERT_KEY=" "$COOLDOWN_FILE" > "$COOLDOWN_FILE.tmp" 2>/dev/null || true
        mv "$COOLDOWN_FILE.tmp" "$COOLDOWN_FILE"
    fi
    echo "$ALERT_KEY=$(date +%s)" >> "$COOLDOWN_FILE"
}

# -----------------------------------------------------------------------------
# API Health Check
# -----------------------------------------------------------------------------
check_api() {
    log "Checking API health..."

    HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time "$API_TIMEOUT" "$API_URL" 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" == "200" ]]; then
        log "  ✓ API is healthy (HTTP $HTTP_CODE)"
        return 0
    else
        log "  ✗ API is DOWN (HTTP $HTTP_CODE)"
        alert "CRITICAL" "API Down" "MedicalPro API is not responding.\n\nURL: $API_URL\nHTTP Status: $HTTP_CODE\n\nPlease check PM2 and server logs:\n  pm2 status\n  pm2 logs medical-pro-backend" "api_down"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# Disk Space Check
# -----------------------------------------------------------------------------
check_disk() {
    log "Checking disk space..."

    # Check root partition
    DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')

    if (( DISK_USAGE >= DISK_CRITICAL_PERCENT )); then
        log "  ✗ CRITICAL: Disk usage at ${DISK_USAGE}%"
        alert "CRITICAL" "Disk Space Critical" "Disk usage has reached ${DISK_USAGE}%!\n\nThis is above the critical threshold of ${DISK_CRITICAL_PERCENT}%.\n\nImmediate action required.\n\n$(df -h)" "disk_critical"
        return 1
    elif (( DISK_USAGE >= DISK_WARNING_PERCENT )); then
        log "  ! WARNING: Disk usage at ${DISK_USAGE}%"
        alert "WARNING" "Disk Space Warning" "Disk usage has reached ${DISK_USAGE}%.\n\nThis is above the warning threshold of ${DISK_WARNING_PERCENT}%.\n\nConsider cleaning up old backups or logs.\n\n$(df -h)" "disk_warning"
        return 0
    else
        log "  ✓ Disk usage: ${DISK_USAGE}%"
        return 0
    fi
}

# -----------------------------------------------------------------------------
# Memory Check
# -----------------------------------------------------------------------------
check_memory() {
    log "Checking memory usage..."

    MEMORY_USAGE=$(free | awk '/Mem/ {printf("%.0f", $3/$2 * 100)}')

    if (( MEMORY_USAGE >= MEMORY_CRITICAL_PERCENT )); then
        log "  ✗ CRITICAL: Memory usage at ${MEMORY_USAGE}%"
        alert "CRITICAL" "Memory Critical" "Memory usage has reached ${MEMORY_USAGE}%!\n\nThis is above the critical threshold of ${MEMORY_CRITICAL_PERCENT}%.\n\n$(free -h)\n\nTop memory consumers:\n$(ps aux --sort=-%mem | head -10)" "memory_critical"
        return 1
    elif (( MEMORY_USAGE >= MEMORY_WARNING_PERCENT )); then
        log "  ! WARNING: Memory usage at ${MEMORY_USAGE}%"
        alert "WARNING" "Memory Warning" "Memory usage has reached ${MEMORY_USAGE}%.\n\nThis is above the warning threshold of ${MEMORY_WARNING_PERCENT}%.\n\n$(free -h)" "memory_warning"
        return 0
    else
        log "  ✓ Memory usage: ${MEMORY_USAGE}%"
        return 0
    fi
}

# -----------------------------------------------------------------------------
# PM2 Process Check
# -----------------------------------------------------------------------------
check_pm2() {
    log "Checking PM2 processes..."

    if ! command -v pm2 &> /dev/null; then
        log "  ! PM2 not found in PATH"
        return 1
    fi

    # Check if backend is running
    BACKEND_STATUS=$(pm2 jlist 2>/dev/null | grep -o '"name":"medical-pro-backend"[^}]*"status":"[^"]*"' | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "not found")

    if [[ "$BACKEND_STATUS" == "online" ]]; then
        log "  ✓ Backend process is online"
    else
        log "  ✗ Backend process status: $BACKEND_STATUS"
        alert "CRITICAL" "PM2 Backend Down" "MedicalPro backend process is not running.\n\nStatus: $BACKEND_STATUS\n\nTry restarting:\n  pm2 restart medical-pro-backend\n\nCheck logs:\n  pm2 logs medical-pro-backend" "pm2_backend"
        return 1
    fi

    # Check if frontend is running
    FRONTEND_STATUS=$(pm2 jlist 2>/dev/null | grep -o '"name":"medical-pro-frontend"[^}]*"status":"[^"]*"' | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "not found")

    if [[ "$FRONTEND_STATUS" == "online" ]]; then
        log "  ✓ Frontend process is online"
    else
        log "  ! Frontend process status: $FRONTEND_STATUS"
        # Frontend issues are less critical, just log
    fi

    return 0
}

# -----------------------------------------------------------------------------
# PostgreSQL Check
# -----------------------------------------------------------------------------
check_postgres() {
    log "Checking PostgreSQL..."

    if systemctl is-active --quiet postgresql; then
        log "  ✓ PostgreSQL service is running"

        # Check if we can connect
        if PGPASSWORD=$(cat /root/.secrets/db_password 2>/dev/null) psql -h localhost -U medicalpro -d medicalpro_central -c "SELECT 1" &>/dev/null; then
            log "  ✓ Database connection successful"
            return 0
        else
            log "  ✗ Cannot connect to database"
            alert "CRITICAL" "Database Connection Failed" "Cannot connect to PostgreSQL database.\n\nCheck PostgreSQL logs:\n  journalctl -u postgresql\n  tail /var/log/postgresql/*.log" "db_connection"
            return 1
        fi
    else
        log "  ✗ PostgreSQL service is not running"
        alert "CRITICAL" "PostgreSQL Down" "PostgreSQL service is not running.\n\nTry restarting:\n  systemctl start postgresql\n\nCheck logs:\n  journalctl -u postgresql" "postgres_down"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

log "=========================================="
log "MedicalPro Health Check"
log "=========================================="

ERRORS=0

check_api || ((ERRORS++))
check_disk || ((ERRORS++))
check_memory || ((ERRORS++))
check_pm2 || ((ERRORS++))
check_postgres || ((ERRORS++))

log "=========================================="
if (( ERRORS == 0 )); then
    log "All checks passed ✓"
else
    log "Checks completed with $ERRORS error(s)"
fi
log "=========================================="

exit $ERRORS
