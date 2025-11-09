const { logger } = require('../utils/logger');

/**
 * Service de validation NIF/CIF espagnol
 * Effectue la validation du format et de l'algorithme de contrôle
 * Note: Pas d'API publique gratuite disponible pour l'Espagne
 */
class SpainNifValidator {
  constructor() {
    this.nifRegex = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/;
    this.controlCharacters = '0123456789ABCDEFGHIJ';
  }

  /**
   * Valide un numéro NIF/CIF espagnol
   * @param {string} nif - Numéro NIF à valider
   * @returns {Promise<Object>} Résultat de la validation
   */
  async validate(nif) {
    try {
      // Normaliser le NIF
      const normalizedNif = nif.replace(/\s/g, '').toUpperCase();

      // Validation format
      if (!this.isValidNifFormat(normalizedNif)) {
        return {
          valid: false,
          error: 'Format NIF invalide - doit être: Lettre + 7 chiffres + caractère de contrôle'
        };
      }

      // Validation algorithme de contrôle
      if (!this.isValidNifCheckDigit(normalizedNif)) {
        return {
          valid: false,
          error: 'Caractère de contrôle NIF invalide'
        };
      }

      // Extraction des informations
      const entityInfo = this.extractEntityInfo(normalizedNif);

      return {
        valid: true,
        data: {
          nif: normalizedNif,
          type: entityInfo.type,
          description: entityInfo.description,
          category: entityInfo.category,
          validated: 'format_and_algorithm',
          source: 'spain_nif_validator'
        }
      };

    } catch (error) {
      logger.error(`NIF validation error: ${error.message}`);
      return {
        valid: false,
        error: 'Erreur validation NIF'
      };
    }
  }

  /**
   * Vérifie le format NIF
   * @param {string} nif
   * @returns {boolean}
   */
  isValidNifFormat(nif) {
    return this.nifRegex.test(nif);
  }

  /**
   * Vérifie le caractère de contrôle NIF selon l'algorithme officiel
   * @param {string} nif
   * @returns {boolean}
   */
  isValidNifCheckDigit(nif) {
    if (!this.isValidNifFormat(nif)) {
      return false;
    }

    const letter = nif[0];
    const number = nif.substring(1, 8);
    const checkDigit = nif[8];

    // Calculer le caractère de contrôle attendu
    const expectedCheck = this.calculateNifCheckDigit(letter, number);

    return checkDigit === expectedCheck;
  }

  /**
   * Calcule le caractère de contrôle NIF selon l'algorithme officiel espagnol
   * @param {string} letter
   * @param {string} number
   * @returns {string}
   */
  calculateNifCheckDigit(letter, number) {
    // Algorithme officiel pour les entités juridiques espagnoles
    let sum = 0;

    // Application de l'algorithme selon la lettre initiale
    for (let i = 0; i < 7; i++) {
      const digit = parseInt(number[i]);

      if (i % 2 === 0) {
        // Positions paires (0, 2, 4, 6)
        let doubled = digit * 2;
        if (doubled >= 10) {
          doubled = Math.floor(doubled / 10) + (doubled % 10);
        }
        sum += doubled;
      } else {
        // Positions impaires (1, 3, 5)
        sum += digit;
      }
    }

    // Calcul du caractère de contrôle
    const remainder = sum % 10;
    const checkValue = remainder === 0 ? 0 : 10 - remainder;

    // Certaines lettres utilisent des caractères alphabétiques
    const numericEntities = ['A', 'B', 'E', 'H'];
    if (numericEntities.includes(letter)) {
      return checkValue.toString();
    } else {
      return this.controlCharacters[checkValue];
    }
  }

  /**
   * Extrait les informations sur le type d'entité
   * @param {string} nif
   * @returns {Object}
   */
  extractEntityInfo(nif) {
    const firstLetter = nif[0];

    const entityTypes = {
      'A': {
        type: 'SA',
        description: 'Sociedad Anónima',
        category: 'company'
      },
      'B': {
        type: 'SL',
        description: 'Sociedad de Responsabilidad Limitada',
        category: 'company'
      },
      'C': {
        type: 'SC',
        description: 'Sociedad Colectiva',
        category: 'company'
      },
      'D': {
        type: 'SCOM',
        description: 'Sociedad Comanditaria',
        category: 'company'
      },
      'E': {
        type: 'CB',
        description: 'Comunidad de Bienes',
        category: 'partnership'
      },
      'F': {
        type: 'COOP',
        description: 'Sociedad Cooperativa',
        category: 'cooperative'
      },
      'G': {
        type: 'ASOC',
        description: 'Asociación',
        category: 'association'
      },
      'H': {
        type: 'CP',
        description: 'Comunidad de Propietarios',
        category: 'community'
      },
      'J': {
        type: 'SCIV',
        description: 'Sociedad Civil',
        category: 'civil_society'
      },
      'N': {
        type: 'ENT_EXT',
        description: 'Entidad Extranjera',
        category: 'foreign'
      },
      'P': {
        type: 'CORP_LOC',
        description: 'Corporación Local',
        category: 'public'
      },
      'Q': {
        type: 'ORG_AUT',
        description: 'Organismo Autónomo',
        category: 'public'
      },
      'R': {
        type: 'CONG_REL',
        description: 'Congregación Religiosa',
        category: 'religious'
      },
      'S': {
        type: 'ORG_ADM',
        description: 'Órgano de la Administración',
        category: 'public'
      },
      'U': {
        type: 'UTE',
        description: 'Unión Temporal de Empresas',
        category: 'temporary_union'
      },
      'V': {
        type: 'OTHER',
        description: 'Otros tipos no definidos',
        category: 'other'
      },
      'W': {
        type: 'EST_PERM',
        description: 'Establecimiento Permanente',
        category: 'permanent_establishment'
      }
    };

    return entityTypes[firstLetter] || {
      type: 'UNKNOWN',
      description: 'Tipo desconocido',
      category: 'unknown'
    };
  }

  /**
   * Vérifie si le NIF correspond à une entreprise (vs association/organisme public)
   * @param {string} nif
   * @returns {boolean}
   */
  isCommercialEntity(nif) {
    if (!this.isValidNifFormat(nif)) {
      return false;
    }

    const commercialLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'J', 'U', 'V', 'W'];
    return commercialLetters.includes(nif[0]);
  }

  /**
   * Vérifie si le NIF correspond à un organisme public
   * @param {string} nif
   * @returns {boolean}
   */
  isPublicEntity(nif) {
    if (!this.isValidNifFormat(nif)) {
      return false;
    }

    const publicLetters = ['P', 'Q', 'S'];
    return publicLetters.includes(nif[0]);
  }

  /**
   * Génère un NIF exemple valide pour tests
   * @param {string} letter - Lettre d'entité
   * @returns {string}
   */
  generateSampleNif(letter = 'B') {
    if (!/^[ABCDEFGHJNPQRSUVW]$/.test(letter)) {
      throw new Error('Lettre d\'entité invalide');
    }

    // Générer 7 chiffres aléatoirement
    const randomNumber = Math.floor(Math.random() * 9999999).toString().padStart(7, '0');

    // Calculer le caractère de contrôle
    const checkDigit = this.calculateNifCheckDigit(letter, randomNumber);

    return `${letter}${randomNumber}${checkDigit}`;
  }

  /**
   * Validation en lot de plusieurs NIFs
   * @param {string[]} nifs
   * @returns {Promise<Object[]>}
   */
  async validateBatch(nifs) {
    const results = [];

    for (const nif of nifs) {
      const result = await this.validate(nif);
      results.push({
        input: nif,
        ...result
      });
    }

    return results;
  }

  /**
   * Informations sur le service de validation
   * @returns {Object}
   */
  getServiceInfo() {
    return {
      country: 'ES',
      service: 'Spain NIF Validator',
      capabilities: [
        'Format validation',
        'Check digit verification',
        'Entity type identification',
        'Commercial entity detection'
      ],
      limitations: [
        'No real-time registry lookup',
        'Format and algorithm validation only',
        'Cannot verify if company actually exists'
      ],
      algorithm: 'Official Spanish NIF check digit algorithm',
      supportedFormats: [
        'Letter + 7 digits + control character',
        'Example: B12345674'
      ]
    };
  }
}

module.exports = SpainNifValidator;