'use strict';

const { getCimaProvider } = require('./CimaProvider');

const providers = {
  ES: getCimaProvider
};

/**
 * Get the medication provider for a given country
 * @param {string} countryCode - ISO 2-letter country code
 * @returns {MedicationProvider|null}
 */
function getMedicationProvider(countryCode) {
  const factory = providers[countryCode?.toUpperCase()];
  return factory ? factory() : null;
}

module.exports = { getMedicationProvider };
