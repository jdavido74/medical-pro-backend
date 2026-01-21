/**
 * Clinic Setup Routes
 * Endpoints for onboarding flow and clinic setup status
 *
 * These routes are used by the admin onboarding wizard to:
 * 1. Check clinic setup status
 * 2. Complete setup steps
 * 3. Mark setup as completed
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');
const { Company } = require('../models');
const { logger } = require('../utils/logger');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/clinic/setup-status
 * Get the current setup status for the clinic
 *
 * Returns:
 * - setupStatus: 'not_started' | 'in_progress' | 'completed'
 * - steps: Object with completion status for each step
 */
router.get('/setup-status', async (req, res) => {
  try {
    const clinicId = req.clinicId;

    // Get company from central database
    const company = await Company.findByPk(clinicId);

    if (!company) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic not found' }
      });
    }

    // Check each setup step
    const steps = {
      clinic: false,
      team: false,
      practitioner: false
    };

    // Step 1: Check if clinic info is configured (has name and email)
    steps.clinic = !!(company.name && company.email);

    // Step 2: Check if at least one team exists
    try {
      const [teams] = await req.clinicDb.query(`
        SELECT COUNT(*) as count FROM teams WHERE is_active = true
      `);
      steps.team = parseInt(teams[0].count) > 0;
    } catch (e) {
      // Table might not exist, consider step incomplete
      steps.team = false;
    }

    // Step 3: Check if at least one healthcare provider exists
    try {
      const [providers] = await req.clinicDb.query(`
        SELECT COUNT(*) as count FROM healthcare_providers WHERE is_active = true
      `);
      steps.practitioner = parseInt(providers[0].count) > 0;
    } catch (e) {
      // Table might not exist, consider step incomplete
      steps.practitioner = false;
    }

    // Determine overall status
    const allComplete = steps.clinic && steps.team && steps.practitioner;
    const anyStarted = steps.clinic || steps.team || steps.practitioner;

    let setupStatus = 'not_started';
    if (allComplete || company.setup_completed_at) {
      setupStatus = 'completed';
    } else if (anyStarted) {
      setupStatus = 'in_progress';
    }

    res.json({
      success: true,
      data: {
        setupStatus,
        setupCompletedAt: company.setup_completed_at,
        steps,
        allStepsComplete: allComplete
      }
    });

  } catch (error) {
    logger.error('[clinicSetup] Error getting setup status:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get setup status', details: error.message }
    });
  }
});

/**
 * POST /api/v1/clinic/complete-setup
 * Mark the clinic setup as completed
 *
 * This should be called after all onboarding steps are complete.
 * Only admins can complete setup.
 */
router.post('/complete-setup', async (req, res) => {
  try {
    const clinicId = req.clinicId;
    const user = req.user;

    // Only admins can complete setup
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: { message: 'Only administrators can complete clinic setup' }
      });
    }

    // Get company from central database
    const company = await Company.findByPk(clinicId);

    if (!company) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic not found' }
      });
    }

    // Check if already completed
    if (company.setup_completed_at) {
      return res.json({
        success: true,
        data: {
          setupStatus: 'completed',
          setupCompletedAt: company.setup_completed_at,
          message: 'Setup was already completed'
        }
      });
    }

    // Verify all required steps are complete
    let allStepsComplete = true;
    const missingSteps = [];

    // Check clinic info
    if (!company.name || !company.email) {
      allStepsComplete = false;
      missingSteps.push('clinic');
    }

    // Check teams
    try {
      const [teams] = await req.clinicDb.query(`
        SELECT COUNT(*) as count FROM teams WHERE is_active = true
      `);
      if (parseInt(teams[0].count) === 0) {
        allStepsComplete = false;
        missingSteps.push('team');
      }
    } catch (e) {
      allStepsComplete = false;
      missingSteps.push('team');
    }

    // Check healthcare providers
    try {
      const [providers] = await req.clinicDb.query(`
        SELECT COUNT(*) as count FROM healthcare_providers WHERE is_active = true
      `);
      if (parseInt(providers[0].count) === 0) {
        allStepsComplete = false;
        missingSteps.push('practitioner');
      }
    } catch (e) {
      allStepsComplete = false;
      missingSteps.push('practitioner');
    }

    // If not all steps complete, return error with missing steps
    if (!allStepsComplete) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot complete setup - some steps are missing',
          missingSteps
        }
      });
    }

    // Mark setup as completed
    await company.update({
      setup_completed_at: new Date()
    });

    logger.info(`[clinicSetup] Setup completed for clinic: ${clinicId}`, {
      clinicId,
      userId: user.id,
      email: user.email
    });

    res.json({
      success: true,
      data: {
        setupStatus: 'completed',
        setupCompletedAt: company.setup_completed_at,
        message: 'Clinic setup completed successfully'
      }
    });

  } catch (error) {
    logger.error('[clinicSetup] Error completing setup:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to complete setup', details: error.message }
    });
  }
});

/**
 * POST /api/v1/clinic/skip-setup
 * Skip the setup process (for testing or special cases)
 * This marks setup as complete without validation
 *
 * Only available in development mode or for super_admin
 */
router.post('/skip-setup', async (req, res) => {
  try {
    const clinicId = req.clinicId;
    const user = req.user;
    const isDev = process.env.NODE_ENV === 'development';

    // Only super_admin or dev mode can skip
    if (user.role !== 'super_admin' && !isDev) {
      return res.status(403).json({
        success: false,
        error: { message: 'Cannot skip setup in production mode' }
      });
    }

    // Get company from central database
    const company = await Company.findByPk(clinicId);

    if (!company) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic not found' }
      });
    }

    // Mark setup as completed (skipped)
    await company.update({
      setup_completed_at: new Date()
    });

    logger.warn(`[clinicSetup] Setup SKIPPED for clinic: ${clinicId}`, {
      clinicId,
      userId: user.id,
      email: user.email,
      isDev
    });

    res.json({
      success: true,
      data: {
        setupStatus: 'completed',
        setupCompletedAt: company.setup_completed_at,
        message: 'Clinic setup skipped (marked as complete)',
        skipped: true
      }
    });

  } catch (error) {
    logger.error('[clinicSetup] Error skipping setup:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to skip setup', details: error.message }
    });
  }
});

module.exports = router;
