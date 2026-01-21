#!/bin/bash
# Apply clinic_028_add_patient_id_number migration to all clinic databases
# This adds id_number and coverage_type columns to the patients table

set -e

# Database connection
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-medicalpro}"
DB_PASSWORD="${DB_PASSWORD:-medicalpro_secure_pwd}"
CENTRAL_DB="${CENTRAL_DB:-medicalpro_central}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Applying clinic_028_add_patient_id_number migration${NC}"
echo -e "${YELLOW}========================================${NC}"

# Get migration file path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/../migrations/clinic_028_add_patient_id_number.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}Error: Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}Migration file: $MIGRATION_FILE${NC}"

# Get all clinic database names from the central database
echo -e "\n${YELLOW}Fetching clinic databases from central database...${NC}"

CLINIC_DBS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $CENTRAL_DB -t -c "
    SELECT database_name FROM companies WHERE database_name IS NOT NULL AND is_active = true;
" 2>/dev/null | tr -d ' ')

if [ -z "$CLINIC_DBS" ]; then
    echo -e "${YELLOW}No active clinic databases found. Checking for any databases with 'medicalpro_clinic_' prefix...${NC}"
    CLINIC_DBS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -t -c "
        SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%';
    " 2>/dev/null | tr -d ' ')
fi

if [ -z "$CLINIC_DBS" ]; then
    echo -e "${YELLOW}No clinic databases found.${NC}"
    exit 0
fi

# Apply migration to each clinic database
SUCCESS=0
FAILED=0

for DB in $CLINIC_DBS; do
    if [ -n "$DB" ]; then
        echo -e "\n${YELLOW}Applying migration to: $DB${NC}"

        if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$DB" -f "$MIGRATION_FILE" 2>&1; then
            echo -e "${GREEN}✓ Migration applied successfully to $DB${NC}"
            ((SUCCESS++))
        else
            echo -e "${RED}✗ Failed to apply migration to $DB${NC}"
            ((FAILED++))
        fi
    fi
done

echo -e "\n${YELLOW}========================================${NC}"
echo -e "${GREEN}Migration Summary:${NC}"
echo -e "  ${GREEN}Successful: $SUCCESS${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo -e "${YELLOW}========================================${NC}"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
