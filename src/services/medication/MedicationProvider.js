'use strict';

/**
 * Abstract medication provider interface.
 * Each country implements this (ES=CIMA, FR=BDPM, etc.)
 */
class MedicationProvider {
  constructor(countryCode) {
    if (new.target === MedicationProvider) {
      throw new Error('MedicationProvider is abstract and cannot be instantiated directly');
    }
    this.countryCode = countryCode;
  }

  /**
   * Search medications by name
   * @param {string} query - Search term
   * @param {object} options - { limit }
   * @returns {Promise<Array>} Normalized medication objects
   */
  async search(query, options = {}) {
    throw new Error('search() must be implemented by subclass');
  }

  /**
   * Get full detail of a medication
   * @param {string} id - Provider-specific ID (nregistro for CIMA)
   * @returns {Promise<object>} Full medication detail
   */
  async getDetail(id) {
    throw new Error('getDetail() must be implemented by subclass');
  }

  /**
   * Get posology information (section 4.2 for CIMA)
   * @param {string} id - Provider-specific ID
   * @returns {Promise<string>} HTML content
   */
  async getPosology(id) {
    throw new Error('getPosology() must be implemented by subclass');
  }

  /**
   * Get drug interactions information (section 4.5 for CIMA)
   * @param {string} id - Provider-specific ID
   * @returns {Promise<string>} HTML content
   */
  async getInteractions(id) {
    throw new Error('getInteractions() must be implemented by subclass');
  }

  /**
   * Get contraindications information (section 4.3 for CIMA)
   * @param {string} id - Provider-specific ID
   * @returns {Promise<string>} HTML content
   */
  async getContraindications(id) {
    throw new Error('getContraindications() must be implemented by subclass');
  }
}

module.exports = MedicationProvider;
