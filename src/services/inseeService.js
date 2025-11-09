const fetch = require('node-fetch');
const { logger } = require('../utils/logger');

/**
 * Service de validation SIRET via l'API INSEE
 * Documentation: https://api.insee.fr/catalogue/site/themes/wso2/subthemes/insee/pages/item-info.jag?name=Sirene&version=V3
 */
class FranceInseeValidator {
  constructor() {
    this.baseURL = process.env.INSEE_API_URL || 'https://api.insee.fr/entreprises/sirene/V3';
    this.token = process.env.INSEE_API_TOKEN;
    this.timeout = 10000; // 10 secondes
  }

  /**
   * Valide un numéro SIRET via l'API INSEE
   * @param {string} siret - Numéro SIRET à valider (14 chiffres)
   * @returns {Promise<Object>} Résultat de la validation
   */
  async validate(siret) {
    try {
      // Validation format préliminaire
      if (!this.isValidSiretFormat(siret)) {
        return {
          valid: false,
          error: 'Format SIRET invalide - doit contenir exactement 14 chiffres'
        };
      }

      // Vérifier si l'API INSEE est configurée
      if (!this.token) {
        logger.warn('INSEE API token not configured, using format validation only');
        return this.validateFormatOnly(siret);
      }

      // Appel API INSEE
      const response = await this.callInseeAPI(siret);
      return this.parseInseeResponse(response, siret);

    } catch (error) {
      logger.error(`INSEE API error for SIRET ${siret}: ${error.message}`);

      // Fallback sur validation format uniquement
      return {
        valid: false,
        error: 'Service INSEE temporairement indisponible',
        fallback: this.validateFormatOnly(siret)
      };
    }
  }

  /**
   * Appel à l'API INSEE Sirene
   * @param {string} siret
   * @returns {Promise<Object>}
   */
  async callInseeAPI(siret) {
    const url = `${this.baseURL}/siret/${siret}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json',
          'User-Agent': 'FacturePro/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return { status: 404, error: 'SIRET non trouvé dans la base INSEE' };
        }
        if (response.status === 401) {
          throw new Error('Token INSEE invalide ou expiré');
        }
        if (response.status === 429) {
          throw new Error('Limite de taux API INSEE atteinte');
        }
        throw new Error(`API INSEE error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { status: 200, data };

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Timeout API INSEE');
      }
      throw error;
    }
  }

  /**
   * Parse la réponse de l'API INSEE
   * @param {Object} response
   * @param {string} siret
   * @returns {Object}
   */
  parseInseeResponse(response, siret) {
    if (response.status === 404) {
      return {
        valid: false,
        error: response.error
      };
    }

    if (response.status !== 200 || !response.data) {
      return {
        valid: false,
        error: 'Réponse API INSEE invalide'
      };
    }

    try {
      const etablissement = response.data.etablissement;
      const uniteLegale = etablissement.uniteLegale;

      // Vérifier que l'établissement est actif
      const isActive = etablissement.etatAdministratifEtablissement === 'A';
      const isUniteLegaleActive = uniteLegale.etatAdministratifUniteLegale === 'A';

      return {
        valid: true,
        data: {
          siret: etablissement.siret,
          siren: etablissement.siren,
          name: this.getCompanyName(uniteLegale),
          address: this.formatAddress(etablissement.adresseEtablissement),
          activity: {
            code: uniteLegale.activitePrincipaleUniteLegale,
            label: uniteLegale.nomenclatureActivitePrincipaleUniteLegale
          },
          status: {
            etablissement: etablissement.etatAdministratifEtablissement,
            uniteLegale: uniteLegale.etatAdministratifUniteLegale,
            active: isActive && isUniteLegaleActive
          },
          dates: {
            creation: etablissement.dateCreationEtablissement,
            lastUpdate: etablissement.dateDernierTraitementEtablissement
          },
          employees: etablissement.trancheEffectifsEtablissement,
          source: 'insee_api'
        }
      };

    } catch (error) {
      logger.error(`Error parsing INSEE response: ${error.message}`);
      return {
        valid: false,
        error: 'Erreur parsing réponse INSEE'
      };
    }
  }

  /**
   * Extrait le nom de l'entreprise des données INSEE
   * @param {Object} uniteLegale
   * @returns {string}
   */
  getCompanyName(uniteLegale) {
    // Ordre de priorité pour le nom
    if (uniteLegale.denominationUniteLegale) {
      return uniteLegale.denominationUniteLegale;
    }

    if (uniteLegale.denominationUsuelle1UniteLegale) {
      return uniteLegale.denominationUsuelle1UniteLegale;
    }

    // Pour les personnes physiques
    if (uniteLegale.prenom1UniteLegale && uniteLegale.nomUniteLegale) {
      return `${uniteLegale.prenom1UniteLegale} ${uniteLegale.nomUniteLegale}`;
    }

    return 'Nom non disponible';
  }

  /**
   * Formate l'adresse depuis les données INSEE
   * @param {Object} adresse
   * @returns {Object}
   */
  formatAddress(adresse) {
    const street = [
      adresse.numeroVoieEtablissement,
      adresse.indiceRepetitionEtablissement,
      adresse.typeVoieEtablissement,
      adresse.libelleVoieEtablissement
    ].filter(Boolean).join(' ').trim();

    return {
      street: street || null,
      complement: adresse.complementAdresseEtablissement || null,
      postalCode: adresse.codePostalEtablissement || null,
      city: adresse.libelleCommuneEtablissement || null,
      country: 'France',
      raw: adresse
    };
  }

  /**
   * Validation format uniquement (fallback)
   * @param {string} siret
   * @returns {Object}
   */
  validateFormatOnly(siret) {
    const isValid = this.isValidSiretFormat(siret) && this.isValidSiretChecksum(siret);

    return {
      valid: isValid,
      data: isValid ? {
        siret: siret,
        siren: siret.substring(0, 9),
        source: 'format_validation_only'
      } : null,
      error: isValid ? null : 'Format SIRET invalide'
    };
  }

  /**
   * Vérifie le format SIRET (14 chiffres)
   * @param {string} siret
   * @returns {boolean}
   */
  isValidSiretFormat(siret) {
    return /^\d{14}$/.test(siret);
  }

  /**
   * Vérifie la clé de contrôle SIRET (algorithme de Luhn)
   * @param {string} siret
   * @returns {boolean}
   */
  isValidSiretChecksum(siret) {
    if (!this.isValidSiretFormat(siret)) {
      return false;
    }

    let sum = 0;
    for (let i = 0; i < 14; i++) {
      let digit = parseInt(siret[i]);

      // Doubler les chiffres en position paire (0, 2, 4, ...)
      if (i % 2 === 0) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
    }

    return sum % 10 === 0;
  }

  /**
   * Recherche d'entreprise par nom (optionnel)
   * @param {string} name
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async searchByName(name, options = {}) {
    if (!this.token) {
      return {
        success: false,
        error: 'Service INSEE non configuré'
      };
    }

    try {
      const { limit = 10, offset = 0 } = options;
      const encodedName = encodeURIComponent(name);

      const url = `${this.baseURL}/siret?q=denominationUniteLegale:${encodedName}&nombre=${limit}&debut=${offset}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        success: true,
        data: {
          results: data.etablissements?.map(etab => ({
            siret: etab.siret,
            siren: etab.siren,
            name: this.getCompanyName(etab.uniteLegale),
            address: this.formatAddress(etab.adresseEtablissement)
          })) || [],
          total: data.header?.total || 0
        }
      };

    } catch (error) {
      logger.error(`INSEE search error: ${error.message}`);
      return {
        success: false,
        error: 'Erreur recherche INSEE'
      };
    }
  }
}

module.exports = FranceInseeValidator;