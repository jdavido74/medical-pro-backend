#!/bin/bash

# Script pour provisionner la base de données clinic pour "Ozon A"

CLINIC_ID="26be0b97-889d-4a4d-bab8-3ae36261ed65"
DB_NAME="medicalpro_clinic_${CLINIC_ID}"
DB_USER="medicalpro"
DB_PASSWORD="medicalpro2024"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏥 Provisioning Clinic Database: Ozon A"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Clinic ID: $CLINIC_ID"
echo "📋 Database: $DB_NAME"
echo ""

# 1. Créer la base de données
echo "🔨 Step 1: Creating database..."
PGPASSWORD=$DB_PASSWORD createdb -h localhost -U $DB_USER $DB_NAME

if [ $? -eq 0 ]; then
    echo "✅ Database created successfully"
else
    echo "⚠️  Database might already exist or creation failed"
fi

# 2. Appliquer le schéma clinic
echo ""
echo "🔨 Step 2: Applying clinic schema..."

if [ -f "/var/www/medical-pro-backend/migrations/clinic_001_initial_schema.sql" ]; then
    PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -f /var/www/medical-pro-backend/migrations/clinic_001_initial_schema.sql
    echo "✅ Clinic schema applied"
else
    echo "⚠️  Clinic schema file not found, skipping..."
fi

# 3. Vérifier les tables créées
echo ""
echo "🔨 Step 3: Verifying tables..."
TABLE_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "✅ Found $TABLE_COUNT tables in clinic database"

# 4. Résumé
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Provisioning complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Summary:"
echo "   • Database: $DB_NAME"
echo "   • Tables: $TABLE_COUNT"
echo ""
echo "🔄 Next step: Restart the backend and refresh your browser!"
echo ""
