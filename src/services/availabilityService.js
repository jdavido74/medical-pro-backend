/**
 * Availability Service
 *
 * Business logic for managing practitioner availability:
 * - 3-tier availability resolution: Clinic hours > Provider template > Specific week
 * - Intersection calculation between provider availability and clinic hours
 * - Available slot generation for appointment booking
 */

const { getModel } = require('../base/ModelFactory');

const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Map day of week (0-6, Sunday=0) to day name
const DAY_NUMBER_TO_NAME = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday'
};

// Default availability structure
const DEFAULT_AVAILABILITY = {
  monday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  tuesday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  wednesday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  thursday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  friday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  saturday: { enabled: false, slots: [] },
  sunday: { enabled: false, slots: [] }
};

/**
 * Get ISO week number and year for a date
 * @param {Date} date
 * @returns {{ year: number, week: number }}
 */
function getISOWeekAndYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/**
 * Get day name from Date object
 * @param {Date} date
 * @returns {string} Day name (monday, tuesday, etc.)
 */
function getDayName(date) {
  return DAY_NUMBER_TO_NAME[date.getDay()];
}

/**
 * Parse time string to minutes since midnight
 * @param {string} time - Time in HH:MM format
 * @returns {number} Minutes since midnight
 */
function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes to time string
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in HH:MM format
 */
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Calculate intersection of two time ranges
 * @param {string} start1 - First range start (HH:MM)
 * @param {string} end1 - First range end (HH:MM)
 * @param {string} start2 - Second range start (HH:MM)
 * @param {string} end2 - Second range end (HH:MM)
 * @returns {{ start: string, end: string } | null} Intersection or null if no overlap
 */
function intersectTimeRanges(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  const intersectStart = Math.max(s1, s2);
  const intersectEnd = Math.min(e1, e2);

  if (intersectStart >= intersectEnd) {
    return null; // No overlap
  }

  return {
    start: minutesToTime(intersectStart),
    end: minutesToTime(intersectEnd)
  };
}

/**
 * Intersect provider slots with clinic slots for a single day
 * @param {Array<{start: string, end: string}>} providerSlots
 * @param {Array<{start: string, end: string}>} clinicSlots
 * @returns {Array<{start: string, end: string}>} Intersected slots
 */
function intersectDaySlots(providerSlots, clinicSlots) {
  const result = [];

  for (const providerSlot of providerSlots) {
    for (const clinicSlot of clinicSlots) {
      const intersection = intersectTimeRanges(
        providerSlot.start,
        providerSlot.end,
        clinicSlot.start,
        clinicSlot.end
      );

      if (intersection) {
        result.push(intersection);
      }
    }
  }

  // Merge overlapping slots
  return mergeOverlappingSlots(result);
}

/**
 * Merge overlapping time slots
 * @param {Array<{start: string, end: string}>} slots
 * @returns {Array<{start: string, end: string}>}
 */
function mergeOverlappingSlots(slots) {
  if (slots.length === 0) return [];

  // Sort by start time
  const sorted = [...slots].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastMerged = merged[merged.length - 1];

    if (timeToMinutes(current.start) <= timeToMinutes(lastMerged.end)) {
      // Overlap, extend the last merged slot
      if (timeToMinutes(current.end) > timeToMinutes(lastMerged.end)) {
        lastMerged.end = current.end;
      }
    } else {
      // No overlap, add as new slot
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Convert clinic operating hours to slot format
 * Handles both formats: simple (start/end) and with lunch break (morning/afternoon)
 * @param {object} clinicHours - Operating hours from clinic_settings
 * @param {string} dayName - Day name (monday, tuesday, etc.)
 * @returns {Array<{start: string, end: string}>}
 */
function getClinicSlotsForDay(clinicHours, dayName) {
  if (!clinicHours || !clinicHours[dayName]) {
    return [];
  }

  const dayHours = clinicHours[dayName];

  if (!dayHours.enabled) {
    return [];
  }

  // Format with lunch break
  if (dayHours.hasLunchBreak && dayHours.morning && dayHours.afternoon) {
    const slots = [];
    if (dayHours.morning.start && dayHours.morning.end) {
      slots.push({ start: dayHours.morning.start, end: dayHours.morning.end });
    }
    if (dayHours.afternoon.start && dayHours.afternoon.end) {
      slots.push({ start: dayHours.afternoon.start, end: dayHours.afternoon.end });
    }
    return slots;
  }

  // Simple format (single continuous period)
  if (dayHours.start && dayHours.end) {
    return [{ start: dayHours.start, end: dayHours.end }];
  }

  return [];
}

/**
 * Main service class
 */
class AvailabilityService {
  constructor(clinicDb) {
    this.clinicDb = clinicDb;
  }

  /**
   * Get provider availability for a specific week
   * Resolution order:
   * 1. Specific week entry in practitioner_weekly_availability
   * 2. Provider template from healthcare_providers.availability
   * 3. Default availability
   *
   * @param {UUID} providerId
   * @param {number} year
   * @param {number} week
   * @returns {Promise<{ availability: object, source: string, hasSpecificEntry: boolean }>}
   */
  async getWeekAvailability(providerId, year, week) {
    const PractitionerWeeklyAvailability = await getModel(this.clinicDb, 'PractitionerWeeklyAvailability');
    const HealthcareProvider = await getModel(this.clinicDb, 'HealthcareProvider');

    // 1. Try to find specific week entry
    const specificEntry = await PractitionerWeeklyAvailability.findOne({
      where: { provider_id: providerId, year, week_number: week }
    });

    if (specificEntry) {
      return {
        id: specificEntry.id,
        availability: specificEntry.availability,
        source: specificEntry.source,
        hasSpecificEntry: true,
        notes: specificEntry.notes,
        copiedFromWeek: specificEntry.copied_from_week,
        copiedFromYear: specificEntry.copied_from_year
      };
    }

    // 2. Get provider template
    const provider = await HealthcareProvider.findByPk(providerId);

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (provider.availability && Object.keys(provider.availability).length > 0) {
      return {
        availability: provider.availability,
        source: 'template',
        hasSpecificEntry: false
      };
    }

    // 3. Return default availability
    return {
      availability: DEFAULT_AVAILABILITY,
      source: 'default',
      hasSpecificEntry: false
    };
  }

  /**
   * Save availability for a specific week
   * @param {UUID} providerId
   * @param {number} year
   * @param {number} week
   * @param {object} availability
   * @param {UUID} userId - User making the change
   * @param {string} notes - Optional notes
   * @returns {Promise<object>}
   */
  async saveWeekAvailability(providerId, year, week, availability, userId = null, notes = null) {
    const PractitionerWeeklyAvailability = await getModel(this.clinicDb, 'PractitionerWeeklyAvailability');

    // Validate availability structure
    this.validateAvailabilityStructure(availability);

    const [entry, created] = await PractitionerWeeklyAvailability.upsert({
      provider_id: providerId,
      year,
      week_number: week,
      availability,
      source: 'manual',
      copied_from_week: null,
      copied_from_year: null,
      notes,
      created_by: userId
    });

    return {
      ...entry.get({ plain: true }),
      created
    };
  }

  /**
   * Copy availability from one week to another
   * @param {UUID} providerId
   * @param {number} sourceYear
   * @param {number} sourceWeek
   * @param {number} targetYear
   * @param {number} targetWeek
   * @param {UUID} userId
   * @returns {Promise<object>}
   */
  async copyWeekAvailability(providerId, sourceYear, sourceWeek, targetYear, targetWeek, userId = null) {
    // Get source availability (could be specific entry, template, or default)
    const sourceData = await this.getWeekAvailability(providerId, sourceYear, sourceWeek);

    const PractitionerWeeklyAvailability = await getModel(this.clinicDb, 'PractitionerWeeklyAvailability');

    const [entry] = await PractitionerWeeklyAvailability.upsert({
      provider_id: providerId,
      year: targetYear,
      week_number: targetWeek,
      availability: sourceData.availability,
      source: 'copied',
      copied_from_week: sourceWeek,
      copied_from_year: sourceYear,
      created_by: userId
    });

    return entry.get({ plain: true });
  }

  /**
   * Get provider template (from healthcare_providers.availability)
   * @param {UUID} providerId
   * @returns {Promise<object>}
   */
  async getProviderTemplate(providerId) {
    const HealthcareProvider = await getModel(this.clinicDb, 'HealthcareProvider');

    const provider = await HealthcareProvider.findByPk(providerId);

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    // Vérifier si le template est valide (contient au moins un jour)
    const availability = provider.availability;
    if (availability && typeof availability === 'object' && Object.keys(availability).length > 0) {
      // Vérifier qu'il contient les jours requis
      const hasValidDays = VALID_DAYS.some(day => availability[day] !== undefined);
      if (hasValidDays) {
        return availability;
      }
    }

    return DEFAULT_AVAILABILITY;
  }

  /**
   * Save provider template (to healthcare_providers.availability)
   * @param {UUID} providerId
   * @param {object} availability
   * @returns {Promise<object>}
   */
  async saveProviderTemplate(providerId, availability) {
    const HealthcareProvider = await getModel(this.clinicDb, 'HealthcareProvider');

    this.validateAvailabilityStructure(availability);

    const provider = await HealthcareProvider.findByPk(providerId);

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    await provider.update({ availability });

    return provider.availability;
  }

  /**
   * Apply provider template to a specific week
   * @param {UUID} providerId
   * @param {number} year
   * @param {number} week
   * @param {UUID} userId
   * @returns {Promise<object>}
   */
  async applyTemplateToWeek(providerId, year, week, userId = null) {
    const template = await this.getProviderTemplate(providerId);

    const PractitionerWeeklyAvailability = await getModel(this.clinicDb, 'PractitionerWeeklyAvailability');

    const [entry] = await PractitionerWeeklyAvailability.upsert({
      provider_id: providerId,
      year,
      week_number: week,
      availability: template,
      source: 'template',
      copied_from_week: null,
      copied_from_year: null,
      created_by: userId
    });

    return entry.get({ plain: true });
  }

  /**
   * Get available appointment slots for a specific date
   * Takes into account:
   * - Clinic opening hours
   * - Provider availability
   * - Existing appointments
   *
   * @param {UUID} providerId
   * @param {Date|string} date - Date to check
   * @param {number} slotDuration - Slot duration in minutes (default: 30)
   * @returns {Promise<Array<{start: string, end: string, available: boolean}>>}
   */
  async getAvailableSlots(providerId, date, slotDuration = 30) {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const dayName = getDayName(dateObj);
    const { year, week } = getISOWeekAndYear(dateObj);

    // 1. Get clinic hours for this day
    const clinicSettings = await this.getClinicSettings();
    const clinicSlots = getClinicSlotsForDay(clinicSettings?.operating_hours, dayName);

    if (clinicSlots.length === 0) {
      return []; // Clinic is closed
    }

    // 2. Check closed dates
    const dateString = dateObj.toISOString().split('T')[0];
    if (this.isClinicClosedOnDate(clinicSettings, dateString)) {
      return []; // Clinic is closed (holiday, etc.)
    }

    // 3. Get provider availability for this week
    const providerAvailData = await this.getWeekAvailability(providerId, year, week);
    const providerDayAvail = providerAvailData.availability[dayName];

    if (!providerDayAvail?.enabled || !providerDayAvail.slots?.length) {
      return []; // Provider not available
    }

    // 4. Calculate intersection
    const effectiveSlots = intersectDaySlots(providerDayAvail.slots, clinicSlots);

    if (effectiveSlots.length === 0) {
      return []; // No overlap between provider and clinic hours
    }

    // 5. Generate time slots
    const generatedSlots = this.generateTimeSlots(effectiveSlots, slotDuration);

    // 6. Check against existing appointments
    const existingAppointments = await this.getExistingAppointments(providerId, dateString);

    // 7. Mark slots as available or not
    return generatedSlots.map(slot => ({
      ...slot,
      available: !this.isSlotOccupied(slot, existingAppointments)
    }));
  }

  /**
   * Generate time slots from effective availability
   * @param {Array<{start: string, end: string}>} effectiveSlots
   * @param {number} duration - Slot duration in minutes
   * @returns {Array<{start: string, end: string}>}
   */
  generateTimeSlots(effectiveSlots, duration) {
    const slots = [];

    for (const slot of effectiveSlots) {
      let currentStart = timeToMinutes(slot.start);
      const slotEnd = timeToMinutes(slot.end);

      while (currentStart + duration <= slotEnd) {
        slots.push({
          start: minutesToTime(currentStart),
          end: minutesToTime(currentStart + duration)
        });
        currentStart += duration;
      }
    }

    return slots;
  }

  /**
   * Get clinic settings
   * @returns {Promise<object|null>}
   */
  async getClinicSettings() {
    try {
      const [results] = await this.clinicDb.query(
        'SELECT * FROM clinic_settings LIMIT 1'
      );
      return results[0] || null;
    } catch (error) {
      console.error('Error fetching clinic settings:', error);
      return null;
    }
  }

  /**
   * Check if clinic is closed on a specific date
   * @param {object} clinicSettings
   * @param {string} dateString - Date in YYYY-MM-DD format
   * @returns {boolean}
   */
  isClinicClosedOnDate(clinicSettings, dateString) {
    if (!clinicSettings?.closed_dates) return false;

    const closedDates = clinicSettings.closed_dates;
    return closedDates.some(cd => cd.date === dateString);
  }

  /**
   * Get existing appointments for a provider on a date
   * @param {UUID} providerId
   * @param {string} dateString - Date in YYYY-MM-DD format
   * @returns {Promise<Array>}
   */
  async getExistingAppointments(providerId, dateString) {
    try {
      const Appointment = this.clinicDb.models.Appointment;

      if (!Appointment) {
        // Fallback to raw query
        const [results] = await this.clinicDb.query(
          `SELECT start_time, end_time, status
           FROM appointments
           WHERE provider_id = :providerId
             AND appointment_date = :date
             AND status NOT IN ('cancelled', 'no_show')`,
          {
            replacements: { providerId, date: dateString }
          }
        );
        return results;
      }

      return await Appointment.findAll({
        where: {
          provider_id: providerId,
          appointment_date: dateString,
          status: { [require('sequelize').Op.notIn]: ['cancelled', 'no_show'] }
        },
        attributes: ['start_time', 'end_time', 'status']
      });
    } catch (error) {
      console.error('Error fetching appointments:', error);
      return [];
    }
  }

  /**
   * Check if a slot is occupied by an existing appointment
   * @param {{start: string, end: string}} slot
   * @param {Array} appointments
   * @returns {boolean}
   */
  isSlotOccupied(slot, appointments) {
    const slotStart = timeToMinutes(slot.start);
    const slotEnd = timeToMinutes(slot.end);

    for (const appt of appointments) {
      const apptStart = timeToMinutes(appt.start_time?.substring(0, 5) || appt.startTime);
      const apptEnd = timeToMinutes(appt.end_time?.substring(0, 5) || appt.endTime);

      // Check for overlap
      if (slotStart < apptEnd && slotEnd > apptStart) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate availability structure
   * @param {object} availability
   * @throws {Error} If structure is invalid
   */
  validateAvailabilityStructure(availability) {
    if (!availability || typeof availability !== 'object') {
      throw new Error('Availability must be a valid object');
    }

    for (const day of VALID_DAYS) {
      if (!availability[day]) {
        throw new Error(`Missing day: ${day}`);
      }

      const dayData = availability[day];

      if (typeof dayData.enabled !== 'boolean') {
        throw new Error(`${day}.enabled must be a boolean`);
      }

      if (!Array.isArray(dayData.slots)) {
        throw new Error(`${day}.slots must be an array`);
      }

      for (const slot of dayData.slots) {
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

  /**
   * Get effective availability for a day (intersected with clinic hours)
   * @param {UUID} providerId
   * @param {Date|string} date
   * @returns {Promise<{dayName: string, enabled: boolean, slots: Array, clinicSlots: Array, effectiveSlots: Array}>}
   */
  async getEffectiveAvailabilityForDay(providerId, date) {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const dayName = getDayName(dateObj);
    const { year, week } = getISOWeekAndYear(dateObj);

    // Get clinic settings
    const clinicSettings = await this.getClinicSettings();
    const clinicSlots = getClinicSlotsForDay(clinicSettings?.operating_hours, dayName);

    // Get provider availability
    const providerAvailData = await this.getWeekAvailability(providerId, year, week);
    const providerDayAvail = providerAvailData.availability[dayName];

    // Calculate intersection
    const effectiveSlots = providerDayAvail?.enabled && providerDayAvail.slots?.length
      ? intersectDaySlots(providerDayAvail.slots, clinicSlots)
      : [];

    return {
      dayName,
      enabled: providerDayAvail?.enabled || false,
      slots: providerDayAvail?.slots || [],
      clinicSlots,
      effectiveSlots
    };
  }
}

// Export factory function
function createAvailabilityService(clinicDb) {
  return new AvailabilityService(clinicDb);
}

module.exports = createAvailabilityService;
module.exports.AvailabilityService = AvailabilityService;
module.exports.getISOWeekAndYear = getISOWeekAndYear;
module.exports.getDayName = getDayName;
module.exports.intersectTimeRanges = intersectTimeRanges;
module.exports.intersectDaySlots = intersectDaySlots;
module.exports.VALID_DAYS = VALID_DAYS;
module.exports.DEFAULT_AVAILABILITY = DEFAULT_AVAILABILITY;
