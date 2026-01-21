/**
 * Clinic PractitionerWeeklyAvailability Model
 *
 * Stores practitioner-specific availability per calendar week
 * Allows practitioners to customize their availability week by week
 *
 * Schema:
 * - provider_id: Reference to healthcare_providers
 * - year: Calendar year (e.g., 2025)
 * - week_number: ISO week number (1-53)
 * - availability: JSONB with daily availability
 * - source: How entry was created (manual, copied, template)
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');

// Default availability structure
const DEFAULT_AVAILABILITY = {
  monday: { enabled: false, slots: [] },
  tuesday: { enabled: false, slots: [] },
  wednesday: { enabled: false, slots: [] },
  thursday: { enabled: false, slots: [] },
  friday: { enabled: false, slots: [] },
  saturday: { enabled: false, slots: [] },
  sunday: { enabled: false, slots: [] }
};

// Valid days of the week
const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Create PractitionerWeeklyAvailability model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} PractitionerWeeklyAvailability model configured for the clinic database
 */
function createPractitionerWeeklyAvailabilityModel(clinicDb) {
  const PractitionerWeeklyAvailability = ClinicBaseModel.create(clinicDb, 'PractitionerWeeklyAvailability', {
    // Provider relationship
    provider_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Calendar week identification
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 2020,
        max: 2100
      }
    },
    week_number: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 53
      }
    },

    // Availability data (JSONB)
    availability: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: DEFAULT_AVAILABILITY,
      validate: {
        isValidAvailability(value) {
          if (!value || typeof value !== 'object') {
            throw new Error('Availability must be a valid object');
          }
          for (const day of VALID_DAYS) {
            if (!value[day]) {
              throw new Error(`Missing day: ${day}`);
            }
            if (typeof value[day].enabled !== 'boolean') {
              throw new Error(`${day}.enabled must be a boolean`);
            }
            if (!Array.isArray(value[day].slots)) {
              throw new Error(`${day}.slots must be an array`);
            }
            // Validate each slot
            for (const slot of value[day].slots) {
              if (!slot.start || !slot.end) {
                throw new Error(`Slot in ${day} must have start and end`);
              }
              if (!/^\d{2}:\d{2}$/.test(slot.start) || !/^\d{2}:\d{2}$/.test(slot.end)) {
                throw new Error(`Invalid time format in ${day}: expected HH:MM`);
              }
              if (slot.start >= slot.end) {
                throw new Error(`Invalid slot in ${day}: start (${slot.start}) must be before end (${slot.end})`);
              }
            }
          }
        }
      }
    },

    // Source tracking
    source: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'manual',
      validate: {
        isIn: [['manual', 'copied', 'template']]
      }
    },
    copied_from_week: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 53
      }
    },
    copied_from_year: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 2020,
        max: 2100
      }
    },

    // Notes
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Audit
    created_by: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'practitioner_weekly_availability',
    indexes: [
      { fields: ['provider_id'] },
      { fields: ['year', 'week_number'] },
      { fields: ['provider_id', 'year', 'week_number'], unique: true }
    ]
  });

  // Instance methods

  /**
   * Get availability for a specific day
   * @param {string} day - Day name (monday, tuesday, etc.)
   * @returns {object} Day availability { enabled, slots }
   */
  PractitionerWeeklyAvailability.prototype.getDayAvailability = function(day) {
    const dayLower = day.toLowerCase();
    if (!VALID_DAYS.includes(dayLower)) {
      throw new Error(`Invalid day: ${day}`);
    }
    return this.availability[dayLower] || { enabled: false, slots: [] };
  };

  /**
   * Check if provider is available on a specific day
   * @param {string} day - Day name
   * @returns {boolean}
   */
  PractitionerWeeklyAvailability.prototype.isAvailableOnDay = function(day) {
    const dayAvailability = this.getDayAvailability(day);
    return dayAvailability.enabled && dayAvailability.slots.length > 0;
  };

  /**
   * Get total available hours for the week
   * @returns {number} Total hours
   */
  PractitionerWeeklyAvailability.prototype.getTotalAvailableHours = function() {
    let totalMinutes = 0;
    for (const day of VALID_DAYS) {
      const dayAvail = this.availability[day];
      if (dayAvail?.enabled) {
        for (const slot of dayAvail.slots || []) {
          const [startH, startM] = slot.start.split(':').map(Number);
          const [endH, endM] = slot.end.split(':').map(Number);
          totalMinutes += (endH * 60 + endM) - (startH * 60 + startM);
        }
      }
    }
    return Math.round(totalMinutes / 60 * 10) / 10; // Round to 1 decimal
  };

  /**
   * Get week label (e.g., "Semaine 51 - 2025")
   * @returns {string}
   */
  PractitionerWeeklyAvailability.prototype.getWeekLabel = function() {
    return `Semaine ${this.week_number} - ${this.year}`;
  };

  // Static methods

  /**
   * Find availability for a provider and week
   * @param {UUID} providerId
   * @param {number} year
   * @param {number} week
   * @returns {Model|null}
   */
  PractitionerWeeklyAvailability.findByProviderAndWeek = async function(providerId, year, week) {
    return await this.findOne({
      where: {
        provider_id: providerId,
        year,
        week_number: week
      }
    });
  };

  /**
   * Find or create availability for a provider and week
   * Uses template from healthcare_providers.availability if no specific entry exists
   * @param {UUID} providerId
   * @param {number} year
   * @param {number} week
   * @param {object} defaultAvailability - Template to use if creating
   * @returns {[Model, boolean]} [instance, created]
   */
  PractitionerWeeklyAvailability.findOrCreateForWeek = async function(providerId, year, week, defaultAvailability = null) {
    return await this.findOrCreate({
      where: {
        provider_id: providerId,
        year,
        week_number: week
      },
      defaults: {
        provider_id: providerId,
        year,
        week_number: week,
        availability: defaultAvailability || DEFAULT_AVAILABILITY,
        source: defaultAvailability ? 'template' : 'manual'
      }
    });
  };

  /**
   * Get all availability records for a provider within a date range
   * @param {UUID} providerId
   * @param {number} startYear
   * @param {number} startWeek
   * @param {number} endYear
   * @param {number} endWeek
   * @returns {Array<Model>}
   */
  PractitionerWeeklyAvailability.findByProviderInRange = async function(providerId, startYear, startWeek, endYear, endWeek) {
    return await this.findAll({
      where: {
        provider_id: providerId,
        [Op.or]: [
          // Same year, within week range
          {
            year: startYear,
            [Op.and]: [
              { week_number: { [Op.gte]: startWeek } },
              startYear === endYear ? { week_number: { [Op.lte]: endWeek } } : {}
            ]
          },
          // Different years
          ...(startYear !== endYear ? [
            {
              year: { [Op.gt]: startYear, [Op.lt]: endYear }
            },
            {
              year: endYear,
              week_number: { [Op.lte]: endWeek }
            }
          ] : [])
        ]
      },
      order: [['year', 'ASC'], ['week_number', 'ASC']]
    });
  };

  /**
   * Copy availability from one week to another
   * @param {UUID} providerId
   * @param {number} sourceYear
   * @param {number} sourceWeek
   * @param {number} targetYear
   * @param {number} targetWeek
   * @param {UUID} createdBy
   * @returns {Model}
   */
  PractitionerWeeklyAvailability.copyFromWeek = async function(providerId, sourceYear, sourceWeek, targetYear, targetWeek, createdBy = null) {
    const sourceEntry = await this.findByProviderAndWeek(providerId, sourceYear, sourceWeek);

    if (!sourceEntry) {
      throw new Error(`No availability found for week ${sourceWeek}/${sourceYear}`);
    }

    // Use upsert to create or update
    const [instance] = await this.upsert({
      provider_id: providerId,
      year: targetYear,
      week_number: targetWeek,
      availability: sourceEntry.availability,
      source: 'copied',
      copied_from_week: sourceWeek,
      copied_from_year: sourceYear,
      created_by: createdBy
    });

    return instance;
  };

  /**
   * Apply template to a week
   * @param {UUID} providerId
   * @param {number} year
   * @param {number} week
   * @param {object} template - Template availability object
   * @param {UUID} createdBy
   * @returns {Model}
   */
  PractitionerWeeklyAvailability.applyTemplate = async function(providerId, year, week, template, createdBy = null) {
    const [instance] = await this.upsert({
      provider_id: providerId,
      year,
      week_number: week,
      availability: template,
      source: 'template',
      copied_from_week: null,
      copied_from_year: null,
      created_by: createdBy
    });

    return instance;
  };

  /**
   * Delete old availability records (cleanup)
   * @param {number} olderThanWeeks - Delete records older than N weeks
   * @returns {number} Number of deleted records
   */
  PractitionerWeeklyAvailability.cleanupOldRecords = async function(olderThanWeeks = 52) {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - olderThanWeeks * 7 * 24 * 60 * 60 * 1000);
    const cutoffYear = cutoffDate.getFullYear();
    const cutoffWeek = getISOWeek(cutoffDate);

    const deleted = await this.destroy({
      where: {
        [Op.or]: [
          { year: { [Op.lt]: cutoffYear } },
          {
            year: cutoffYear,
            week_number: { [Op.lt]: cutoffWeek }
          }
        ]
      }
    });

    return deleted;
  };

  return PractitionerWeeklyAvailability;
}

/**
 * Get ISO week number for a date
 * @param {Date} date
 * @returns {number}
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

module.exports = createPractitionerWeeklyAvailabilityModel;
