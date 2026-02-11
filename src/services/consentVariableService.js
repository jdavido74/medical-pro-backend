/**
 * Consent Variable Substitution Service
 *
 * Replaces [VARIABLE] placeholders in consent templates with actual patient,
 * practitioner, and facility data. Used when creating signing requests so
 * patients see their real information instead of raw placeholders.
 *
 * Backend port of frontend consentVariableMapper.js, adapted for:
 * - snake_case DB field names
 * - Intl.DateTimeFormat (no i18n dependency)
 * - Node.js runtime
 */

const { logger } = require('../utils/logger');

// Locale map for date formatting
const LOCALE_MAP = {
  fr: 'fr-FR',
  es: 'es-ES',
  en: 'en-GB',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT'
};

function getLocale(language) {
  return LOCALE_MAP[language] || 'fr-FR';
}

// ── Formatting helpers ──────────────────────────────────────────────

function formatDate(date, language) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  return date.toLocaleDateString(getLocale(language));
}

function formatLongDate(date, language) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  return date.toLocaleDateString(getLocale(language), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatTime(date, language) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  return date.toLocaleTimeString(getLocale(language), {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateTime(date, language) {
  if (!date) return '';
  const connector = language === 'en' ? ' at ' : language === 'es' ? ' a las ' : ' à ';
  return `${formatDate(date, language)}${connector}${formatTime(date, language)}`;
}

function calculateAge(birthDate) {
  if (!birthDate) return '';
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return `${age}`;
}

function getGenderText(gender, language) {
  const genderMaps = {
    fr: { male: 'Masculin', female: 'Féminin', other: 'Autre' },
    es: { male: 'Masculino', female: 'Femenino', other: 'Otro' },
    en: { male: 'Male', female: 'Female', other: 'Other' }
  };
  const map = genderMaps[language] || genderMaps.fr;
  return map[gender] || '';
}

function getPractitionerTitle(role) {
  const titleMap = {
    physician: 'Dr.',
    doctor: 'Dr.',
    specialist: 'Dr.',
    practitioner: 'Dr.',
    nurse: 'Infirmier(ère)',
    secretary: 'Secrétaire médical(e)'
  };
  return titleMap[role] || 'Dr.';
}

function formatAddress(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;

  const parts = [];
  if (address.street) parts.push(address.street);
  if (address.city && address.postal_code) {
    parts.push(`${address.postal_code} ${address.city}`);
  } else if (address.city) {
    parts.push(address.city);
  }
  if (address.country) parts.push(address.country);

  return parts.join(', ');
}

function generateConsentNumber() {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const time = now.getTime().toString().slice(-4);
  return `CNS${year}${month}${day}${time}`;
}

// ── Main substitution function ──────────────────────────────────────

/**
 * Replace [VARIABLE] placeholders in template content with actual data
 *
 * @param {string} templateContent - Text with [VARIABLE] placeholders
 * @param {object} params
 * @param {object} params.patient - Patient record (snake_case DB fields)
 * @param {object} [params.practitioner] - Healthcare provider record
 * @param {object} [params.facility] - Medical facility record
 * @param {object} [params.additionalData] - Extra context (procedure info, etc.)
 * @param {string} [params.language='fr'] - Language code for formatting
 * @returns {string} Content with variables substituted
 */
function fillTemplateVariables(templateContent, { patient, practitioner, facility, additionalData = {}, language = 'fr' }) {
  if (!templateContent) return '';

  const currentDate = new Date();

  // Build patient address object from DB fields
  const patientAddress = patient?.address || {
    street: patient?.street || patient?.address_line1,
    city: patient?.city,
    postal_code: patient?.postal_code || patient?.zip_code,
    country: patient?.country
  };

  // Build variable map (DB fields are snake_case)
  const variableMap = {
    // Patient variables
    'NOM_PATIENT': patient?.last_name || '[NOM_PATIENT]',
    'PRÉNOM_PATIENT': patient?.first_name || '[PRÉNOM_PATIENT]',
    'PRENOM_PATIENT': patient?.first_name || '[PRÉNOM_PATIENT]',
    'DATE_NAISSANCE': patient?.birth_date ? formatDate(patient.birth_date, language) : '[DATE_NAISSANCE]',
    'AGE_PATIENT': patient?.birth_date ? calculateAge(patient.birth_date) : '[AGE_PATIENT]',
    'SEXE_PATIENT': getGenderText(patient?.gender, language) || '[SEXE_PATIENT]',
    'NUMERO_PATIENT': patient?.patient_number || patient?.id?.substring(0, 8) || '[NUMERO_PATIENT]',
    'EMAIL_PATIENT': patient?.email || '[EMAIL_PATIENT]',
    'TELEPHONE_PATIENT': patient?.phone || '[TELEPHONE_PATIENT]',
    'ADRESSE_PATIENT': formatAddress(patientAddress) || '[ADRESSE_PATIENT]',
    'NATIONALITE_PATIENT': patient?.nationality || '[NATIONALITE_PATIENT]',
    'NUMERO_ID_PATIENT': patient?.id_number || patient?.national_id || patient?.social_security_number || '[NUMERO_ID_PATIENT]',

    // Insurance
    'ASSURANCE_PATIENT': patient?.insurance_provider || '[ASSURANCE_PATIENT]',
    'NUMERO_ASSURANCE': patient?.insurance_number || '[NUMERO_ASSURANCE]',
    'TYPE_ASSURANCE': patient?.insurance_type || '[TYPE_ASSURANCE]',

    // Emergency contact
    'CONTACT_URGENCE_NOM': patient?.emergency_contact_name || '[CONTACT_URGENCE_NOM]',
    'CONTACT_URGENCE_TELEPHONE': patient?.emergency_contact_phone || '[CONTACT_URGENCE_TELEPHONE]',
    'CONTACT_URGENCE_RELATION': patient?.emergency_contact_relationship || '[CONTACT_URGENCE_RELATION]',

    // Practitioner variables
    'NOM_PRATICIEN': practitioner?.last_name || '[NOM_PRATICIEN]',
    'PRÉNOM_PRATICIEN': practitioner?.first_name || '[PRÉNOM_PRATICIEN]',
    'PRENOM_PRATICIEN': practitioner?.first_name || '[PRÉNOM_PRATICIEN]',
    'TITRE_PRATICIEN': getPractitionerTitle(practitioner?.role) || '[TITRE_PRATICIEN]',
    'SPÉCIALITÉ_PRATICIEN': practitioner?.specialty || '[SPÉCIALITÉ_PRATICIEN]',
    'SPECIALITE_PRATICIEN': practitioner?.specialty || '[SPÉCIALITÉ_PRATICIEN]',
    'NUMERO_RPPS': practitioner?.rpps_number || '[NUMERO_RPPS]',
    'NUMERO_ADELI': practitioner?.adeli_number || '[NUMERO_ADELI]',

    // Facility variables
    'ÉTABLISSEMENT': facility?.name || '[ÉTABLISSEMENT]',
    'ETABLISSEMENT': facility?.name || '[ÉTABLISSEMENT]',
    'ADRESSE_ETABLISSEMENT': formatAddress(facility) || '[ADRESSE_ETABLISSEMENT]',
    'TELEPHONE_ETABLISSEMENT': facility?.phone || '[TELEPHONE_ETABLISSEMENT]',

    // Date & time variables
    'DATE': formatDate(currentDate, language),
    'DATE_LONGUE': formatLongDate(currentDate, language),
    'HEURE': formatTime(currentDate, language),
    'DATE_HEURE': formatDateTime(currentDate, language),
    'ANNEE': currentDate.getFullYear().toString(),
    'MOIS': (currentDate.getMonth() + 1).toString().padStart(2, '0'),
    'JOUR': currentDate.getDate().toString().padStart(2, '0'),

    // Procedure variables
    'DESCRIPTION_INTERVENTION': additionalData.procedureDescription || '[DESCRIPTION_INTERVENTION]',
    'TYPE_INTERVENTION': additionalData.procedureType || '[TYPE_INTERVENTION]',
    'DUREE_INTERVENTION': additionalData.procedureDuration || '[DUREE_INTERVENTION]',
    'LIEU_INTERVENTION': additionalData.procedureLocation || '[LIEU_INTERVENTION]',
    'DATE_INTERVENTION': additionalData.procedureDate ? formatDate(additionalData.procedureDate, language) : '[DATE_INTERVENTION]',

    // Risks & benefits
    'RISQUES_SPÉCIFIQUES': additionalData.specificRisks || '[RISQUES_SPÉCIFIQUES]',
    'RISQUES_SPECIFIQUES': additionalData.specificRisks || '[RISQUES_SPÉCIFIQUES]',
    'BÉNÉFICES_ATTENDUS': additionalData.expectedBenefits || '[BÉNÉFICES_ATTENDUS]',
    'BENEFICES_ATTENDUS': additionalData.expectedBenefits || '[BÉNÉFICES_ATTENDUS]',
    'ALTERNATIVES_DISPONIBLES': additionalData.alternatives || '[ALTERNATIVES_DISPONIBLES]',
    'SUITES_POST_OPÉRATOIRES': additionalData.postOpCare || '[SUITES_POST_OPÉRATOIRES]',
    'SUITES_POST_OPERATOIRES': additionalData.postOpCare || '[SUITES_POST_OPÉRATOIRES]',

    // Signature placeholders
    'SIGNATURE_PATIENT': '................................',
    'SIGNATURE_PRATICIEN': '................................',
    'SIGNATURE_TEMOIN': '................................',

    // Special variables
    'NUMERO_CONSENTEMENT': generateConsentNumber(),
    'LIEU': additionalData.location || facility?.name || '[LIEU]',
    'DUREE': additionalData.duration || '[DUREE]',
    'PLATEFORME': additionalData.platform || '[PLATEFORME]'
  };

  // Replace all [VARIABLE] placeholders
  let filledContent = templateContent;
  for (const [variable, value] of Object.entries(variableMap)) {
    const regex = new RegExp(`\\[${variable}\\]`, 'g');
    filledContent = filledContent.replace(regex, value);
  }

  return filledContent;
}

module.exports = {
  fillTemplateVariables,
  // Export helpers for testing
  formatDate,
  formatLongDate,
  formatTime,
  calculateAge,
  getGenderText,
  formatAddress,
  generateConsentNumber
};
