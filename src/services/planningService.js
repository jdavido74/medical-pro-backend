/**
 * Planning Service
 * Handles availability calculation for machines and practitioners
 */

const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');

/**
 * Default clinic hours (can be overridden by clinic settings)
 */
const DEFAULT_CLINIC_HOURS = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '09:00', close: '18:00' },
  saturday: { open: '09:00', close: '13:00' },
  sunday: null // Closed
};

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parse time string to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to time string
 */
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get day of week name from date
 */
function getDayOfWeek(date) {
  const d = new Date(date);
  return DAYS_OF_WEEK[d.getDay()];
}

/**
 * Generate time slots for a given time range
 * @param {string} startTime - Start time (HH:MM)
 * @param {string} endTime - End time (HH:MM)
 * @param {number} slotDuration - Slot duration in minutes
 * @returns {Array} Array of slot objects { start, end }
 */
function generateTimeSlots(startTime, endTime, slotDuration) {
  const slots = [];
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) return slots;

  for (let current = startMinutes; current + slotDuration <= endMinutes; current += slotDuration) {
    slots.push({
      start: minutesToTime(current),
      end: minutesToTime(current + slotDuration)
    });
  }

  return slots;
}

/**
 * Check if two time ranges overlap
 */
function timeRangesOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  return s1 < e2 && s2 < e1;
}

/**
 * Parse clinic operating_hours JSONB for a given day name.
 * Supports two formats stored in clinic_settings.operating_hours:
 *   - Simple:  { enabled, start, end }
 *   - Lunch:   { enabled, hasLunchBreak, morning: {start,end}, afternoon: {start,end} }
 * Returns array of { open, close } ranges (matches legacy format used by the rest of the service).
 */
function parseClinicHoursForDay(operatingHours, dayName) {
  if (!operatingHours || !operatingHours[dayName]) return null;

  const dayHours = operatingHours[dayName];
  if (!dayHours.enabled) return null;

  // Lunch break format → two ranges
  if (dayHours.hasLunchBreak && dayHours.morning && dayHours.afternoon) {
    const ranges = [];
    if (dayHours.morning.start && dayHours.morning.end) {
      ranges.push({ open: dayHours.morning.start, close: dayHours.morning.end });
    }
    if (dayHours.afternoon.start && dayHours.afternoon.end) {
      ranges.push({ open: dayHours.afternoon.start, close: dayHours.afternoon.end });
    }
    return ranges.length > 0 ? ranges : null;
  }

  // Simple format → single range
  if (dayHours.start && dayHours.end) {
    return [{ open: dayHours.start, close: dayHours.end }];
  }

  return null;
}

/**
 * Get clinic hours for a specific date
 * Reads from clinic_settings table; falls back to DEFAULT_CLINIC_HOURS.
 * Also checks closed_dates.
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {Object|null} { open, close } or null if closed.
 *   For lunch-break clinics returns the first range (morning) — callers that
 *   need all ranges should use getClinicHoursRanges() instead.
 */
async function getClinicHours(clinicDb, date) {
  const ranges = await getClinicHoursRanges(clinicDb, date);
  if (!ranges || ranges.length === 0) return null;

  // Legacy callers expect a single { open, close } object.
  // If there are multiple ranges (lunch break), return a merged range covering the whole day
  // so that slot generation between open→close still works (booked lunch slots will be filtered
  // out by existing-appointment checks).
  if (ranges.length === 1) return ranges[0];

  // Merge: earliest open → latest close
  return {
    open: ranges[0].open,
    close: ranges[ranges.length - 1].close
  };
}

/**
 * Get all clinic hour ranges for a specific date (supports lunch breaks).
 * @returns {Array|null} Array of { open, close } or null if closed
 */
async function getClinicHoursRanges(clinicDb, date) {
  try {
    const [results] = await clinicDb.query(
      'SELECT operating_hours, closed_dates FROM clinic_settings LIMIT 1'
    );
    const settings = results?.[0];

    if (settings) {
      // Check closed dates
      const closedDates = settings.closed_dates;
      if (closedDates && Array.isArray(closedDates)) {
        const isClosed = closedDates.some(cd => cd.date === date);
        if (isClosed) return null;
      }

      // Parse operating hours for the day
      const dayOfWeek = getDayOfWeek(date);
      const parsed = parseClinicHoursForDay(settings.operating_hours, dayOfWeek);
      if (parsed) return parsed;
    }
  } catch (err) {
    console.warn('[planningService] Could not load clinic_settings, using defaults:', err.message);
  }

  // Fallback to hardcoded defaults
  const dayOfWeek = getDayOfWeek(date);
  const fallback = DEFAULT_CLINIC_HOURS[dayOfWeek];
  return fallback ? [fallback] : null;
}

/**
 * Get practitioner availability for a specific date
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} providerId - Healthcare provider ID
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {Array} Array of available time ranges [{ start, end }]
 */
async function getPractitionerAvailability(clinicDb, providerId, date) {
  try {
    const PractitionerWeeklyAvailability = await getModel(clinicDb, 'PractitionerWeeklyAvailability');
    const dayOfWeek = getDayOfWeek(date);

    const availability = await PractitionerWeeklyAvailability.findOne({
      where: {
        practitioner_id: providerId,
        day_of_week: dayOfWeek,
        is_active: true
      }
    });

    if (!availability) {
      // Fall back to clinic hours
      const clinicHours = await getClinicHours(clinicDb, date);
      return clinicHours ? [clinicHours] : [];
    }

    // Parse time slots from availability
    const slots = [];
    if (availability.start_time && availability.end_time) {
      slots.push({
        start: availability.start_time.substring(0, 5),
        end: availability.end_time.substring(0, 5)
      });
    }

    // Handle break time
    if (availability.break_start && availability.break_end) {
      const breakStart = availability.break_start.substring(0, 5);
      const breakEnd = availability.break_end.substring(0, 5);

      // Split around break
      if (slots.length > 0) {
        const original = slots[0];
        slots.length = 0;

        if (timeToMinutes(original.start) < timeToMinutes(breakStart)) {
          slots.push({ start: original.start, end: breakStart });
        }
        if (timeToMinutes(breakEnd) < timeToMinutes(original.end)) {
          slots.push({ start: breakEnd, end: original.end });
        }
      }
    }

    return slots;
  } catch (error) {
    console.error('[planningService] Error getting practitioner availability:', error);
    // Fall back to clinic hours
    const clinicHours = await getClinicHours(clinicDb, date);
    return clinicHours ? [clinicHours] : [];
  }
}

/**
 * Get machine availability for a specific date
 * Machine is available during clinic hours, minus existing appointments
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} machineId - Machine ID
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {Array} Array of available time ranges [{ start, end }]
 */
async function getMachineAvailability(clinicDb, machineId, date) {
  const ranges = await getClinicHoursRanges(clinicDb, date);
  if (!ranges || ranges.length === 0) return []; // Clinic closed

  return ranges;
}

/**
 * Get existing appointments for a resource (machine or provider) on a date
 */
async function getExistingAppointments(clinicDb, resourceType, resourceId, date) {
  const Appointment = await getModel(clinicDb, 'Appointment');

  const where = {
    appointment_date: date,
    status: { [Op.notIn]: ['cancelled'] }
  };

  if (resourceType === 'machine') {
    where.machine_id = resourceId;
  } else {
    where.provider_id = resourceId;
  }

  const appointments = await Appointment.findAll({
    where,
    attributes: ['id', 'start_time', 'end_time', 'status'],
    order: [['start_time', 'ASC']]
  });

  return appointments.map(apt => ({
    id: apt.id,
    start: apt.start_time.substring(0, 5),
    end: apt.end_time.substring(0, 5),
    status: apt.status
  }));
}

/**
 * Calculate available slots by removing booked slots from available ranges
 */
function calculateAvailableSlots(availableRanges, bookedSlots, slotDuration) {
  const allSlots = [];

  for (const range of availableRanges) {
    const rangeSlots = generateTimeSlots(range.start || range.open, range.end || range.close, slotDuration);

    for (const slot of rangeSlots) {
      // Check if slot overlaps with any booked slot
      const isBooked = bookedSlots.some(booked =>
        timeRangesOverlap(slot.start, slot.end, booked.start, booked.end)
      );

      if (!isBooked) {
        allSlots.push(slot);
      }
    }
  }

  return allSlots;
}

/**
 * Get available slots for a treatment (machine-based)
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} treatmentId - Treatment ID (from products_services)
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {number} duration - Appointment duration in minutes (optional, uses treatment duration)
 * @returns {Array} Array of available slots with machine info
 */
async function getTreatmentSlots(clinicDb, treatmentId, date, duration = null) {
  // Load ProductService first to ensure associations are set up
  const ProductService = await getModel(clinicDb, 'ProductService');
  // Then load Machine which will set up the reverse associations
  const Machine = await getModel(clinicDb, 'Machine');

  // Get treatment info
  const treatment = await ProductService.findByPk(treatmentId);
  if (!treatment) {
    throw new Error('Treatment not found');
  }

  const slotDuration = duration || treatment.duration || 30;

  // Get machines that can perform this treatment
  // Use a simpler query without include to avoid association issues
  let machines = [];

  // Check if association exists and use it
  if (Machine.associations?.treatments) {
    try {
      machines = await Machine.findAll({
        where: { is_active: true },
        include: [{
          model: ProductService,
          as: 'treatments',
          where: { id: treatmentId },
          through: { attributes: [] },
          required: true
        }]
      });
    } catch (assocError) {
      console.warn('[planningService] Association query failed, using fallback:', assocError.message);
      machines = [];
    }
  }

  // Fallback: query via junction table manually if association failed or doesn't exist
  if (machines.length === 0) {
    try {
      const results = await clinicDb.query(`
        SELECT m.* FROM machines m
        INNER JOIN machine_treatments mt ON m.id = mt.machine_id
        WHERE mt.treatment_id = :treatmentId AND m.is_active = true
      `, {
        replacements: { treatmentId },
        type: require('sequelize').QueryTypes.SELECT
      });

      if (results && results.length > 0) {
        machines = results;
      }
    } catch (queryError) {
      console.error('[planningService] Fallback query failed:', queryError.message);
    }
  }

  if (machines.length === 0) {
    return { slots: [], machines: [], message: 'No machines available for this treatment' };
  }

  const allSlots = [];
  const machineInfo = [];

  for (const machine of machines) {
    // Get machine availability
    const availability = await getMachineAvailability(clinicDb, machine.id, date);
    if (availability.length === 0) continue;

    // Get existing appointments for this machine
    const bookedSlots = await getExistingAppointments(clinicDb, 'machine', machine.id, date);

    // Calculate available slots
    const availableSlots = calculateAvailableSlots(availability, bookedSlots, slotDuration);

    // Add machine info to each slot
    for (const slot of availableSlots) {
      allSlots.push({
        ...slot,
        machineId: machine.id,
        machineName: machine.name,
        machineColor: machine.color,
        duration: slotDuration
      });
    }

    machineInfo.push({
      id: machine.id,
      name: machine.name,
      color: machine.color,
      location: machine.location,
      availableSlots: availableSlots.length
    });
  }

  // Sort by time, then by machine name
  allSlots.sort((a, b) => {
    const timeCompare = a.start.localeCompare(b.start);
    if (timeCompare !== 0) return timeCompare;
    return a.machineName.localeCompare(b.machineName);
  });

  // Deduplicate by time (keep first available machine for each slot)
  const uniqueSlots = [];
  const seenTimes = new Set();

  for (const slot of allSlots) {
    const timeKey = `${slot.start}-${slot.end}`;
    if (!seenTimes.has(timeKey)) {
      seenTimes.add(timeKey);
      // Count how many machines available at this time
      const machinesAtTime = allSlots.filter(s => s.start === slot.start && s.end === slot.end);
      uniqueSlots.push({
        ...slot,
        availableMachines: machinesAtTime.map(m => ({
          id: m.machineId,
          name: m.machineName,
          color: m.machineColor
        }))
      });
    }
  }

  return {
    slots: uniqueSlots,
    allSlots, // Include all slots with machine details
    machines: machineInfo,
    treatment: {
      id: treatment.id,
      title: treatment.title,
      duration: slotDuration
    }
  };
}

/**
 * Get available slots for a consultation (practitioner-based)
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} providerId - Healthcare provider ID
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {number} duration - Appointment duration in minutes
 * @returns {Array} Array of available slots
 */
async function getConsultationSlots(clinicDb, providerId, date, duration = 30) {
  const HealthcareProvider = await getModel(clinicDb, 'HealthcareProvider');

  // Get provider info
  const provider = await HealthcareProvider.findByPk(providerId);
  if (!provider) {
    throw new Error('Provider not found');
  }

  // Get practitioner availability
  const availability = await getPractitionerAvailability(clinicDb, providerId, date);
  if (availability.length === 0) {
    return { slots: [], provider: null, message: 'Provider not available on this date' };
  }

  // Get existing appointments
  const bookedSlots = await getExistingAppointments(clinicDb, 'provider', providerId, date);

  // Calculate available slots
  const availableSlots = calculateAvailableSlots(availability, bookedSlots, duration);

  return {
    slots: availableSlots.map(slot => ({
      ...slot,
      providerId: provider.id,
      providerName: `${provider.first_name} ${provider.last_name}`,
      duration
    })),
    provider: {
      id: provider.id,
      name: `${provider.first_name} ${provider.last_name}`,
      specialty: provider.specialties?.[0] || null,
      specialties: provider.specialties || [],
      availableSlots: availableSlots.length
    }
  };
}

/**
 * Get all available slots for a date (both treatments and consultations)
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {Object} filters - Optional filters { category, treatmentId, providerId }
 * @returns {Object} Slots grouped by category
 */
async function getAllSlots(clinicDb, date, filters = {}) {
  const result = {
    date,
    treatments: [],
    consultations: [],
    combined: []
  };

  // Get treatment slots if requested or no filter
  if (!filters.category || filters.category === 'treatment') {
    if (filters.treatmentId) {
      const treatmentSlots = await getTreatmentSlots(clinicDb, filters.treatmentId, date);
      result.treatments = treatmentSlots.slots;
    }
  }

  // Get consultation slots if requested or no filter
  if (!filters.category || filters.category === 'consultation') {
    if (filters.providerId) {
      const consultationSlots = await getConsultationSlots(clinicDb, filters.providerId, date);
      result.consultations = consultationSlots.slots;
    }
  }

  // Combine and sort
  result.combined = [
    ...result.treatments.map(s => ({ ...s, category: 'treatment' })),
    ...result.consultations.map(s => ({ ...s, category: 'consultation' }))
  ].sort((a, b) => a.start.localeCompare(b.start));

  return result;
}

/**
 * Get available slots for multiple treatments (multi-treatment booking)
 * Finds time slots where ALL treatments can be scheduled sequentially
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {Array} treatments - Array of { treatmentId, duration } objects
 * @returns {Object} Available multi-treatment slots with segments
 */
async function getMultiTreatmentSlots(clinicDb, date, treatments) {
  if (!treatments || treatments.length === 0) {
    return { slots: [], totalDuration: 0 };
  }

  // If only one treatment, use the standard function
  if (treatments.length === 1) {
    const result = await getTreatmentSlots(clinicDb, treatments[0].treatmentId, date, treatments[0].duration);
    return {
      slots: result.slots.map(slot => ({
        startTime: slot.start,
        endTime: slot.end,
        totalDuration: slot.duration,
        segments: [{
          treatmentId: treatments[0].treatmentId,
          machineId: slot.machineId,
          machineName: slot.machineName,
          machineColor: slot.machineColor,
          startTime: slot.start,
          endTime: slot.end,
          duration: slot.duration
        }]
      })),
      totalDuration: treatments[0].duration,
      treatments: [result.treatment]
    };
  }

  const ProductService = await getModel(clinicDb, 'ProductService');
  const Machine = await getModel(clinicDb, 'Machine');
  const Appointment = await getModel(clinicDb, 'Appointment');

  // Get clinic hours for the day
  const clinicHours = await getClinicHours(clinicDb, date);
  if (!clinicHours) {
    return { slots: [], totalDuration: 0, message: 'Clinic closed on this date' };
  }

  // Calculate total duration
  const totalDuration = treatments.reduce((sum, t) => sum + (t.duration || 30), 0);

  // Load treatment info and their available machines
  const treatmentData = await Promise.all(treatments.map(async (t) => {
    const treatment = await ProductService.findByPk(t.treatmentId);
    if (!treatment) {
      throw new Error(`Treatment not found: ${t.treatmentId}`);
    }

    // Get machines for this treatment - try multiple methods
    let machines = [];

    // Method 1: Try via Sequelize association
    if (Machine.associations?.treatments) {
      try {
        machines = await Machine.findAll({
          where: { is_active: true },
          include: [{
            model: ProductService,
            as: 'treatments',
            where: { id: t.treatmentId },
            through: { attributes: [] },
            required: true
          }]
        });
        console.log(`[planningService] Found ${machines.length} machines via association for treatment: ${treatment.title}`);
      } catch (assocError) {
        console.warn('[planningService] Association query failed:', assocError.message);
        machines = [];
      }
    }

    // Method 2: Fallback to raw SQL query
    if (machines.length === 0) {
      try {
        const results = await clinicDb.query(`
          SELECT m.* FROM machines m
          INNER JOIN machine_treatments mt ON m.id = mt.machine_id
          WHERE mt.treatment_id = :treatmentId AND m.is_active = true
        `, {
          replacements: { treatmentId: t.treatmentId },
          type: require('sequelize').QueryTypes.SELECT
        });
        machines = results || [];
        console.log(`[planningService] Found ${machines.length} machines via SQL for treatment: ${treatment.title}`);
      } catch (err) {
        console.warn('[planningService] SQL query failed:', err.message);
      }
    }

    // Method 3: If still no machines, get all active machines as fallback
    // This assumes any machine can perform any treatment if no specific mapping exists
    if (machines.length === 0) {
      try {
        machines = await Machine.findAll({
          where: { is_active: true },
          raw: true
        });
        console.log(`[planningService] Using all ${machines.length} active machines as fallback for treatment: ${treatment.title}`);
      } catch (fallbackErr) {
        console.error('[planningService] Fallback machine query failed:', fallbackErr.message);
      }
    }

    return {
      id: t.treatmentId,
      title: treatment.title,
      duration: t.duration || treatment.duration || 30,
      machines
    };
  }));

  // Check if all treatments have at least one machine
  for (const td of treatmentData) {
    if (td.machines.length === 0) {
      return {
        slots: [],
        totalDuration,
        message: `No machines available for treatment: ${td.title}`
      };
    }
  }

  // Get all existing appointments for all relevant machines on this date
  const allMachineIds = [...new Set(treatmentData.flatMap(t => t.machines.map(m => m.id)))];
  const existingAppointments = await Appointment.findAll({
    where: {
      machine_id: { [Op.in]: allMachineIds },
      appointment_date: date,
      status: { [Op.notIn]: ['cancelled'] }
    },
    attributes: ['id', 'machine_id', 'start_time', 'end_time'],
    order: [['start_time', 'ASC']]
  });

  // Build machine busy times map
  const machineBusyTimes = {};
  for (const apt of existingAppointments) {
    if (!machineBusyTimes[apt.machine_id]) {
      machineBusyTimes[apt.machine_id] = [];
    }
    machineBusyTimes[apt.machine_id].push({
      start: apt.start_time.substring(0, 5),
      end: apt.end_time.substring(0, 5)
    });
  }

  // Generate potential start times (every 15 minutes during clinic hours)
  const startMinutes = timeToMinutes(clinicHours.open);
  const endMinutes = timeToMinutes(clinicHours.close);
  const slotInterval = 15; // Check every 15 minutes

  const validSlots = [];

  for (let currentStart = startMinutes; currentStart + totalDuration <= endMinutes; currentStart += slotInterval) {
    // Try to find machines for all treatments starting at this time
    const segments = [];
    let segmentStart = currentStart;
    let isValidSlot = true;

    for (const treatment of treatmentData) {
      const segmentEnd = segmentStart + treatment.duration;
      const segmentStartTime = minutesToTime(segmentStart);
      const segmentEndTime = minutesToTime(segmentEnd);

      // Find an available machine for this treatment at this time
      let availableMachine = null;

      for (const machine of treatment.machines) {
        const busyTimes = machineBusyTimes[machine.id] || [];
        const isAvailable = !busyTimes.some(busy =>
          timeRangesOverlap(segmentStartTime, segmentEndTime, busy.start, busy.end)
        );

        // Also check against segments already allocated in this slot
        const alreadyUsedInSlot = segments.some(seg =>
          seg.machineId === machine.id &&
          timeRangesOverlap(segmentStartTime, segmentEndTime, seg.startTime, seg.endTime)
        );

        if (isAvailable && !alreadyUsedInSlot) {
          availableMachine = machine;
          break;
        }
      }

      if (!availableMachine) {
        isValidSlot = false;
        break;
      }

      segments.push({
        treatmentId: treatment.id,
        treatmentTitle: treatment.title,
        machineId: availableMachine.id,
        machineName: availableMachine.name,
        machineColor: availableMachine.color,
        startTime: segmentStartTime,
        endTime: segmentEndTime,
        duration: treatment.duration
      });

      segmentStart = segmentEnd;
    }

    if (isValidSlot) {
      validSlots.push({
        startTime: minutesToTime(currentStart),
        endTime: minutesToTime(currentStart + totalDuration),
        totalDuration,
        segments
      });
    }
  }

  console.log(`[planningService] Multi-treatment slots calculation:`, {
    date,
    treatmentsCount: treatments.length,
    treatmentData: treatmentData.map(t => ({ title: t.title, machines: t.machines.length })),
    totalDuration,
    slotsFound: validSlots.length,
    clinicHours
  });

  return {
    slots: validSlots,
    totalDuration,
    treatments: treatmentData.map(t => ({
      id: t.id,
      title: t.title,
      duration: t.duration,
      machinesCount: t.machines.length
    })),
    debug: {
      clinicHours,
      treatmentsWithMachines: treatmentData.map(t => ({
        title: t.title,
        machinesCount: t.machines.length,
        machineNames: t.machines.map(m => m.name)
      }))
    }
  };
}

/**
 * Check provider conflicts for a given date and time range
 * @param {Sequelize} clinicDb - Clinic database connection
 * @param {string} providerId - Healthcare provider ID
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {string} startTime - Start time (HH:MM)
 * @param {string} endTime - End time (HH:MM)
 * @param {string|null} excludeAppointmentId - Appointment ID to exclude (for edit mode)
 * @returns {Object} { hasConsultationConflict, hasTreatmentConflict, conflicts }
 */
async function checkProviderConflicts(clinicDb, providerId, date, startTime, endTime, excludeAppointmentId = null) {
  // Use raw query to avoid association issues with Patient model
  let sql = `
    SELECT a.id, a.category, a.start_time, a.end_time, a.title,
           p.first_name AS patient_first_name, p.last_name AS patient_last_name
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.appointment_date = :date
      AND a.provider_id = :providerId
      AND a.status NOT IN ('cancelled')
  `;
  const replacements = { date, providerId };

  if (excludeAppointmentId) {
    sql += ' AND a.id != :excludeId';
    replacements.excludeId = excludeAppointmentId;
  }

  sql += ' ORDER BY a.start_time ASC';

  const [appointments] = await clinicDb.query(sql, { replacements });

  // Filter overlapping appointments
  const conflicts = [];
  let hasConsultationConflict = false;
  let hasTreatmentConflict = false;

  for (const apt of appointments) {
    const aptStart = apt.start_time?.substring(0, 5);
    const aptEnd = apt.end_time?.substring(0, 5);
    if (!aptStart || !aptEnd) continue;

    if (timeRangesOverlap(startTime, endTime, aptStart, aptEnd)) {
      const patientName = apt.patient_first_name
        ? `${apt.patient_first_name} ${apt.patient_last_name}`
        : null;

      conflicts.push({
        id: apt.id,
        category: apt.category,
        startTime: aptStart,
        endTime: aptEnd,
        title: apt.title,
        patientName
      });

      if (apt.category === 'consultation') {
        hasConsultationConflict = true;
      } else {
        hasTreatmentConflict = true;
      }
    }
  }

  return {
    hasConsultationConflict,
    hasTreatmentConflict,
    conflicts
  };
}

module.exports = {
  getTreatmentSlots,
  getConsultationSlots,
  getAllSlots,
  getClinicHours,
  getClinicHoursRanges,
  getPractitionerAvailability,
  getMachineAvailability,
  generateTimeSlots,
  timeToMinutes,
  minutesToTime,
  getMultiTreatmentSlots,
  checkProviderConflicts
};
