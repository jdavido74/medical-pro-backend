/**
 * Public Appointment Routes
 * Endpoints for patient self-service (confirmation, etc.)
 * These routes do NOT require authentication
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');
const stateMachineService = require('../services/appointmentStateMachineService');
const { logger } = require('../utils/logger');

/**
 * GET /public/appointment/confirm/:token
 * Get appointment details for confirmation page
 */
router.get('/appointment/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      return res.status(400).json({
        success: false,
        error: 'Invalid confirmation token'
      });
    }

    // Note: This endpoint needs to know which clinic database to use
    // In a real implementation, the token would include clinic info or
    // there would be a central lookup table
    // For now, we'll expect clinicDb to be set by a middleware

    if (!req.clinicDb) {
      return res.status(400).json({
        success: false,
        error: 'Clinic context not available'
      });
    }

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    // Set up associations
    if (!Appointment.associations?.patient) {
      Appointment.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
    }
    if (!Appointment.associations?.machine) {
      Appointment.belongsTo(Machine, { foreignKey: 'machine_id', as: 'machine' });
    }
    if (!Appointment.associations?.provider) {
      Appointment.belongsTo(HealthcareProvider, { foreignKey: 'provider_id', as: 'provider' });
    }
    if (!Appointment.associations?.service) {
      Appointment.belongsTo(ProductService, { foreignKey: 'service_id', as: 'service' });
    }

    const appointment = await Appointment.findOne({
      where: {
        confirmation_token: token
      },
      include: [
        { model: Patient, as: 'patient' },
        { model: Machine, as: 'machine' },
        { model: HealthcareProvider, as: 'provider' },
        { model: ProductService, as: 'service' }
      ]
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found or confirmation link has expired'
      });
    }

    // Check if token has expired
    if (appointment.confirmation_token_expires_at &&
        new Date() > new Date(appointment.confirmation_token_expires_at)) {
      return res.status(410).json({
        success: false,
        error: 'Confirmation link has expired. Please contact the clinic.'
      });
    }

    // Check if already confirmed
    if (appointment.status === 'confirmed') {
      return res.json({
        success: true,
        data: {
          alreadyConfirmed: true,
          message: 'This appointment has already been confirmed',
          appointment: transformPublicAppointment(appointment)
        }
      });
    }

    // Check if appointment is in the past
    const appointmentDate = new Date(`${appointment.appointment_date}T${appointment.start_time}`);
    if (appointmentDate < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'This appointment date has passed'
      });
    }

    res.json({
      success: true,
      data: {
        alreadyConfirmed: false,
        appointment: transformPublicAppointment(appointment)
      }
    });
  } catch (error) {
    logger.error('Error fetching appointment for confirmation:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /public/appointment/confirm/:token
 * Confirm an appointment
 */
router.post('/appointment/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      return res.status(400).json({
        success: false,
        error: 'Invalid confirmation token'
      });
    }

    if (!req.clinicDb) {
      return res.status(400).json({
        success: false,
        error: 'Clinic context not available'
      });
    }

    const Appointment = await getModel(req.clinicDb, 'Appointment');

    const appointment = await Appointment.findOne({
      where: {
        confirmation_token: token
      }
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found or confirmation link has expired'
      });
    }

    // Check if token has expired
    if (appointment.confirmation_token_expires_at &&
        new Date() > new Date(appointment.confirmation_token_expires_at)) {
      return res.status(410).json({
        success: false,
        error: 'Confirmation link has expired. Please contact the clinic.'
      });
    }

    // Check if already confirmed
    if (appointment.status === 'confirmed') {
      return res.json({
        success: true,
        data: {
          message: 'Your appointment is already confirmed',
          confirmationTime: appointment.confirmed_at
        }
      });
    }

    // Check if appointment can be confirmed (status must be 'scheduled')
    if (appointment.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        error: `Cannot confirm appointment in '${appointment.status}' status`
      });
    }

    // Check if appointment is in the past
    const appointmentDate = new Date(`${appointment.appointment_date}T${appointment.start_time}`);
    if (appointmentDate < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'This appointment date has passed'
      });
    }

    // Confirm the appointment via state machine (triggers associated actions)
    const result = await stateMachineService.transition(
      req.clinicDb,
      appointment.id,
      'confirmed',
      null, // No user ID for patient confirmation
      {
        confirmedBy: 'patient'
      }
    );

    // Clear the confirmation token
    appointment.confirmation_token = null;
    appointment.confirmation_token_expires_at = null;
    await appointment.save();

    // Get IP address for logging
    const ipAddress = req.headers['x-forwarded-for'] ||
                      req.connection.remoteAddress ||
                      'unknown';

    logger.info('Appointment confirmed by patient', {
      appointmentId: appointment.id,
      appointmentNumber: appointment.appointment_number,
      ipAddress
    });

    res.json({
      success: true,
      data: {
        message: 'Your appointment has been confirmed successfully',
        appointmentId: appointment.id,
        appointmentNumber: appointment.appointment_number,
        date: appointment.appointment_date,
        time: appointment.start_time?.substring(0, 5),
        confirmedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error confirming appointment:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * GET /public/appointment/cancel/:token
 * Get appointment details for cancellation page
 */
router.get('/appointment/cancel/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token'
      });
    }

    if (!req.clinicDb) {
      return res.status(400).json({
        success: false,
        error: 'Clinic context not available'
      });
    }

    const Appointment = await getModel(req.clinicDb, 'Appointment');

    const appointment = await Appointment.findOne({
      where: {
        confirmation_token: token,
        status: { [Op.in]: ['scheduled', 'confirmed'] }
      }
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found or cannot be cancelled'
      });
    }

    // Check if appointment is in the past
    const appointmentDate = new Date(`${appointment.appointment_date}T${appointment.start_time}`);
    if (appointmentDate < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'This appointment date has passed'
      });
    }

    res.json({
      success: true,
      data: {
        appointmentNumber: appointment.appointment_number,
        date: appointment.appointment_date,
        time: appointment.start_time?.substring(0, 5),
        status: appointment.status
      }
    });
  } catch (error) {
    logger.error('Error fetching appointment for cancellation:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /public/appointment/cancel/:token
 * Cancel an appointment (by patient)
 */
router.post('/appointment/cancel/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    if (!token || token.length < 32) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token'
      });
    }

    if (!req.clinicDb) {
      return res.status(400).json({
        success: false,
        error: 'Clinic context not available'
      });
    }

    const Appointment = await getModel(req.clinicDb, 'Appointment');

    const appointment = await Appointment.findOne({
      where: {
        confirmation_token: token,
        status: { [Op.in]: ['scheduled', 'confirmed'] }
      }
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found or cannot be cancelled'
      });
    }

    // Check if appointment is in the past
    const appointmentDate = new Date(`${appointment.appointment_date}T${appointment.start_time}`);
    if (appointmentDate < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'This appointment date has passed'
      });
    }

    // Cancel via state machine
    const result = await stateMachineService.transition(
      req.clinicDb,
      appointment.id,
      'cancelled',
      null,
      { skipActions: ['*'] } // Skip all actions when patient cancels
    );

    // Add cancellation note
    appointment.notes = (appointment.notes || '') +
      `\n[Patient Cancellation] ${reason || 'No reason provided'}`;
    appointment.confirmation_token = null;
    appointment.confirmation_token_expires_at = null;
    await appointment.save();

    const ipAddress = req.headers['x-forwarded-for'] ||
                      req.connection.remoteAddress ||
                      'unknown';

    logger.info('Appointment cancelled by patient', {
      appointmentId: appointment.id,
      appointmentNumber: appointment.appointment_number,
      reason,
      ipAddress
    });

    res.json({
      success: true,
      data: {
        message: 'Your appointment has been cancelled',
        appointmentNumber: appointment.appointment_number
      }
    });
  } catch (error) {
    logger.error('Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * Transform appointment for public display (limited info)
 */
function transformPublicAppointment(apt) {
  if (!apt) return null;
  const data = apt.toJSON ? apt.toJSON() : apt;

  return {
    appointmentNumber: data.appointment_number,
    date: data.appointment_date,
    time: data.start_time?.substring(0, 5),
    endTime: data.end_time?.substring(0, 5),
    duration: data.duration_minutes,
    category: data.category,
    status: data.status,
    // Limited patient info (just for verification)
    patientFirstName: data.patient?.first_name,
    patientLastName: data.patient?.last_name?.charAt(0) + '.', // Privacy: just initial
    // Service/treatment name
    serviceName: data.service?.name,
    // Location
    machineName: data.machine?.name,
    machineLocation: data.machine?.location,
    // Provider
    providerName: data.provider
      ? `Dr. ${data.provider.first_name} ${data.provider.last_name}`
      : null
  };
}

module.exports = router;
