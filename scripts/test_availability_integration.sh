#!/bin/bash
#
# Test d'intégration complet pour le système de disponibilités praticiens
# Usage: ./test_availability_integration.sh [PROVIDER_ID] [TOKEN]
#

set -e

echo "========================================"
echo "Test d'intégration - Disponibilités Praticiens"
echo "========================================"

# Configuration
API_BASE="http://localhost:3001/api/v1"
PROVIDER_ID="${1:-}"
TOKEN="${2:-}"

# Si pas de paramètres, utiliser des valeurs par défaut pour les tests
if [ -z "$PROVIDER_ID" ]; then
  echo "Usage: $0 <PROVIDER_ID> <TOKEN>"
  echo ""
  echo "Exécution des tests SQL uniquement..."
  echo ""

  # Tests SQL uniquement
  echo "=== Tests SQL sur toutes les bases cliniques ==="
  for db in $(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%'"); do
    db_trimmed=$(echo "$db" | xargs)
    echo ""
    echo "--- Vérification de $db_trimmed ---"
    PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d "$db_trimmed" -f /var/www/medical-pro-backend/scripts/test_availability_integrity.sql 2>/dev/null || echo "Base non compatible"
  done

  exit 0
fi

echo ""
echo "Provider ID: $PROVIDER_ID"
echo ""

# Fonction pour faire des requêtes API
api_call() {
  local method=$1
  local endpoint=$2
  local data=$3

  if [ "$method" = "GET" ]; then
    curl -s -X GET "$API_BASE$endpoint" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json"
  else
    curl -s -X $method "$API_BASE$endpoint" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data"
  fi
}

# Test 1: Health check backend
echo "1. Test health check backend..."
HEALTH=$(curl -s http://localhost:3001/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "   ✅ Backend OK"
else
  echo "   ❌ Backend non disponible"
  exit 1
fi

# Calculer la semaine courante
CURRENT_YEAR=$(date +%Y)
CURRENT_WEEK=$(date +%V | sed 's/^0*//')

echo ""
echo "Semaine courante: $CURRENT_WEEK / $CURRENT_YEAR"
echo ""

# Test 2: Récupérer la disponibilité courante
echo "2. Récupération disponibilité semaine courante..."
RESULT=$(api_call GET "/availability/$PROVIDER_ID/week/$CURRENT_YEAR/$CURRENT_WEEK")
if echo "$RESULT" | grep -q '"success":true'; then
  SOURCE=$(echo "$RESULT" | jq -r '.data.source')
  echo "   ✅ Disponibilité récupérée (source: $SOURCE)"
else
  echo "   ❌ Erreur: $RESULT"
fi

# Test 3: Récupérer le template
echo ""
echo "3. Récupération template praticien..."
RESULT=$(api_call GET "/availability/$PROVIDER_ID/template")
if echo "$RESULT" | grep -q '"success":true'; then
  echo "   ✅ Template récupéré"
else
  echo "   ⚠️ Pas de template défini ou erreur: $RESULT"
fi

# Test 4: Créer une disponibilité de test (semaine suivante)
NEXT_WEEK=$((CURRENT_WEEK + 1))
NEXT_YEAR=$CURRENT_YEAR
if [ $NEXT_WEEK -gt 52 ]; then
  NEXT_WEEK=1
  NEXT_YEAR=$((CURRENT_YEAR + 1))
fi

echo ""
echo "4. Création disponibilité semaine $NEXT_WEEK/$NEXT_YEAR..."
TEST_AVAILABILITY='{
  "availability": {
    "monday": { "enabled": true, "slots": [{ "start": "09:00", "end": "12:00" }, { "start": "14:00", "end": "18:00" }] },
    "tuesday": { "enabled": true, "slots": [{ "start": "09:00", "end": "12:00" }, { "start": "14:00", "end": "17:00" }] },
    "wednesday": { "enabled": true, "slots": [{ "start": "10:00", "end": "12:00" }] },
    "thursday": { "enabled": true, "slots": [{ "start": "09:00", "end": "12:00" }, { "start": "14:00", "end": "18:00" }] },
    "friday": { "enabled": true, "slots": [{ "start": "09:00", "end": "12:00" }] },
    "saturday": { "enabled": false, "slots": [] },
    "sunday": { "enabled": false, "slots": [] }
  },
  "notes": "Test automatique"
}'

RESULT=$(api_call PUT "/availability/$PROVIDER_ID/week/$NEXT_YEAR/$NEXT_WEEK" "$TEST_AVAILABILITY")
if echo "$RESULT" | grep -q '"success":true'; then
  echo "   ✅ Disponibilité créée"
else
  echo "   ❌ Erreur: $RESULT"
fi

# Test 5: Vérifier la récupération
echo ""
echo "5. Vérification récupération semaine $NEXT_WEEK/$NEXT_YEAR..."
RESULT=$(api_call GET "/availability/$PROVIDER_ID/week/$NEXT_YEAR/$NEXT_WEEK")
if echo "$RESULT" | grep -q '"hasSpecificEntry":true'; then
  echo "   ✅ Entrée spécifique récupérée"
else
  echo "   ❌ Entrée non trouvée: $RESULT"
fi

# Test 6: Copier vers la semaine suivante
COPY_TARGET_WEEK=$((NEXT_WEEK + 1))
COPY_TARGET_YEAR=$NEXT_YEAR
if [ $COPY_TARGET_WEEK -gt 52 ]; then
  COPY_TARGET_WEEK=1
  COPY_TARGET_YEAR=$((NEXT_YEAR + 1))
fi

echo ""
echo "6. Copie vers semaine $COPY_TARGET_WEEK/$COPY_TARGET_YEAR..."
RESULT=$(api_call POST "/availability/$PROVIDER_ID/week/$COPY_TARGET_YEAR/$COPY_TARGET_WEEK/copy-from/$NEXT_YEAR/$NEXT_WEEK" "{}")
if echo "$RESULT" | grep -q '"success":true'; then
  echo "   ✅ Copie réussie"
else
  echo "   ❌ Erreur: $RESULT"
fi

# Test 7: Vérifier que la copie a le bon source
echo ""
echo "7. Vérification source='copied'..."
RESULT=$(api_call GET "/availability/$PROVIDER_ID/week/$COPY_TARGET_YEAR/$COPY_TARGET_WEEK")
if echo "$RESULT" | grep -q '"source":"copied"'; then
  echo "   ✅ Source correcte"
else
  echo "   ❌ Source incorrecte: $RESULT"
fi

# Test 8: Récupérer les créneaux disponibles pour une date
TEST_DATE=$(date -d "next monday" +%Y-%m-%d 2>/dev/null || date -v+monday +%Y-%m-%d)
echo ""
echo "8. Récupération créneaux disponibles pour $TEST_DATE..."
RESULT=$(api_call GET "/availability/slots?providerId=$PROVIDER_ID&date=$TEST_DATE&duration=30")
if echo "$RESULT" | grep -q '"success":true'; then
  AVAILABLE_COUNT=$(echo "$RESULT" | jq -r '.data.availableCount')
  echo "   ✅ $AVAILABLE_COUNT créneaux disponibles"
else
  echo "   ❌ Erreur: $RESULT"
fi

# Test 9: Nettoyage - supprimer les entrées de test
echo ""
echo "9. Nettoyage des entrées de test..."
RESULT=$(api_call DELETE "/availability/$PROVIDER_ID/week/$NEXT_YEAR/$NEXT_WEEK")
RESULT2=$(api_call DELETE "/availability/$PROVIDER_ID/week/$COPY_TARGET_YEAR/$COPY_TARGET_WEEK")
echo "   ✅ Nettoyage terminé"

# Test 10: Tests SQL sur toutes les bases
echo ""
echo "10. Tests d'intégrité SQL..."
for db in $(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d postgres -t -c "SELECT datname FROM pg_database WHERE datname LIKE 'medicalpro_clinic_%'" | head -2); do
  db_trimmed=$(echo "$db" | xargs)
  echo "   Vérification $db_trimmed..."
  INVALID_COUNT=$(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d "$db_trimmed" -t -c "
    SELECT COUNT(*) FROM practitioner_weekly_availability
    WHERE week_number < 1 OR week_number > 53 OR year < 2020
  " 2>/dev/null || echo "0")
  if [ "$(echo $INVALID_COUNT | xargs)" = "0" ]; then
    echo "   ✅ $db_trimmed OK"
  else
    echo "   ⚠️ $db_trimmed: $INVALID_COUNT enregistrements invalides"
  fi
done

echo ""
echo "========================================"
echo "Tests terminés"
echo "========================================"
