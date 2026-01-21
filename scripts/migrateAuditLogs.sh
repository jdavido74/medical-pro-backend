#!/bin/bash

##############################################################################
# Migration Script: Frontend localStorage → Backend audit_logs
#
# Corrige la violation critique: logs d'audit en localStorage
#
# USAGE: ./scripts/migrateAuditLogs.sh
##############################################################################

set -e

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║          🔐 AUDIT LOGS MIGRATION - localStorage → Backend              ║"
echo "║                                                                         ║"
echo "║  Migrer les logs d'audit depuis localStorage (DANGEREUX)               ║"
echo "║  vers le backend (SÉCURISÉ ET IMMUABLE)                               ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# ============================================================================
# ÉTAPE 1: Vérifier les fichiers
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 1: Vérification des fichiers${NC}"

log_info "Vérification que les fichiers de migration existent..."

# Vérifier le service frontend
if [ -f "../medical-pro/src/services/auditLogService.js" ]; then
  log_success "Frontend auditLogService créé"
else
  log_error "Frontend auditLogService MANQUANT"
  exit 1
fi

# Vérifier les routes backend
if [ -f "src/routes/audit.js" ]; then
  log_success "Backend audit routes créées"
else
  log_error "Backend audit routes MANQUANTES"
  exit 1
fi

# ============================================================================
# ÉTAPE 2: Identifier les appels logAccess
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 2: Identification des appels logAccess${NC}"

log_info "Recherche de tous les appels .logAccess()..."

LOGACCESS_COUNT=$(grep -r "\.logAccess(" ../medical-pro/src --include="*.js" | wc -l)

if [ "$LOGACCESS_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}⚠  Trouvé $LOGACCESS_COUNT appels à .logAccess()${NC}"
  echo ""
  echo "Appels à remplacer:"
  grep -r "\.logAccess(" ../medical-pro/src --include="*.js" | sed 's/^/  /'
  echo ""
  log_warning "MANUEL: Remplacer les appels logAccess par les fonctions auditLogService"
  echo "  - Voir: /var/www/AUDIT_LOGS_CORRECTION.md pour les détails"
else
  log_success "Aucun appel .logAccess() trouvé (déjà migré?)"
fi

# ============================================================================
# ÉTAPE 3: Vérifier que le backend peut recevoir les logs
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 3: Vérification du backend${NC}"

log_info "Vérification que le backend API est accessible..."

if curl -s http://localhost:3001/health > /dev/null; then
  log_success "Backend API est accessible"
else
  log_warning "Backend API non accessible sur localhost:3001"
  echo "  Assurez-vous que le backend est en cours d'exécution:"
  echo "  npm run dev"
fi

# ============================================================================
# ÉTAPE 4: Créer un script de cleanup
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 4: Création du script de cleanup${NC}"

# Créer le script qui nettoie les vieux logs en localStorage
cat > ../medical-pro/src/utils/cleanupOldAuditLogs.js << 'EOF'
/**
 * Cleanup Script - Supprimer les vieux logs d'audit de localStorage
 *
 * À exécuter une fois après migration vers auditLogService
 */

export function cleanupOldAuditLogs() {
  console.log('[Cleanup] Suppression des vieux logs d\'audit de localStorage...');

  const storageKeys = [
    'medicalPro_patients',
    'medicalPro_medical_records',
    'medicalPro_appointments'
  ];

  let cleanedCount = 0;

  storageKeys.forEach(key => {
    try {
      const dataStr = localStorage.getItem(key);
      if (!dataStr) return;

      const data = JSON.parse(dataStr);
      let hasChanges = false;

      const cleaned = data.map(item => {
        if (item.accessLog) {
          delete item.accessLog;  // Supprimer accessLog
          hasChanges = true;
          cleanedCount++;
        }
        return item;
      });

      if (hasChanges) {
        localStorage.setItem(key, JSON.stringify(cleaned));
        console.log(`[Cleanup] ${key}: ${cleanedCount} entrées nettoyées`);
      }
    } catch (error) {
      console.error(`[Cleanup] Erreur lors du nettoyage de ${key}:`, error);
    }
  });

  console.log(`[Cleanup] Terminé - ${cleanedCount} vieux logs supprimés`);
  return cleanedCount;
}

// Auto-run on import
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    cleanupOldAuditLogs();
  });
}
EOF

log_success "Script cleanup créé: src/utils/cleanupOldAuditLogs.js"

# ============================================================================
# ÉTAPE 5: Vérifier la table audit_logs
# ============================================================================

echo ""
echo -e "${BLUE}═ ÉTAPE 5: Vérification de la table audit_logs${NC}"

log_info "Vérification que la table audit_logs existe..."

if command -v psql &> /dev/null; then
  TABLE_EXISTS=$(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='audit_logs';" 2>/dev/null || echo "0")

  if [ "$TABLE_EXISTS" -gt 0 ]; then
    log_success "Table audit_logs existe"

    # Vérifier le nombre d'entrées
    LOG_COUNT=$(PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -t -c \
      "SELECT COUNT(*) FROM audit_logs;" 2>/dev/null || echo "0")

    echo "  Nombre d'entrées: $LOG_COUNT"
  else
    log_warning "Table audit_logs non trouvée"
    echo "  Avez-vous exécuté la migration BD?"
    echo "  ./scripts/deploySecurityFixes.sh"
  fi
else
  log_warning "PostgreSQL client (psql) non installé"
  echo "  Impossible de vérifier la table audit_logs"
fi

# ============================================================================
# ÉTAPE 6: Résumé et checklist
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                       MIGRATION CHECKLIST                              ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"

echo ""
echo "✅ Fichiers créés:"
echo "   - /var/www/medical-pro/src/services/auditLogService.js"
echo "   - /var/www/medical-pro-backend/src/routes/audit.js"
echo ""

echo "📋 À FAIRE MANUELLEMENT:"
echo "   1. Remplacer les appels .logAccess():"
echo "      - patientsStorage.logAccess() → logPatientView()"
echo "      - medicalRecordsStorage.logAccess() → logMedicalRecordView()"
echo "      - appointmentsStorage.logAccess() → logAppointmentView()"
echo ""
echo "   2. Fichiers à modifier:"
if [ "$LOGACCESS_COUNT" -gt 0 ]; then
  grep -r "\.logAccess(" ../medical-pro/src --include="*.js" | cut -d: -f1 | sort | uniq | sed 's/^/      - /'
else
  echo "      (Aucun - déjà migré)"
fi
echo ""
echo "   3. Exécuter le cleanup:"
echo "      - Importer: import { cleanupOldAuditLogs } from './utils/cleanupOldAuditLogs';"
echo "      - Appeler: cleanupOldAuditLogs();"
echo ""
echo "   4. Tester:"
echo "      - Vérifier les logs au backend: /audit/logs"
echo "      - Vérifier qu'il n'y a plus d'accessLog en localStorage"
echo ""

echo "📚 Documentation:"
echo "   - /var/www/AUDIT_LOGS_CORRECTION.md"
echo ""

echo -e "${GREEN}✅ Migration préparée - Suivez la checklist ci-dessus${NC}"
