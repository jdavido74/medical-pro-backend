#!/bin/bash
# =============================================================================
# MedicalPro - Slack Alerts Setup
# =============================================================================
# Configures Slack webhook for monitoring alerts
#
# Prerequisites:
# 1. Create a Slack App at https://api.slack.com/apps
# 2. Enable "Incoming Webhooks"
# 3. Create a webhook for your #alerts channel
# 4. Copy the webhook URL
#
# Usage: sudo ./setup-slack-alerts.sh
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
SECRETS_DIR="/root/.secrets"
SLACK_WEBHOOK_FILE="$SECRETS_DIR/slack_webhook"
HEALTH_CHECK_SCRIPT="/opt/scripts/health-check.sh"

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

log() {
    echo -e "\033[0;32m[$(date '+%Y-%m-%d %H:%M:%S')]\033[0m $1"
}

error() {
    echo -e "\033[0;31m[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:\033[0m $1"
    exit 1
}

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
fi

log "=========================================="
log "MedicalPro Slack Alerts Setup"
log "=========================================="

# -----------------------------------------------------------------------------
# Get Slack Webhook URL
# -----------------------------------------------------------------------------

if [[ -f "$SLACK_WEBHOOK_FILE" ]]; then
    log "Slack webhook already configured"
    read -p "Do you want to update it? (yes/no): " UPDATE
    if [[ "$UPDATE" != "yes" ]]; then
        log "Keeping existing configuration"
        exit 0
    fi
fi

echo ""
echo "To get a Slack webhook URL:"
echo "1. Go to https://api.slack.com/apps"
echo "2. Create a new app (or select existing)"
echo "3. Enable 'Incoming Webhooks'"
echo "4. Add a webhook to your #alerts channel"
echo "5. Copy the webhook URL"
echo ""

read -p "Enter your Slack webhook URL: " WEBHOOK_URL

# Validate URL format
if [[ ! "$WEBHOOK_URL" =~ ^https://hooks\.slack\.com/services/ ]]; then
    error "Invalid Slack webhook URL format"
fi

# Save webhook
mkdir -p "$SECRETS_DIR"
echo "$WEBHOOK_URL" > "$SLACK_WEBHOOK_FILE"
chmod 600 "$SLACK_WEBHOOK_FILE"

log "  ✓ Webhook saved to $SLACK_WEBHOOK_FILE"

# -----------------------------------------------------------------------------
# Test Slack Webhook
# -----------------------------------------------------------------------------

log "Sending test message to Slack..."

TEST_PAYLOAD=$(cat << EOF
{
    "blocks": [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "🔔 MedicalPro Alerts Configured",
                "emoji": true
            }
        },
        {
            "type": "section",
            "fields": [
                {
                    "type": "mrkdwn",
                    "text": "*Server:*\n$(hostname)"
                },
                {
                    "type": "mrkdwn",
                    "text": "*Time:*\n$(date '+%Y-%m-%d %H:%M:%S')"
                }
            ]
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "✅ Slack alerts are now configured for this server.\n\nYou will receive notifications for:\n• 🔴 Critical system issues\n• 🟡 Warning thresholds\n• 📊 Daily health reports (optional)"
            }
        }
    ]
}
EOF
)

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$TEST_PAYLOAD" \
    "$WEBHOOK_URL")

if [[ "$HTTP_CODE" == "200" ]]; then
    log "  ✓ Test message sent successfully!"
else
    error "Failed to send test message (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# Update Netdata (if installed)
# -----------------------------------------------------------------------------

if command -v netdata &> /dev/null; then
    log "Updating Netdata Slack configuration..."

    NETDATA_CONFIG="/etc/netdata/health_alarm_notify.conf"

    cat > "$NETDATA_CONFIG" << EOF
# MedicalPro Alert Notifications

# Slack configuration
SEND_SLACK="YES"
SLACK_WEBHOOK_URL="$WEBHOOK_URL"
DEFAULT_RECIPIENT_SLACK="alerts"

# Role recipients
role_recipients_slack[sysadmin]="alerts"
role_recipients_slack[webmaster]="alerts"
role_recipients_slack[dba]="alerts"

# Disable other notification methods
SEND_EMAIL="NO"
SEND_TELEGRAM="NO"
SEND_DISCORD="NO"
SEND_PUSHOVER="NO"
EOF

    systemctl restart netdata
    log "  ✓ Netdata configured for Slack alerts"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

log ""
log "=========================================="
log "Slack Alerts Setup Complete!"
log "=========================================="
log ""
log "Webhook saved to: $SLACK_WEBHOOK_FILE"
log ""
log "Alerts will be sent for:"
log "  • Health check failures (API, DB, Disk, Memory)"
log "  • Netdata threshold alerts (if installed)"
log ""
log "Test your alerts with:"
log "  /opt/scripts/test-slack-alert.sh"
log ""
log "=========================================="

exit 0
