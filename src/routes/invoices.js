/**
 * Invoices Routes - DEPRECATED (Legacy)
 * Use /api/v1/documents with documentType='invoice' instead
 *
 * This route is maintained for backward compatibility only.
 * New code should use the unified documents route which supports both invoices and quotes
 * with a single documentType discriminator field.
 *
 * NOTE: This route DOES NOT use clinic isolation yet (using old company_id model)
 * Migration to clinic isolation pending.
 */

const express = require('express');
const { Invoice, Client, DocumentItem } = require('../models');
const { logger } = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Schema de validation pour la création/mise à jour de facture
const invoiceSchema = Joi.object({
  clientId: Joi.string().uuid().required(),
  number: Joi.string().max(50).optional(), // Auto-généré si non fourni
  issueDate: Joi.date().required(),
  dueDate: Joi.date().optional(),
  subtotal: Joi.number().precision(2).min(0).required(),
  discountType: Joi.string().valid('percentage', 'amount', 'none').optional(),
  discountValue: Joi.number().precision(2).min(0).optional(),
  taxAmount: Joi.number().precision(2).min(0).required(),
  total: Joi.number().precision(2).min(0).required(),
  currency: Joi.string().valid('EUR', 'USD', 'GBP', 'CHF').default('EUR'),
  notes: Joi.string().max(1000).optional(),
  paymentConditions: Joi.string().max(500).optional(),
  purchaseOrder: Joi.string().max(100).optional(),
  items: Joi.array().items(
    Joi.object({
      description: Joi.string().max(1000).required(),
      quantity: Joi.number().precision(3).min(0.001).required(),
      unitPrice: Joi.number().precision(2).min(0).required(),
      taxRate: Joi.number().precision(2).min(0).max(100).optional(),
      unit: Joi.string().max(20).optional()
    })
  ).min(1).required()
});

/**
 * @route GET /api/v1/invoices
 * @desc Get all invoices for company
 * @access Private
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, clientId, search } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {
      company_id: req.user.companyId
    };

    if (status) {
      whereClause.status = status;
    }

    if (clientId) {
      whereClause.client_id = clientId;
    }

    if (search) {
      const { Op } = require('sequelize');
      whereClause[Op.or] = [
        { number: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: invoices } = await Invoice.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Client,
          as: 'client',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ],
      order: [['issue_date', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(count / limit),
          count,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/invoices/:id
 * @desc Get invoice by ID with items
 * @access Private
 */
router.get('/:id', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: {
        id: req.params.id,
        company_id: req.user.companyId
      },
      include: [
        {
          model: Client,
          as: 'client',
          required: false
        },
        {
          model: DocumentItem,
          as: 'items',
          required: false
        }
      ]
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Invoice not found'
        }
      });
    }

    res.json({
      success: true,
      data: { invoice }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/invoices
 * @desc Create new invoice
 * @access Private
 */
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = invoiceSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(detail => detail.message).join(', ')
        }
      });
    }

    const { sequelize } = require('../config/database');

    const result = await sequelize.transaction(async (t) => {
      // Générer numéro si pas fourni
      let invoiceNumber = value.number;
      if (!invoiceNumber) {
        const count = await Invoice.count({
          where: { company_id: req.user.companyId },
          transaction: t
        });
        invoiceNumber = `FA-${String(count + 1).padStart(4, '0')}`;
      }

      // Créer la facture
      const invoice = await Invoice.create({
        company_id: req.user.companyId,
        client_id: value.clientId,
        number: invoiceNumber,
        issue_date: value.issueDate,
        due_date: value.dueDate,
        subtotal: value.subtotal,
        discount_type: value.discountType,
        discount_value: value.discountValue,
        tax_amount: value.taxAmount,
        total: value.total,
        currency: value.currency,
        notes: value.notes,
        payment_conditions: value.paymentConditions,
        purchase_order: value.purchaseOrder
      }, { transaction: t });

      // Créer les items
      if (value.items && value.items.length > 0) {
        await DocumentItem.bulkCreateForDocument(
          invoice.id,
          'invoice',
          value.items,
          t
        );
      }

      return invoice;
    });

    logger.info(`Invoice created: ${result.number}`, {
      invoiceId: result.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: { invoice: result },
      message: 'Invoice created successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/v1/invoices/:id
 * @desc Update invoice
 * @access Private
 */
router.put('/:id', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: {
        id: req.params.id,
        company_id: req.user.companyId
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Invoice not found'
        }
      });
    }

    if (!invoice.canBeModified()) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot modify invoice',
          details: 'Only draft invoices can be modified'
        }
      });
    }

    const { error, value } = invoiceSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(detail => detail.message).join(', ')
        }
      });
    }

    // Mise à jour en transaction
    const { sequelize } = require('../config/database');
    await sequelize.transaction(async (t) => {
      // Mettre à jour la facture
      await invoice.update({
        client_id: value.clientId,
        issue_date: value.issueDate,
        due_date: value.dueDate,
        subtotal: value.subtotal,
        discount_type: value.discountType,
        discount_value: value.discountValue,
        tax_amount: value.taxAmount,
        total: value.total,
        currency: value.currency,
        notes: value.notes,
        payment_conditions: value.paymentConditions,
        purchase_order: value.purchaseOrder
      }, { transaction: t });

      // Mettre à jour les items
      if (value.items) {
        await DocumentItem.updateItemsForDocument(
          invoice.id,
          'invoice',
          value.items,
          t
        );
      }
    });

    logger.info(`Invoice updated: ${invoice.number}`, {
      invoiceId: invoice.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.json({
      success: true,
      data: { invoice },
      message: 'Invoice updated successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/v1/invoices/:id
 * @desc Delete invoice
 * @access Private
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: {
        id: req.params.id,
        company_id: req.user.companyId
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Invoice not found'
        }
      });
    }

    if (!invoice.canBeModified()) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot delete invoice',
          details: 'Only draft invoices can be deleted'
        }
      });
    }

    await invoice.destroy();

    logger.info(`Invoice deleted: ${invoice.number}`, {
      invoiceId: invoice.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Invoice deleted successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/invoices/stats
 * @desc Get invoice statistics
 * @access Private
 */
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await Invoice.getTotalsByStatus(req.user.companyId);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;