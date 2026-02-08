#!/bin/bash
# =============================================================================
# MedicalPro - Test Slack Alert
# =============================================================================
# Sends a test alert to verify Slack integration
#
# Usage: ./test-slack-alert.sh [critical|warning|info]
# =============================================================================

set -euo pipefail

SLACK_WEBHOOK_FILE="/root/.secrets/slack_webhook"
ALERT_LEVEL="${1:-info}"

# Check webhook exists
if [[ ! -f "$SLACK_WEBHOOK_FILE" ]]; then
    echo "ERROR: Slack webhook not configured"
    echo "Run: /opt/scripts/setup-slack-alerts.sh"
    exit 1
fi

WEBHOOK_URL=$(cat "$SLACK_WEBHOOK_FILE")

# Set emoji and color based on level
case "$ALERT_LEVEL" in
    critical)
        EMOJI="🔴"
        COLOR="#dc3545"
        TITLE="CRITICAL Test Alert"
        ;;
    warning)
        EMOJI="🟡"
        COLOR="#ffc107"
        TITLE="WARNING Test Alert"
        ;;
    *)
        EMOJI="🔵"
        COLOR="#17a2b8"
        TITLE="INFO Test Alert"
        ;;
esac

# Build payload
PAYLOAD=$(cat << EOF
{
    "attachments": [
        {
            "color": "$COLOR",
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "$EMOJI $TITLE",
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
                        },
                        {
                            "type": "mrkdwn",
                            "text": "*Level:*\n${ALERT_LEVEL^^}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": "*Source:*\nManual Test"
                        }
                    ]
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "This is a test alert from MedicalPro monitoring system.\n\nIf you received this message, Slack alerts are working correctly! ✅"
                    }
                }
            ]
        }
    ]
}
EOF
)

# Send alert
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "$WEBHOOK_URL")

if [[ "$HTTP_CODE" == "200" ]]; then
    echo "✓ Test alert sent successfully!"
else
    echo "✗ Failed to send alert (HTTP $HTTP_CODE)"
    exit 1
fi
