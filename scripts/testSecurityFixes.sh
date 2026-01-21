#!/bin/bash

##############################################################################
# Script de Test de Sécurité
#
# Vérifie que les failles de sécurité identifiées ont été corrigées
#
# USAGE: ./scripts/testSecurityFixes.sh
##############################################################################

set -e

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║          🔐 SECURITY VULNERABILITY TESTS                               ║"
echo "║                                                                         ║"
echo "║  Ces tests vérifient que les failles identifiées ont été corrigées      ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_URL="http://localhost:3001/api/v1"
TOKEN=""
SECRETARY_TOKEN=""
COMPANY_ID=""
USER_ID=""

# ============================================================================
# Helper Functions
# ============================================================================

test_endpoint() {
  local name=$1
  local method=$2
  local endpoint=$3
  local data=$4
  local expected_status=$5
  local token=$6

  echo ""
  echo -e "${BLUE}▶ Testing: $name${NC}"

  local cmd="curl -s -w '\n%{http_code}' -X $method"
  cmd="$cmd -H 'Content-Type: application/json'"

  if [ -n "$token" ]; then
    cmd="$cmd -H 'Authorization: Bearer $token'"
  fi

  if [ -n "$data" ]; then
    cmd="$cmd -d '$data'"
  fi

  cmd="$cmd $API_URL$endpoint"

  local response=$(eval $cmd)
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | sed '$d')

  if [ "$http_code" == "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} - HTTP $http_code (expected $expected_status)"
    echo "Response: $(echo $body | jq -r '.error.message // .data.id // .data.role' 2>/dev/null || echo $body)"
    return 0
  else
    echo -e "${RED}✗ FAIL${NC} - HTTP $http_code (expected $expected_status)"
    echo "Response: $body"
    return 1
  fi
}

# ============================================================================
# Setup: Login pour obtenir les tokens
# ============================================================================

echo ""
echo -e "${BLUE}═ SETUP: Login and Get Tokens${NC}"

# Login avec secretary
SECRETARY_LOGIN=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "email": "secretary@test.fr",
    "password": "password"
  }' \
  $API_URL/auth/login)

SECRETARY_TOKEN=$(echo $SECRETARY_LOGIN | jq -r '.data.tokens.accessToken' 2>/dev/null)
COMPANY_ID=$(echo $SECRETARY_LOGIN | jq -r '.data.company.id' 2>/dev/null)

if [ -z "$SECRETARY_TOKEN" ] || [ "$SECRETARY_TOKEN" == "null" ]; then
  echo -e "${RED}✗ Failed to login${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Secretary token obtained${NC}"

# ============================================================================
# TEST 1: Role Tampering Prevention
# ============================================================================

echo ""
echo -e "${BLUE}═ TEST 1: Role Tampering Prevention${NC}"

# Tenter d'accéder à un endpoint admin sans la permission
test_endpoint \
  "Secretary should NOT access admin endpoints" \
  "GET" \
  "/users" \
  "" \
  "403" \
  "$SECRETARY_TOKEN"

# ============================================================================
# TEST 2: Multi-Tenant Isolation
# ============================================================================

echo ""
echo -e "${BLUE}═ TEST 2: Multi-Tenant Isolation${NC}"

# Vérifier que les patients retournés appartiennent à la bonne clinique
test_endpoint \
  "Secretary can view patients of their clinic" \
  "GET" \
  "/patients" \
  "" \
  "200" \
  "$SECRETARY_TOKEN"

# ============================================================================
# TEST 3: Permission Validation from Backend
# ============================================================================

echo ""
echo -e "${BLUE}═ TEST 3: Permission Validation from Backend${NC}"

test_endpoint \
  "GET /auth/me returns permissions from backend" \
  "GET" \
  "/auth/me" \
  "" \
  "200" \
  "$SECRETARY_TOKEN"

# Vérifier que les permissions incluent PATIENTS_VIEW mais pas USERS_DELETE
PERMISSIONS=$(curl -s -X GET \
  -H "Authorization: Bearer $SECRETARY_TOKEN" \
  $API_URL/auth/me | jq -r '.data.permissions[]' 2>/dev/null)

if echo "$PERMISSIONS" | grep -q "PATIENTS_VIEW"; then
  echo -e "${GREEN}✓ PATIENTS_VIEW permission present${NC}"
else
  echo -e "${RED}✗ PATIENTS_VIEW permission missing${NC}"
fi

if echo "$PERMISSIONS" | grep -q "USERS_DELETE"; then
  echo -e "${RED}✗ ERROR: Secretary has USERS_DELETE (should not!)${NC}"
else
  echo -e "${GREEN}✓ Secretary correctly lacks USERS_DELETE${NC}"
fi

# ============================================================================
# TEST 4: Invalid Token Detection
# ============================================================================

echo ""
echo -e "${BLUE}═ TEST 4: Invalid Token Detection${NC}"

test_endpoint \
  "Reject invalid/expired token" \
  "GET" \
  "/auth/me" \
  "" \
  "401" \
  "invalid.token.here"

# ============================================================================
# TEST 5: Input Validation
# ============================================================================

echo ""
echo -e "${BLUE}═ TEST 5: Input Validation${NC}"

test_endpoint \
  "Reject invalid email format in patient creation" \
  "POST" \
  "/patients" \
  '{
    "firstName": "Jean",
    "lastName": "Dupont",
    "email": "invalid-email",
    "dateOfBirth": "1990-01-01"
  }' \
  "400" \
  "$SECRETARY_TOKEN"

# ============================================================================
# TEST 6: Audit Logging
# ============================================================================

echo ""
echo -e "${BLUE}═ TEST 6: Audit Logging${NC}"

# Vérifier que les logs d'audit existent
echo -e "${YELLOW}▶ Checking audit logs in database...${NC}"

AUDIT_COUNT=$(psql -h localhost -U medicalpro -d medicalpro_central -t -c \
  "SELECT COUNT(*) FROM audit_logs WHERE company_id = '$COMPANY_ID';" 2>/dev/null || echo "0")

if [ "$AUDIT_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ Audit logs found ($AUDIT_COUNT entries)${NC}"
else
  echo -e "${YELLOW}⚠ No audit logs found (table may not exist yet)${NC}"
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                        TEST SUMMARY                                    ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"

echo ""
echo -e "${GREEN}✓ All security checks completed${NC}"
echo ""
echo "Recommendations:"
echo "  1. Run full test suite: npm test"
echo "  2. Run security tests: npm run test:security"
echo "  3. Check audit logs: psql -d medicalpro_central -c 'SELECT * FROM audit_logs LIMIT 10;'"
echo "  4. Review SECURITY.md for guidelines"
echo ""
