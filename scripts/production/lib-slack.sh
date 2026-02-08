#!/bin/bash
# =============================================================================
# MedicalPro - Slack Alert Library
# =============================================================================
# Shared functions for sending Slack alerts
# Source this file in other scripts: source /opt/scripts/lib-slack.sh
# =============================================================================

SLACK_WEBHOOK_FILE="/root/.secrets/slack_webhook"

# -----------------------------------------------------------------------------
# send_slack_alert - Send an alert to Slack
# -----------------------------------------------------------------------------
# Arguments:
#   $1 - Level: critical, warning, info, success
#   $2 - Title: Short title for the alert
#   $3 - Message: Detailed message
#   $4 - Fields (optional): JSON array of fields
#
# Example:
#   send_slack_alert "critical" "API Down" "The API is not responding"
#   send_slack_alert "warning" "Disk Space" "Disk usage at 85%" '[{"title":"Disk","value":"85%"}]'
# -----------------------------------------------------------------------------

send_slack_alert() {
    local LEVEL="${1:-info}"
    local TITLE="${2:-Alert}"
    local MESSAGE="${3:-No message provided}"
    local FIELDS="${4:-}"

    # Check if Slack is configured
    if [[ ! -f "$SLACK_WEBHOOK_FILE" ]]; then
        return 1
    fi

    local WEBHOOK_URL
    WEBHOOK_URL=$(cat "$SLACK_WEBHOOK_FILE")

    # Set emoji and color based on level
    local EMOJI COLOR
    case "$LEVEL" in
        critical|error)
            EMOJI="🔴"
            COLOR="#dc3545"
            ;;
        warning|warn)
            EMOJI="🟡"
            COLOR="#ffc107"
            ;;
        success|ok)
            EMOJI="🟢"
            COLOR="#28a745"
            ;;
        *)
            EMOJI="🔵"
            COLOR="#17a2b8"
            ;;
    esac

    # Build fields JSON
    local FIELDS_JSON=""
    if [[ -n "$FIELDS" ]]; then
        FIELDS_JSON=",
                {
                    \"type\": \"section\",
                    \"fields\": $FIELDS
                }"
    fi

    # Build payload
    local PAYLOAD
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
                        }
                    ]
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "$MESSAGE"
                    }
                }$FIELDS_JSON
            ]
        }
    ]
}
EOF
)

    # Send to Slack (silent, non-blocking)
    curl -s -o /dev/null -X POST \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "$WEBHOOK_URL" &

    return 0
}

# -----------------------------------------------------------------------------
# send_slack_health_report - Send daily health report
# -----------------------------------------------------------------------------

send_slack_health_report() {
    local STATUS="${1:-ok}"
    local DETAILS="${2:-All systems operational}"

    local EMOJI TITLE
    if [[ "$STATUS" == "ok" ]]; then
        EMOJI="✅"
        TITLE="Daily Health Report - All OK"
    else
        EMOJI="⚠️"
        TITLE="Daily Health Report - Issues Detected"
    fi

    # Gather system stats
    local CPU_USAGE MEMORY_USAGE DISK_USAGE
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
    MEMORY_USAGE=$(free | awk '/Mem/ {printf("%.1f", $3/$2 * 100)}')
    DISK_USAGE=$(df / | awk 'NR==2 {print $5}')

    local FIELDS='[
        {"type": "mrkdwn", "text": "*CPU:*\n'"$CPU_USAGE"'%"},
        {"type": "mrkdwn", "text": "*Memory:*\n'"$MEMORY_USAGE"'%"},
        {"type": "mrkdwn", "text": "*Disk:*\n'"$DISK_USAGE"'"},
        {"type": "mrkdwn", "text": "*Uptime:*\n'"$(uptime -p)"'"}
    ]'

    send_slack_alert "info" "$TITLE" "$DETAILS" "$FIELDS"
}
