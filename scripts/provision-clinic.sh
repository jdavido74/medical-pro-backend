#!/bin/bash

# Script pour provisionner une base de données clinic
# Usage: ./provision-clinic.sh <clinic_id>

if [ -z "$1" ]; then
    echo "Usage: $0 <clinic_id>"
    echo "Example: $0 26be0b97-889d-4a4d-bab8-3ae36261ed65"
    exit 1
fi

CLINIC_ID="$1"
DB_NAME="medicalpro_clinic_${CLINIC_ID}"
DB_USER="medicalpro"
DB_PASSWORD="medicalpro2024"
MIGRATIONS_DIR="/var/www/medical-pro-backend/migrations"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏥 Provisioning Clinic Database"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Clinic ID: $CLINIC_ID"
echo "📋 Database: $DB_NAME"
echo ""

# 1. Vérifier si la clinic existe dans la base centrale
echo "🔍 Step 1: Checking if clinic exists in central database..."
CLINIC_EXISTS=$(PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d medicalpro_central -t -c "SELECT COUNT(*) FROM companies WHERE id = '$CLINIC_ID';")

if [ "$CLINIC_EXISTS" -eq "0" ]; then
    echo "❌ Clinic not found in central database!"
    exit 1
fi

CLINIC_NAME=$(PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d medicalpro_central -t -c "SELECT name FROM companies WHERE id = '$CLINIC_ID';" | xargs)
echo "✅ Clinic found: $CLINIC_NAME"

# 2. Créer la base de données
echo ""
echo "🔨 Step 2: Creating database..."
PGPASSWORD=$DB_PASSWORD createdb -h localhost -U $DB_USER $DB_NAME 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Database created successfully"
else
    echo "⚠️  Database already exists, continuing..."
fi

# 3. Appliquer les migrations
echo ""
echo "🔨 Step 3: Applying migrations..."

# Liste des migrations à appliquer dans l'ordre
MIGRATIONS=(
    "001_medical_schema.sql"
    "002_medical_patients.sql"
    "004_medical_practitioners.sql"
    "005_medical_appointments.sql"
    "006_medical_appointment_items.sql"
    "007_medical_documents.sql"
    "008_medical_consents.sql"
)

for migration in "${MIGRATIONS[@]}"; do
    if [ -f "$MIGRATIONS_DIR/$migration" ]; then
        echo "   Applying $migration..."
        PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -f "$MIGRATIONS_DIR/$migration" > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "   ✅ $migration applied"
        else
            echo "   ⚠️  $migration failed (might already be applied)"
        fi
    else
        echo "   ⚠️  $migration not found, skipping..."
    fi
done

# 4. Vérifier les tables créées
echo ""
echo "🔨 Step 4: Verifying tables..."
TABLE_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | xargs)
echo "✅ Found $TABLE_COUNT tables in clinic database"

# 5. Lister les tables
echo ""
echo "📋 Tables in database:"
PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -c "\dt" 2>/dev/null | grep "public" | awk '{print "   • " $3}'

# 6. Résumé
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Provisioning complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Summary:"
echo "   • Clinic: $CLINIC_NAME"
echo "   • Database: $DB_NAME"
echo "   • Tables: $TABLE_COUNT"
echo ""
echo "🔄 Next steps:"
echo "   1. Restart the backend (or it will connect automatically)"
echo "   2. Refresh your browser"
echo "   3. You should now be able to access the application!"
echo ""
