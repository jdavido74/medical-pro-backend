# Spécification - Champs Obligatoires Patient

**Date**: 2025-12-06
**Statut**: 📋 Spécification validée par l'utilisateur

---

## ✅ CHAMPS OBLIGATOIRES

### Création de Patient - Minimum Requis

| Champ | Type | Validation | Raison |
|-------|------|------------|--------|
| **first_name** | string | 2-100 chars | Identification |
| **last_name** | string | 2-100 chars | Identification |
| **birth_date** | date | ISO, <= today | Dossier médical |
| **email** | string | Format email valide | Contact et notifications |
| **phone** | string | Avec indicatif pays | Contact urgent |

**Total**: 5 champs obligatoires

---

## 🌍 GESTION TÉLÉPHONE PAR PAYS

### Principe

Le numéro de téléphone doit inclure l'**indicatif pays** pour valider correctement le nombre de chiffres.

**Exemples**:
```javascript
// Espagne: +34 + 9 chiffres
"+34612345678"  // ✅ Valide (9 chiffres après +34)

// France: +33 + 9 chiffres
"+33612345678"  // ✅ Valide (9 chiffres après +33)

// Royaume-Uni: +44 + 10 chiffres
"+447123456789"  // ✅ Valide (10 chiffres après +44)
```

### Validation Intelligente

```javascript
const phoneValidationByCountry = {
  'ES': { prefix: '+34', digits: 9 },   // Espagne
  'FR': { prefix: '+33', digits: 9 },   // France
  'GB': { prefix: '+44', digits: 10 },  // Royaume-Uni
  'DE': { prefix: '+49', digits: 10-11 }, // Allemagne (variable)
  'IT': { prefix: '+39', digits: 10 },  // Italie
  'PT': { prefix: '+351', digits: 9 },  // Portugal
  // ... autres pays
};

// Validation:
// 1. Détecter le prefix (+34, +33, etc.)
// 2. Valider le nombre de chiffres selon le pays
// 3. Accepter format avec espaces/tirets: +34 612 34 56 78
```

---

## 🗺️ SELECT PAYS

### Frontend - Remplacement du champ texte

**AVANT** (input texte):
```html
<input type="text" value={formData.address.country} />
```

**APRÈS** (select dropdown):
```html
<select value={formData.address.country}>
  <option value="">Seleccionar país</option>
  <option value="ES">🇪🇸 España</option>
  <option value="FR">🇫🇷 France</option>
  <option value="GB">🇬🇧 United Kingdom</option>
  <option value="DE">🇩🇪 Deutschland</option>
  <option value="IT">🇮🇹 Italia</option>
  <option value="PT">🇵🇹 Portugal</option>
  <!-- ... -->
</select>
```

### Aide à la Saisie Téléphone

Afficher l'indicatif automatiquement selon le pays sélectionné:

```javascript
// Si pays = ES sélectionné
<input
  type="tel"
  placeholder="+34 612 34 56 78"
  value={formData.contact.phone}
/>

// Validation en temps réel:
// Si commence par +34 → Valider 9 chiffres
// Si commence par +33 → Valider 9 chiffres
```

---

## ❌ CHAMPS OPTIONNELS

Tous les autres champs deviennent **optionnels**:

### Identité (Optionnel)
- `gender` - Sexe
- `idNumber` / `social_security_number` - Numéro document
- `nationality` - Nationalité
- `patient_number` - Numéro patient (auto-généré)

### Adresse (Optionnel)
- `address_line1` - Rue
- `address_line2` - Complément
- `city` - Ville
- `postal_code` - Code postal
- `country` - Pays (code ISO 2 lettres)

### Contact Urgence (Optionnel)
- `emergency_contact_name`
- `emergency_contact_phone`
- `emergency_contact_relationship`

### Assurance (Optionnel)
- `insurance_provider`
- `insurance_number`
- `mutual_insurance`
- `mutual_number`

### Médical (Optionnel)
- `blood_type`
- `allergies`
- `chronic_conditions`
- `current_medications`

---

## 🌍 CONFIGURATION PAR PAYS

### Champs Spécifiques selon Pays

**Principe**: Certains champs sont obligatoires ou ont des validations spécifiques selon le pays.

#### Espagne (ES)
```javascript
{
  country: 'ES',
  requiredFields: {
    idNumber: {
      name: 'DNI/NIE',
      pattern: /^[0-9]{8}[A-Z]$/,  // DNI: 8 chiffres + lettre
      // OU
      pattern: /^[XYZ][0-9]{7}[A-Z]$/  // NIE: X/Y/Z + 7 chiffres + lettre
    }
  },
  phone: {
    prefix: '+34',
    digits: 9,
    format: 'XXX XX XX XX'
  }
}
```

#### France (FR)
```javascript
{
  country: 'FR',
  requiredFields: {
    socialSecurityNumber: {
      name: 'Numéro de Sécurité Sociale',
      pattern: /^[12][0-9]{2}(0[1-9]|1[0-2])[0-9]{8}$/,  // 15 chiffres
      format: 'X XX XX XX XXX XXX XX'
    }
  },
  phone: {
    prefix: '+33',
    digits: 9,
    format: 'X XX XX XX XX'
  }
}
```

#### Royaume-Uni (GB)
```javascript
{
  country: 'GB',
  requiredFields: {
    nhsNumber: {
      name: 'NHS Number',
      pattern: /^[0-9]{10}$/,  // 10 chiffres
      format: 'XXX XXX XXXX'
    }
  },
  phone: {
    prefix: '+44',
    digits: 10,
    format: 'XXXX XXX XXX'
  }
}
```

### Implémentation Configuration

**Fichier**: `/var/www/medical-pro-backend/src/config/countryConfig.js`

```javascript
const countryConfigurations = {
  ES: {
    name: 'España',
    phonePrefix: '+34',
    phoneDigits: 9,
    phoneFormat: 'XXX XX XX XX',
    requiredDocuments: [
      {
        field: 'id_number',
        name: 'DNI/NIE',
        pattern: /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/,
        message: 'DNI debe ser 8 dígitos + letra o NIE X/Y/Z + 7 dígitos + letra'
      }
    ]
  },
  FR: {
    name: 'France',
    phonePrefix: '+33',
    phoneDigits: 9,
    phoneFormat: 'X XX XX XX XX',
    requiredDocuments: [
      {
        field: 'social_security_number',
        name: 'Numéro de Sécurité Sociale',
        pattern: /^[12][0-9]{14}$/,
        message: 'Numéro de sécurité sociale doit être 15 chiffres'
      }
    ]
  },
  // ... autres pays
};

module.exports = {
  countryConfigurations,
  getCountryConfig: (countryCode) => countryConfigurations[countryCode] || null,
  validatePhone: (phone, countryCode) => {
    const config = countryConfigurations[countryCode];
    if (!config) return true; // Pays inconnu = validation générique

    // Extraire les chiffres
    const digits = phone.replace(/[^0-9]/g, '');
    const expectedPrefix = config.phonePrefix.replace('+', '');

    // Vérifier prefix + nombre de chiffres
    return digits.startsWith(expectedPrefix) &&
           digits.length === expectedPrefix.length + config.phoneDigits;
  }
};
```

---

## 🔧 MODIFICATIONS À APPLIQUER

### 1. Backend - validationSchemas.js

**Rendre email et phone OBLIGATOIRES**:

```javascript
module.exports.createPatientSchema = Joi.object({
  // OBLIGATOIRES
  first_name: atomicSchemas.firstName.required(),
  last_name: atomicSchemas.lastName.required(),
  birth_date: Joi.date().iso().max('now').required(),  // ✅ Ajout .required()
  email: atomicSchemas.email.required(),               // ✅ Ajout .required()
  phone: atomicSchemas.phone.required(),               // ✅ Ajout .required()

  // OPTIONNELS
  facility_id: Joi.string().uuid().optional(),
  gender: atomicSchemas.gender,
  social_security_number: Joi.string().max(50).optional(),  // ✅ Pattern retiré (spécifique pays)
  id_number: Joi.string().max(50).optional(),  // ✅ Ajouté pour DNI/NIE/etc
  patient_number: atomicSchemas.patientNumber,
  nationality: Joi.string().max(100).optional(),

  // Adresse - tous optionnels
  address_line1: Joi.string().optional(),
  address_line2: Joi.string().optional(),
  postal_code: Joi.string().optional(),
  city: Joi.string().optional(),
  country: Joi.string().length(2).optional(),  // ISO 2 lettres

  // Contact urgence - optionnel
  emergency_contact_name: Joi.string().optional(),
  emergency_contact_phone: Joi.string().optional(),
  emergency_contact_relationship: Joi.string().optional(),

  // Assurance - optionnel
  insurance_provider: Joi.string().optional(),
  insurance_number: Joi.string().optional(),

  // Médical - optionnel
  blood_type: Joi.string().optional(),
  allergies: Joi.string().optional(),
  chronic_conditions: Joi.string().optional(),
  current_medications: Joi.string().optional(),

  notes: atomicSchemas.notes
});
```

---

### 2. Frontend - PatientFormModal.js

**Validation mise à jour**:

```javascript
const validateForm = () => {
  const newErrors = {};

  // OBLIGATOIRES
  if (!formData.firstName.trim()) {
    newErrors.firstName = t('errors.firstNameRequired');
  }
  if (!formData.lastName.trim()) {
    newErrors.lastName = t('errors.lastNameRequired');
  }
  if (!formData.birthDate) {
    newErrors.birthDate = t('errors.birthDateRequired');
  }
  if (!formData.contact.email) {
    newErrors.email = t('errors.emailRequired');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact.email)) {
    newErrors.email = t('errors.emailInvalid');
  }
  if (!formData.contact.phone) {
    newErrors.phone = t('errors.phoneRequired');
  } else {
    // Validation téléphone avec pays
    const phoneError = validatePhoneWithCountry(formData.contact.phone, formData.address.country);
    if (phoneError) {
      newErrors.phone = phoneError;
    }
  }

  // OPTIONNELS - Validation conditionnelle
  if (formData.contact.emergencyContact.name) {
    if (!formData.contact.emergencyContact.phone) {
      newErrors.emergencyPhone = t('errors.emergencyPhoneRequired');
    }
  }

  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
};

// Validation téléphone par pays
const validatePhoneWithCountry = (phone, countryCode) => {
  if (!phone.startsWith('+')) {
    return 'Le téléphone doit commencer par l\'indicatif (+34, +33, etc.)';
  }

  const phoneConfigs = {
    'ES': { prefix: '+34', digits: 9 },
    'FR': { prefix: '+33', digits: 9 },
    'GB': { prefix: '+44', digits: 10 },
    'DE': { prefix: '+49', min: 10, max: 11 },
    'IT': { prefix: '+39', digits: 10 },
  };

  const config = phoneConfigs[countryCode];
  if (!config) {
    // Validation générique si pays inconnu
    return /^[\+]?[0-9\s\-\(\)]{10,20}$/.test(phone)
      ? null
      : 'Format de téléphone invalide';
  }

  const digitsOnly = phone.replace(/[^0-9]/g, '');
  const prefixDigits = config.prefix.replace('+', '');

  if (!digitsOnly.startsWith(prefixDigits)) {
    return `Le téléphone doit commencer par ${config.prefix}`;
  }

  const actualDigits = digitsOnly.substring(prefixDigits.length);

  if (config.digits && actualDigits.length !== config.digits) {
    return `Le téléphone ${config.prefix} doit avoir ${config.digits} chiffres`;
  }

  if (config.min && config.max && (actualDigits.length < config.min || actualDigits.length > config.max)) {
    return `Le téléphone ${config.prefix} doit avoir entre ${config.min} et ${config.max} chiffres`;
  }

  return null;
};
```

**Select Pays**:

```javascript
// Dans le formulaire, remplacer input country par select
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    País
  </label>
  <select
    value={formData.address.country}
    onChange={(e) => handleNestedInputChange('address', 'country', e.target.value)}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
  >
    <option value="">Seleccionar país</option>
    <option value="ES">🇪🇸 España</option>
    <option value="FR">🇫🇷 France</option>
    <option value="GB">🇬🇧 United Kingdom</option>
    <option value="DE">🇩🇪 Deutschland</option>
    <option value="IT">🇮🇹 Italia</option>
    <option value="PT">🇵🇹 Portugal</option>
    <option value="BE">🇧🇪 Belgique</option>
    <option value="NL">🇳🇱 Nederland</option>
    <option value="CH">🇨🇭 Suisse</option>
    <option value="AT">🇦🇹 Österreich</option>
    <option value="IE">🇮🇪 Ireland</option>
    <option value="LU">🇱🇺 Luxembourg</option>
  </select>
</div>
```

**Indicateur pays sur téléphone**:

```javascript
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    Teléfono *
  </label>
  <div className="flex gap-2">
    {formData.address.country && (
      <span className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm">
        {getPhonePrefix(formData.address.country)}
      </span>
    )}
    <input
      type="tel"
      value={formData.contact.phone}
      onChange={(e) => handleNestedInputChange('contact', 'phone', e.target.value)}
      placeholder={getPhonePlaceholder(formData.address.country)}
      className={`flex-1 px-3 py-2 border rounded-lg ${
        errors.phone ? 'border-red-300' : 'border-gray-300'
      }`}
    />
  </div>
  {errors.phone && (
    <p className="text-red-600 text-sm mt-1">{errors.phone}</p>
  )}
</div>

// Helper functions
const getPhonePrefix = (countryCode) => {
  const prefixes = { ES: '+34', FR: '+33', GB: '+44', DE: '+49', IT: '+39' };
  return prefixes[countryCode] || '+';
};

const getPhonePlaceholder = (countryCode) => {
  const formats = {
    ES: '+34 612 34 56 78',
    FR: '+33 6 12 34 56 78',
    GB: '+44 7123 456789',
    DE: '+49 151 12345678',
    IT: '+39 312 3456789'
  };
  return formats[countryCode] || '+XX XXX XXX XXX';
};
```

---

### 3. Database - Patient.js Model

**Mettre à jour les contraintes**:

```javascript
// Email et phone deviennent NOT NULL
email: {
  type: DataTypes.STRING(255),
  allowNull: false,  // ✅ Obligatoire
  validate: { isEmail: true }
},
phone: {
  type: DataTypes.STRING(20),
  allowNull: false  // ✅ Obligatoire
},

// Ajouter id_number générique
id_number: {
  type: DataTypes.STRING(50),
  allowNull: true,
  comment: 'DNI, NIE, Passport, etc. - Format depends on country'
},

// social_security reste optionnel et sans pattern strict
social_security_number: {
  type: DataTypes.STRING(50),  // ✅ Augmenté de 15 à 50
  allowNull: true,
  comment: 'Country-specific format'
}
```

---

## 📋 MIGRATION DATABASE

### Migration SQL à appliquer

```sql
-- 1. Ajouter id_number
ALTER TABLE patients ADD COLUMN IF NOT EXISTS id_number VARCHAR(50);

-- 2. Modifier social_security_number
ALTER TABLE patients ALTER COLUMN social_security_number TYPE VARCHAR(50);

-- 3. Rendre email et phone NOT NULL (ATTENTION: vérifier données existantes!)
-- Vérifier d'abord qu'il n'y a pas de NULL
SELECT COUNT(*) FROM patients WHERE email IS NULL OR phone IS NULL;

-- Si OK, appliquer:
UPDATE patients SET email = 'noemail@example.com' WHERE email IS NULL;
UPDATE patients SET phone = '+00000000000' WHERE phone IS NULL;

ALTER TABLE patients ALTER COLUMN email SET NOT NULL;
ALTER TABLE patients ALTER COLUMN phone SET NOT NULL;

-- 4. Country code ISO 2 lettres
ALTER TABLE patients ALTER COLUMN country TYPE VARCHAR(2);
```

---

## ✅ CHECKLIST IMPLÉMENTATION

### Backend
- [ ] Mettre à jour `validationSchemas.js` (email, phone required)
- [ ] Créer `countryConfig.js` avec configurations pays
- [ ] Ajouter validation téléphone intelligente
- [ ] Créer migration SQL
- [ ] Mettre à jour `Patient.js` model
- [ ] Tester validation avec différents pays

### Frontend
- [ ] Mettre à jour validation formulaire
- [ ] Remplacer input pays par select
- [ ] Ajouter indicateur pays pour téléphone
- [ ] Implémenter validation téléphone par pays
- [ ] Ajouter placeholders dynamiques
- [ ] Mettre à jour messages d'erreur
- [ ] Tester UX complète

### Documentation
- [ ] Documenter configurations pays
- [ ] Guide ajout nouveau pays
- [ ] Exemples validation par pays
- [ ] Tests E2E par pays

---

**Auteur**: Claude Code
**Date**: 2025-12-06
**Version**: 1.0.0
**Statut**: 📋 Spécification validée - Prêt pour implémentation
