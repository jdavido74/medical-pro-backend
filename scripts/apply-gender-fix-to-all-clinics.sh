#!/bin/bash

# Script to apply gender constraint fix to all clinic databases
# Usage: ./scripts/apply-gender-fix-to-all-clinics.sh

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

MIGRATION_FILE="/var/www/medical-pro-backend/migrations/clinic_fix_gender_constraint.sql"

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Applying Gender Constraint Fix to All Clinic Databases${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Get all clinic databases
CLINIC_DBS=$(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -t -c \
  "SELECT 'medicalpro_clinic_' || REPLACE(id::text, '-', '_') FROM companies WHERE deleted_at IS NULL;")

SUCCESS_COUNT=0
ERROR_COUNT=0

for DB_NAME in $CLINIC_DBS; do
  DB_NAME=$(echo $DB_NAME | xargs) # Trim whitespace

  echo -n "Processing $DB_NAME: "

  # Check if database exists
  DB_EXISTS=$(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -lqt | cut -d \| -f 1 | grep -w "$DB_NAME")

  if [ -z "$DB_EXISTS" ]; then
    echo -e "${RED}❌ Database not found${NC}"
    ((ERROR_COUNT++))
    continue
  fi

  # Apply migration
  RESULT=$(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d "$DB_NAME" -f "$MIGRATION_FILE" 2>&1)

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Applied${NC}"
    ((SUCCESS_COUNT++))
  else
    echo -e "${RED}❌ Failed${NC}"
    echo "   Error: $RESULT"
    ((ERROR_COUNT++))
  fi
done

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "  Success: ${GREEN}$SUCCESS_COUNT${NC}"
echo -e "  Errors:  ${RED}$ERROR_COUNT${NC}"
echo ""
