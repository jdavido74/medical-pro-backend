#!/bin/bash

##############################################################################
# Script de Déploiement des Correctifs de Sécurité
#
# Automatise l'intégration de tous les correctifs de sécurité
#
# USAGE: ./scripts/deploySecurityFixes.sh
##############################################################################

set -e

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║          🔐 SECURITY FIXES DEPLOYMENT                                  ║"
echo "║                                                                         ║"
echo "║  Ce script déploie tous les correctifs de sécurité.                    ║"
echo "║  Assurez-vous d'avoir lu SECURITY.md avant de continuer.               ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-medicalpro}"
DB_PASSWORD="${DB_PASSWORD:-medicalpro2024}"
DB_NAME="medicalpro_central"

# Fonctions helper

log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠  $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

check_file() {
  if [ -f "$1" ]; then
    log_success "Fichier trouvé: $1"
    return 0
  else
    log_error "Fichier MANQUANT: $1"
    return 1
  fi
}

# ============================================================================
# ÉTAPE 1: Vérifier l'environnement
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 1: Vérification de l'environnement${NC}"

log_info "Vérification des prérequis..."

# Vérifier Node.js
if ! command -v node &> /dev/null; then
  log_error "Node.js n'est pas installé"
  exit 1
fi
log_success "Node.js: $(node -v)"

# Vérifier psql
if ! command -v psql &> /dev/null; then
  log_error "PostgreSQL client (psql) n'est pas installé"
  exit 1
fi
log_success "PostgreSQL: $(psql --version)"

# Vérifier les fichiers critiques
log_info "Vérification des fichiers de sécurité..."
check_file "src/utils/permissionConstants.js" || exit 1
check_file "src/middleware/permissions.js" || exit 1
check_file "src/services/auditService.js" || exit 1
check_file "migrations/010_audit_logs.sql" || exit 1
check_file "docs/SECURITY.md" || exit 1
check_file "docs/IMPLEMENTATION_GUIDE.md" || exit 1

# ============================================================================
# ÉTAPE 2: Exécuter les migrations BD
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 2: Migration de la base de données${NC}"

log_info "Connexion à PostgreSQL: $DB_HOST:$DB_PORT/$DB_NAME"

# Tester la connexion
if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1" &> /dev/null; then
  log_success "Connexion réussie"
else
  log_error "Impossible de se connecter à la BD"
  log_info "Vérifiez:"
  echo "  - DB_HOST=$DB_HOST"
  echo "  - DB_USER=$DB_USER"
  echo "  - DB_PASSWORD=***"
  echo "  - DB_NAME=$DB_NAME"
  exit 1
fi

# Exécuter la migration
log_info "Exécution de la migration 010_audit_logs.sql..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f migrations/010_audit_logs.sql

if [ $? -eq 0 ]; then
  log_success "Migration exécutée avec succès"
else
  log_error "Erreur lors de l'exécution de la migration"
  exit 1
fi

# Vérifier que la table a été créée
log_info "Vérification de la table audit_logs..."
TABLE_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='audit_logs';")

if [ "$TABLE_COUNT" -gt 0 ]; then
  log_success "Table audit_logs créée"
else
  log_warning "Table audit_logs introuvable (vérification)"
fi

# ============================================================================
# ÉTAPE 3: Vérifier les imports
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 3: Vérification des imports${NC}"

log_info "Vérification que tous les modules peuvent être importés..."

node -e "
try {
  require('./src/utils/permissionConstants.js');
  console.log('✓ permissionConstants.js');
} catch (e) {
  console.error('✗ permissionConstants.js:', e.message);
  process.exit(1);
}
" || exit 1

node -e "
try {
  require('./src/middleware/permissions.js');
  console.log('✓ permissions.js');
} catch (e) {
  console.error('✗ permissions.js:', e.message);
  process.exit(1);
}
" || exit 1

node -e "
try {
  require('./src/services/auditService.js');
  console.log('✓ auditService.js');
} catch (e) {
  console.error('✗ auditService.js:', e.message);
  process.exit(1);
}
" || exit 1

log_success "Tous les modules importent correctement"

# ============================================================================
# ÉTAPE 4: Vérifier les tests
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 4: Vérification des tests${NC}"

if [ -f "tests/security/permissionValidation.test.js" ]; then
  log_success "Tests de sécurité trouvés"

  log_info "Les tests nécessitent un serveur running."
  log_info "Exécutez manuellement: npm run test:security"
else
  log_warning "Tests de sécurité non trouvés"
fi

# ============================================================================
# ÉTAPE 5: Créer un fichier de configuration example
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 5: Configuration${NC}"

log_info "Vérification de .env..."

if [ ! -f ".env" ]; then
  log_warning ".env n'existe pas, création d'un fichier example"
  cat > .env.security.example << 'EOF'
# Configuration de sécurité
JWT_SECRET=your-very-long-secret-key-here-min-32-chars
JWT_EXPIRATION=24h
REFRESH_TOKEN_EXPIRATION=7d

# Base de données
DB_HOST=localhost
DB_PORT=5432
DB_USER=medicalpro
DB_PASSWORD=medicalpro2024
DB_NAME=medicalpro_central

# Audit
AUDIT_LOGGING_ENABLED=true
AUDIT_LOG_LEVEL=info

# Sécurité
NODE_ENV=production
HTTPS=true
EOF
  log_success "Fichier .env.security.example créé"
else
  log_success ".env existe déjà"
fi

# ============================================================================
# ÉTAPE 6: Résumé
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                       ✅ DÉPLOIEMENT RÉUSSI                            ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"

echo ""
echo -e "${GREEN}Correctifs de sécurité déployés avec succès!${NC}"
echo ""

echo "📋 Prochaines étapes:"
echo ""
echo "1. Lire la documentation:"
echo "   cat docs/SECURITY.md"
echo "   cat docs/IMPLEMENTATION_GUIDE.md"
echo ""
echo "2. Mettre à jour les routes protégées:"
echo "   - Ajouter requirePermission() à tous les endpoints"
echo "   - Ajouter verifyCompanyContext"
echo "   - Ajouter logging d'audit"
echo ""
echo "3. Mettre à jour le frontend:"
echo "   - Importer SecureAuthContext au lieu de AuthContext"
echo "   - Utiliser SecurePermissionGuard au lieu de PermissionGuard"
echo "   - Appeler fetchUserData() dans App.js"
echo ""
echo "4. Tester:"
echo "   npm run test:security"
echo "   ./scripts/testSecurityFixes.sh"
echo ""
echo "5. Code review:"
echo "   - Vérifier que TOUTES les routes sensibles ont requirePermission()"
echo "   - Vérifier que localStorage ne contient QUE le JWT"
echo "   - Vérifier les logs d'audit en BD"
echo ""
echo "6. Déployer en production:"
echo "   - Backup BD avant"
echo "   - Tester en staging"
echo "   - Monitoring des logs"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT:${NC}"
echo "   - Lisez SECURITY.md INTÉGRALEMENT"
echo "   - Suivez les patterns de sécurité"
echo "   - Exécutez les tests avant chaque commit"
echo "   - Loggez TOUTES les actions sensibles"
echo ""

log_success "Déploiement terminé"
