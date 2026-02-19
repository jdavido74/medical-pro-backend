/**
 * Medications Routes - CIMA Integration + Custom Medications
 * Search, detail, posology, interactions, contraindications
 * Custom medication CRUD for clinic-specific entries
 */

const express = require('express');
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');
const { getMedicationProvider } = require('../services/medication/medicationProviderFactory');
const { getPermissionsFromClinicRoles } = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionConstants');

const router = express.Router();

// Validation schemas
const createCustomMedicationSchema = Joi.object({
  name: Joi.string().max(500).required(),
  active_ingredients: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    amount: Joi.string().allow('').optional(),
    unit: Joi.string().allow('').optional()
  })).default([]),
  dosage: Joi.string().max(200).allow('', null).optional(),
  pharmaceutical_form: Joi.string().max(200).allow('', null).optional(),
  administration_routes: Joi.array().items(Joi.string()).default([]),
  atc_code: Joi.string().max(20).allow('', null).optional(),
  notes: Joi.string().allow('', null).optional()
});

const updateCustomMedicationSchema = Joi.object({
  name: Joi.string().max(500).optional(),
  active_ingredients: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    amount: Joi.string().allow('').optional(),
    unit: Joi.string().allow('').optional()
  })).optional(),
  dosage: Joi.string().max(200).allow('', null).optional(),
  pharmaceutical_form: Joi.string().max(200).allow('', null).optional(),
  administration_routes: Joi.array().items(Joi.string()).optional(),
  atc_code: Joi.string().max(20).allow('', null).optional(),
  notes: Joi.string().allow('', null).optional()
});

/**
 * Check if user has permission
 */
async function hasPermission(req, permission) {
  const user = req.user;
  if (!user) return false;
  if (user.role === 'super_admin') return true;

  const clinicPermissions = await getPermissionsFromClinicRoles(req);
  return clinicPermissions.includes(permission);
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────

/**
 * GET /search?q=ibuprofeno&limit=20
 * Combined search: custom medications first, then CIMA results
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ results: [], total: 0 });
    }

    const maxLimit = Math.min(parseInt(limit) || 20, 50);
    const facilityId = req.user?.facilityId;

    // Run CIMA and custom searches in parallel
    const provider = getMedicationProvider('ES');
    const [cimaResults, customResults] = await Promise.all([
      provider ? provider.search(q, { limit: maxLimit }) : [],
      searchCustomMedications(req.clinicDb, facilityId, q, maxLimit)
    ]);

    // Custom medications first, then CIMA
    const results = [...customResults, ...cimaResults].slice(0, maxLimit);

    res.json({ results, total: results.length });
  } catch (error) {
    console.error('Medication search error:', error);
    res.status(500).json({ error: 'Error searching medications' });
  }
});

// ─── CIMA DETAIL ─────────────────────────────────────────────────────────────

/**
 * GET /cima/:nregistro
 * Full detail of a CIMA medication
 */
router.get('/cima/:nregistro', async (req, res) => {
  try {
    const provider = getMedicationProvider('ES');
    if (!provider) {
      return res.status(404).json({ error: 'Medication provider not available' });
    }

    const detail = await provider.getDetail(req.params.nregistro);
    if (!detail) {
      return res.status(404).json({ error: 'Medication not found' });
    }

    res.json(detail);
  } catch (error) {
    console.error('CIMA detail error:', error);
    res.status(500).json({ error: 'Error fetching medication detail' });
  }
});

/**
 * GET /cima/:nregistro/posology
 * Posology section (4.2) as HTML
 */
router.get('/cima/:nregistro/posology', async (req, res) => {
  try {
    const provider = getMedicationProvider('ES');
    if (!provider) {
      return res.status(404).json({ error: 'Medication provider not available' });
    }

    const html = await provider.getPosology(req.params.nregistro);
    if (!html) {
      return res.status(404).json({ error: 'Posology data not available' });
    }

    res.json({ nregistro: req.params.nregistro, section: '4.2', content: html });
  } catch (error) {
    console.error('CIMA posology error:', error);
    res.status(500).json({ error: 'Error fetching posology' });
  }
});

/**
 * GET /cima/:nregistro/interactions
 * Interactions section (4.5) as HTML
 */
router.get('/cima/:nregistro/interactions', async (req, res) => {
  try {
    const provider = getMedicationProvider('ES');
    if (!provider) {
      return res.status(404).json({ error: 'Medication provider not available' });
    }

    const html = await provider.getInteractions(req.params.nregistro);
    if (!html) {
      return res.status(404).json({ error: 'Interactions data not available' });
    }

    res.json({ nregistro: req.params.nregistro, section: '4.5', content: html });
  } catch (error) {
    console.error('CIMA interactions error:', error);
    res.status(500).json({ error: 'Error fetching interactions' });
  }
});

/**
 * GET /cima/:nregistro/contraindications
 * Contraindications section (4.3) as HTML
 */
router.get('/cima/:nregistro/contraindications', async (req, res) => {
  try {
    const provider = getMedicationProvider('ES');
    if (!provider) {
      return res.status(404).json({ error: 'Medication provider not available' });
    }

    const html = await provider.getContraindications(req.params.nregistro);
    if (!html) {
      return res.status(404).json({ error: 'Contraindications data not available' });
    }

    res.json({ nregistro: req.params.nregistro, section: '4.3', content: html });
  } catch (error) {
    console.error('CIMA contraindications error:', error);
    res.status(500).json({ error: 'Error fetching contraindications' });
  }
});

// ─── INTERACTIONS CHECK ──────────────────────────────────────────────────────

/**
 * POST /interactions-check
 * Check interactions for a list of medications
 * Body: { medications: [{ nregistro, name }] }
 */
router.post('/interactions-check', async (req, res) => {
  try {
    const { medications } = req.body;

    if (!medications || !Array.isArray(medications) || medications.length < 2) {
      return res.json({ interactions: [], message: 'At least 2 medications required' });
    }

    const provider = getMedicationProvider('ES');
    if (!provider) {
      return res.json({ interactions: [], message: 'Provider not available' });
    }

    // Fetch interaction data for each CIMA medication
    const cimaMediactions = medications.filter(m => m.nregistro);
    const interactionsData = await Promise.all(
      cimaMediactions.map(async (med) => {
        const html = await provider.getInteractions(med.nregistro);
        return { nregistro: med.nregistro, name: med.name, interactionsHtml: html };
      })
    );

    res.json({
      interactions: interactionsData.filter(d => d.interactionsHtml),
      checkedCount: cimaMediactions.length
    });
  } catch (error) {
    console.error('Interactions check error:', error);
    res.status(500).json({ error: 'Error checking interactions' });
  }
});

// ─── CUSTOM MEDICATIONS CRUD ─────────────────────────────────────────────────

/**
 * GET /custom
 * List custom medications for the clinic
 */
router.get('/custom', async (req, res) => {
  try {
    const CustomMedication = await getModel(req.clinicDb, 'CustomMedication');
    const facilityId = req.user?.facilityId;

    const medications = await CustomMedication.findAll({
      where: { facility_id: facilityId, is_active: true },
      order: [['name', 'ASC']]
    });

    res.json(medications);
  } catch (error) {
    console.error('Custom medications list error:', error);
    res.status(500).json({ error: 'Error fetching custom medications' });
  }
});

/**
 * POST /custom
 * Create a custom medication
 */
router.post('/custom', async (req, res) => {
  try {
    const canCreate = await hasPermission(req, PERMISSIONS.MEDICAL_PRESCRIPTIONS_CREATE);
    if (!canCreate) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { error, value } = createCustomMedicationSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const CustomMedication = await getModel(req.clinicDb, 'CustomMedication');

    const medication = await CustomMedication.create({
      ...value,
      facility_id: req.user.facilityId,
      created_by: req.user.id
    });

    res.status(201).json(medication);
  } catch (error) {
    console.error('Custom medication create error:', error);
    res.status(500).json({ error: 'Error creating custom medication' });
  }
});

/**
 * PUT /custom/:id
 * Update a custom medication
 */
router.put('/custom/:id', async (req, res) => {
  try {
    const canCreate = await hasPermission(req, PERMISSIONS.MEDICAL_PRESCRIPTIONS_CREATE);
    if (!canCreate) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { error, value } = updateCustomMedicationSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const CustomMedication = await getModel(req.clinicDb, 'CustomMedication');

    const medication = await CustomMedication.findOne({
      where: { id: req.params.id, facility_id: req.user.facilityId }
    });

    if (!medication) {
      return res.status(404).json({ error: 'Custom medication not found' });
    }

    await medication.update(value);
    res.json(medication);
  } catch (error) {
    console.error('Custom medication update error:', error);
    res.status(500).json({ error: 'Error updating custom medication' });
  }
});

/**
 * DELETE /custom/:id
 * Soft-delete a custom medication (is_active=false)
 */
router.delete('/custom/:id', async (req, res) => {
  try {
    const canCreate = await hasPermission(req, PERMISSIONS.MEDICAL_PRESCRIPTIONS_CREATE);
    if (!canCreate) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const CustomMedication = await getModel(req.clinicDb, 'CustomMedication');

    const medication = await CustomMedication.findOne({
      where: { id: req.params.id, facility_id: req.user.facilityId }
    });

    if (!medication) {
      return res.status(404).json({ error: 'Custom medication not found' });
    }

    await medication.update({ is_active: false });
    res.json({ message: 'Custom medication deactivated' });
  } catch (error) {
    console.error('Custom medication delete error:', error);
    res.status(500).json({ error: 'Error deleting custom medication' });
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function searchCustomMedications(clinicDb, facilityId, query, limit) {
  try {
    if (!facilityId) return [];
    const CustomMedication = await getModel(clinicDb, 'CustomMedication');
    const results = await CustomMedication.searchByName(facilityId, query, limit);
    return results.map(m => m.toNormalized());
  } catch (error) {
    console.error('Custom medication search error:', error);
    return [];
  }
}

module.exports = router;
