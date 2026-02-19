'use strict';

const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const MedicationProvider = require('./MedicationProvider');
const logger = require('../../utils/logger');

const BASE_URL = 'https://cima.aemps.es/cima/rest';

class CimaProvider extends MedicationProvider {
  constructor() {
    super('ES');
    this.searchCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.detailCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
    this.sectionCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
  }

  /**
   * Search medications in CIMA
   * @param {string} query - Medication name
   * @param {object} options - { limit: 20 }
   * @returns {Promise<Array>} Normalized medication results
   */
  async search(query, options = {}) {
    const limit = options.limit || 20;
    const cacheKey = `search:${query.toLowerCase()}:${limit}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    try {
      const url = `${BASE_URL}/medicamentos?nombre=${encodeURIComponent(query)}&comerc=1`;
      const response = await fetch(url, { timeout: 10000 });

      if (!response.ok) {
        logger.warn(`CIMA search failed with status ${response.status} for query: ${query}`);
        return [];
      }

      const data = await response.json();
      const resultados = data.resultados || [];

      const results = resultados.slice(0, limit).map(med => this._normalizeSearchResult(med));

      this.searchCache.set(cacheKey, results);
      return results;
    } catch (error) {
      logger.error('CIMA search error:', error.message);
      return [];
    }
  }

  /**
   * Get full medication detail from CIMA
   * @param {string} nregistro - CIMA registration number
   * @returns {Promise<object|null>}
   */
  async getDetail(nregistro) {
    const cacheKey = `detail:${nregistro}`;

    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;

    try {
      const url = `${BASE_URL}/medicamento?nregistro=${encodeURIComponent(nregistro)}`;
      const response = await fetch(url, { timeout: 10000 });

      if (!response.ok) {
        logger.warn(`CIMA detail failed with status ${response.status} for nregistro: ${nregistro}`);
        return null;
      }

      const data = await response.json();
      const result = this._normalizeDetail(data);

      this.detailCache.set(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('CIMA detail error:', error.message);
      return null;
    }
  }

  /**
   * Get posology section (4.2)
   * @param {string} nregistro
   * @returns {Promise<string|null>} HTML content
   */
  async getPosology(nregistro) {
    return this._getSection(nregistro, '4.2');
  }

  /**
   * Get interactions section (4.5)
   * @param {string} nregistro
   * @returns {Promise<string|null>} HTML content
   */
  async getInteractions(nregistro) {
    return this._getSection(nregistro, '4.5');
  }

  /**
   * Get contraindications section (4.3)
   * @param {string} nregistro
   * @returns {Promise<string|null>} HTML content
   */
  async getContraindications(nregistro) {
    return this._getSection(nregistro, '4.3');
  }

  /**
   * Fetch a specific document section from CIMA
   * @private
   */
  async _getSection(nregistro, seccion) {
    const cacheKey = `section:${nregistro}:${seccion}`;

    const cached = this.sectionCache.get(cacheKey);
    if (cached) return cached;

    try {
      const url = `${BASE_URL}/docSegmentado/contenido/1?nregistro=${encodeURIComponent(nregistro)}&seccion=${encodeURIComponent(seccion)}`;
      const response = await fetch(url, { timeout: 15000 });

      if (!response.ok) {
        logger.warn(`CIMA section ${seccion} failed with status ${response.status} for nregistro: ${nregistro}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      let html;
      if (contentType.includes('application/json')) {
        const data = await response.json();
        html = data.contenido || data.content || JSON.stringify(data);
      } else {
        html = await response.text();
      }

      this.sectionCache.set(cacheKey, html);
      return html;
    } catch (error) {
      logger.error(`CIMA section ${seccion} error:`, error.message);
      return null;
    }
  }

  /**
   * Normalize a CIMA search result to unified format
   * @private
   */
  _normalizeSearchResult(med) {
    return {
      source: 'cima',
      nregistro: String(med.nregistro || ''),
      name: med.nombre || '',
      activeIngredients: this._parseActiveIngredients(med.principiosActivos),
      dosage: med.dosis || '',
      pharmaceuticalForm: med.formaFarmaceutica?.nombre || '',
      administrationRoutes: (med.viasAdministracion || []).map(v => v.nombre),
      atcCode: med.atc?.codigo || '',
      requiresPrescription: med.receta === true,
      isMarketed: med.comercializado === true
    };
  }

  /**
   * Normalize a CIMA detail response
   * @private
   */
  _normalizeDetail(med) {
    return {
      source: 'cima',
      nregistro: String(med.nregistro || ''),
      name: med.nombre || '',
      activeIngredients: this._parseActiveIngredients(med.principiosActivos),
      dosage: med.dosis || '',
      pharmaceuticalForm: med.formaFarmaceutica?.nombre || '',
      administrationRoutes: (med.viasAdministracion || []).map(v => v.nombre),
      atcCode: med.atc?.codigo || '',
      requiresPrescription: med.receta === true,
      isMarketed: med.comercializado === true,
      labName: med.labtitular || '',
      images: (med.fotos || []).map(f => f.url),
      docs: (med.docs || []).map(d => ({ type: d.tipo, url: d.url }))
    };
  }

  /**
   * Parse active ingredients from CIMA format
   * @private
   */
  _parseActiveIngredients(principios) {
    if (!principios || !Array.isArray(principios)) return [];
    return principios.map(p => ({
      name: p.nombre || '',
      amount: p.cantidad || '',
      unit: p.unidad || ''
    }));
  }
}

// Singleton instance
let instance = null;

function getCimaProvider() {
  if (!instance) {
    instance = new CimaProvider();
  }
  return instance;
}

module.exports = { CimaProvider, getCimaProvider };
