/**
 * Medical Facilities Routes
 * Gestion du profil de l'établissement (company settings)
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { updateFacilitySchema } = require('../base/clinicConfigSchemas');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');

// Configure multer for logo uploads
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/logos');
    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use clinic ID and timestamp for unique filename
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `logo_${req.clinicId}_${Date.now()}${ext}`;
    cb(null, filename);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB max
  },
  fileFilter: (req, file, cb) => {
    console.log('[facilities] fileFilter called, file:', file?.originalname, file?.mimetype);
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PNG, JPG, and WebP are allowed.'));
    }
  }
});

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('[facilities] Multer error:', err);
    return res.status(400).json({
      success: false,
      error: { message: `Upload error: ${err.message}`, code: err.code }
    });
  } else if (err) {
    console.error('[facilities] Upload error:', err);
    return res.status(400).json({
      success: false,
      error: { message: err.message }
    });
  }
  next();
};

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/facilities/current
 * Get current facility info (company profile)
 */
router.get('/current', async (req, res) => {
  try {
    const [facilities] = await req.clinicDb.query(`
      SELECT
        id, name, facility_type, facility_number, finess, siret, adeli, rpps,
        address_line1, address_line2, postal_code, city, country,
        phone, email, website,
        specialties, services, settings,
        timezone, language, logo_url,
        is_active, subscription_plan, subscription_expires_at,
        created_at, updated_at
      FROM medical_facilities
      WHERE id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    if (facilities.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Facility not found' }
      });
    }

    res.json({
      success: true,
      data: facilities[0]
    });
  } catch (error) {
    console.error('[facilities] Error fetching facility:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch facility', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/facilities/current
 * Update current facility (company profile)
 */
router.put('/current', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = updateFacilitySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // Build SET clause dynamically
    const updates = [];
    const replacements = { clinicId: req.clinicId };

    Object.keys(value).forEach(key => {
      if (key === 'specialties' || key === 'services') {
        // Stringify JSONB arrays
        updates.push(`${key} = :${key}`);
        replacements[key] = JSON.stringify(value[key]);
      } else {
        updates.push(`${key} = :${key}`);
        replacements[key] = value[key];
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No fields to update' }
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const [result] = await req.clinicDb.query(`
      UPDATE medical_facilities
      SET ${updates.join(', ')}
      WHERE id = :clinicId
      RETURNING
        id, name, facility_type, facility_number, finess, siret, adeli, rpps,
        address_line1, address_line2, postal_code, city, country,
        phone, email, website,
        specialties, services,
        timezone, language, logo_url,
        is_active, created_at, updated_at
    `, { replacements });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Facility not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Facility updated successfully'
    });
  } catch (error) {
    console.error('[facilities] Error updating facility:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update facility', details: error.message }
    });
  }
});

/**
 * POST /api/v1/facilities/current/logo
 * Upload facility logo
 */
router.post('/current/logo', logoUpload.single('logo'), handleMulterError, async (req, res) => {
  try {
    console.log('[facilities] Logo upload request received');
    console.log('[facilities] req.file:', req.file);
    console.log('[facilities] req.body:', req.body);
    console.log('[facilities] Content-Type:', req.headers['content-type']);
    console.log('[facilities] clinicId:', req.clinicId);

    if (!req.file) {
      console.log('[facilities] No file in request');
      return res.status(400).json({
        success: false,
        error: { message: 'No file uploaded' }
      });
    }

    // Build the logo URL
    const logoUrl = `/uploads/logos/${req.file.filename}`;

    // Update the facility with the new logo URL
    const [result] = await req.clinicDb.query(`
      UPDATE medical_facilities
      SET logo_url = :logoUrl, updated_at = CURRENT_TIMESTAMP
      WHERE id = :clinicId
      RETURNING id, logo_url, updated_at
    `, { replacements: { logoUrl, clinicId: req.clinicId } });

    if (result.length === 0) {
      // Clean up uploaded file if facility not found
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        error: { message: 'Facility not found' }
      });
    }

    // Delete old logo if it exists and is different
    const [oldFacility] = await req.clinicDb.query(`
      SELECT logo_url FROM medical_facilities WHERE id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    // Note: The old logo cleanup would need to happen before the update
    // For simplicity, we'll keep old logos for now

    res.json({
      success: true,
      data: {
        logo_url: logoUrl
      },
      message: 'Logo uploaded successfully'
    });
  } catch (error) {
    console.error('[facilities] Error uploading logo:', error);
    // Clean up uploaded file on error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('[facilities] Error cleaning up file:', unlinkError);
      }
    }
    res.status(500).json({
      success: false,
      error: { message: 'Failed to upload logo', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/facilities/current/logo
 * Remove facility logo
 */
router.delete('/current/logo', async (req, res) => {
  try {
    // Get current logo URL
    const [facilities] = await req.clinicDb.query(`
      SELECT logo_url FROM medical_facilities WHERE id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    if (facilities.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Facility not found' }
      });
    }

    const oldLogoUrl = facilities[0].logo_url;

    // Update facility to remove logo URL
    await req.clinicDb.query(`
      UPDATE medical_facilities
      SET logo_url = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    // Delete old logo file if it exists
    if (oldLogoUrl) {
      const oldFilePath = path.join(__dirname, '../..', oldLogoUrl);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    res.json({
      success: true,
      message: 'Logo removed successfully'
    });
  } catch (error) {
    console.error('[facilities] Error removing logo:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to remove logo', details: error.message }
    });
  }
});

module.exports = router;
