#!/bin/bash

# Clinic Initialization Script
# Purpose: Create and initialize a new clinic database
#
# Usage: ./scripts/init-clinic.sh "Clinic Name" "contact@clinic.fr"
#
# This script:
# 1. Generates a unique UUID for the clinic
# 2. Creates the clinic-specific PostgreSQL database
# 3. Runs all schema migrations
# 4. Registers the clinic in the central database

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-medicalpro}
DB_PASSWORD=${DB_PASSWORD:-medicalpro2024}
CENTRAL_DB="medicalpro_central"
MIGRATIONS_DIR="migrations"

# Check arguments
if [ $# -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 'Clinic Name' 'contact@clinic.fr' [phone]"
    echo ""
    echo "Example:"
    echo "  $0 'Clinique Paris' 'paris@clinic.fr' '+33123456789'"
    exit 1
fi

CLINIC_NAME=$1
CLINIC_EMAIL=$2
CLINIC_PHONE=${3:-""}

# Generate UUID for clinic
CLINIC_UUID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
CLINIC_DB="medicalpro_clinic_${CLINIC_UUID//-/_}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Clinic Initialization${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Clinic Name:  ${GREEN}${CLINIC_NAME}${NC}"
echo -e "Clinic Email: ${GREEN}${CLINIC_EMAIL}${NC}"
echo -e "Clinic Phone: ${GREEN}${CLINIC_PHONE:-'N/A'}${NC}"
echo -e "Clinic UUID:  ${YELLOW}${CLINIC_UUID}${NC}"
echo -e "Clinic DB:    ${YELLOW}${CLINIC_DB}${NC}"
echo ""

# Step 1: Create clinic database
echo -e "${BLUE}Step 1: Creating clinic database...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c \
    "CREATE DATABASE \"$CLINIC_DB\" OWNER $DB_USER;" 2>/dev/null || {
    echo -e "${RED}Error: Database already exists or creation failed${NC}"
    exit 1
}
echo -e "${GREEN}✅ Database created: $CLINIC_DB${NC}"

# Step 2: Run migrations
echo -e "${BLUE}Step 2: Running migrations...${NC}"

# Get list of migration files (002 onwards - skip initial schema if different)
MIGRATION_FILES=(
    "002_medical_patients.sql"
    "003_products_services.sql"
    "004_medical_practitioners.sql"
    "005_medical_appointments.sql"
    "006_medical_appointment_items.sql"
    "007_medical_documents.sql"
    "008_medical_consents.sql"
)

# Check if 001_initial_schema exists and needs to be run first
if [ -f "$MIGRATIONS_DIR/001_initial_schema.sql" ]; then
    MIGRATION_FILES=("001_initial_schema.sql" "${MIGRATION_FILES[@]}")
fi

for migration in "${MIGRATION_FILES[@]}"; do
    MIGRATION_FILE="$MIGRATIONS_DIR/$migration"

    if [ ! -f "$MIGRATION_FILE" ]; then
        echo -e "${YELLOW}⚠️  Skipping $migration (not found)${NC}"
        continue
    fi

    echo -n "  Running $migration... "
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$CLINIC_DB" \
        -f "$MIGRATION_FILE" > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${RED}❌${NC}"
        echo -e "${RED}Error running migration: $migration${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ All migrations executed successfully${NC}"

# Step 3: Register in central database
echo -e "${BLUE}Step 3: Registering clinic in central database...${NC}"

PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$CENTRAL_DB" << EOF > /dev/null 2>&1
INSERT INTO companies (
    id, name, email, phone,
    db_host, db_port, db_name, db_user, db_password,
    is_active, subscription_status
)
VALUES (
    '$CLINIC_UUID'::uuid,
    '$CLINIC_NAME',
    '$CLINIC_EMAIL',
    '$CLINIC_PHONE',
    '$DB_HOST',
    $DB_PORT,
    '$CLINIC_DB',
    '$DB_USER',
    '$DB_PASSWORD',
    true,
    'active'
) ON CONFLICT (id) DO NOTHING;
EOF

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Clinic registered in central database${NC}"
else
    echo -e "${RED}❌ Failed to register clinic${NC}"
    exit 1
fi

# Success summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Clinic Initialized Successfully! ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Clinic ID:  ${YELLOW}${CLINIC_UUID}${NC}"
echo -e "Database:   ${YELLOW}${CLINIC_DB}${NC}"
echo ""
echo -e "Next steps:"
echo "  1. Create a super admin user for this clinic"
echo "  2. Assign doctors/practitioners"
echo "  3. Configure consent templates"
echo ""
