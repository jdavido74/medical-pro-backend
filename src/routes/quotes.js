/**
 * Quotes Routes - DEPRECATED (Legacy)
 * Use /api/v1/documents with documentType='quote' instead
 *
 * This route is maintained for backward compatibility only.
 * New code should use the unified documents route which supports both invoices and quotes
 * with a single documentType discriminator field.
 *
 * NOTE: This route DOES NOT use clinic isolation yet (using old company_id model)
 * Migration to clinic isolation pending.
 *
 * Legacy conversion endpoint (/:id/convert) should be replaced with:
 * POST /api/v1/documents/:id/convert-to-invoice (clinic-isolated)
 */

const express = require('express');
const { Quote, Client, DocumentItem, Invoice } = require('../models');
const { logger } = require('../utils/logger');
const Joi = require('joi');
const { validateQuery, schemas } = require('../utils/validationSchemas');

const router = express.Router();

// Schema similaire aux invoices mais avec des champs spécifiques aux devis
const quoteSchema = Joi.object({
  clientId: Joi.string().uuid().required(),
  number: Joi.string().max(50).optional(),
  quoteDate: Joi.date().required(),
  validUntil: Joi.date().optional(),
  subtotal: Joi.number().precision(2).min(0).required(),
  discountType: Joi.string().valid('percentage', 'amount', 'none').optional(),
  discountValue: Joi.number().precision(2).min(0).optional(),
  taxAmount: Joi.number().precision(2).min(0).required(),
  total: Joi.number().precision(2).min(0).required(),
  currency: Joi.string().valid('EUR', 'USD', 'GBP', 'CHF').default('EUR'),
  notes: Joi.string().max(1000).optional(),
  terms: Joi.string().max(500).optional(),
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
 * @route GET /api/v1/quotes
 * @desc Get all quotes for company
 * @access Private
 */
router.get('/', validateQuery(schemas.pagination), async (req, res, next) => {
  try {
    const { page, limit, status, clientId, search } = req.query;
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

    const { count, rows: quotes } = await Quote.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Client,
          as: 'client',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ],
      order: [['quote_date', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: {
        quotes,
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
 * @route POST /api/v1/quotes
 * @desc Create new quote
 * @access Private
 */
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = quoteSchema.validate(req.body);
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
      let quoteNumber = value.number;
      if (!quoteNumber) {
        const count = await Quote.count({
          where: { company_id: req.user.companyId },
          transaction: t
        });
        quoteNumber = `DV-${String(count + 1).padStart(4, '0')}`;
      }

      // Créer le devis
      const quote = await Quote.create({
        company_id: req.user.companyId,
        client_id: value.clientId,
        number: quoteNumber,
        quote_date: value.quoteDate,
        valid_until: value.validUntil,
        subtotal: value.subtotal,
        discount_type: value.discountType,
        discount_value: value.discountValue,
        tax_amount: value.taxAmount,
        total: value.total,
        currency: value.currency,
        notes: value.notes,
        terms: value.terms
      }, { transaction: t });

      // Créer les items
      if (value.items && value.items.length > 0) {
        await DocumentItem.bulkCreateForDocument(
          quote.id,
          'quote',
          value.items,
          t
        );
      }

      return quote;
    });

    logger.info(`Quote created: ${result.number}`, {
      quoteId: result.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: { quote: result },
      message: 'Quote created successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/quotes/:id/convert
 * @desc Convert quote to invoice
 * @access Private
 */
router.post('/:id/convert', async (req, res, next) => {
  try {
    const quote = await Quote.findOne({
      where: {
        id: req.params.id,
        company_id: req.user.companyId
      },
      include: [
        {
          model: DocumentItem,
          as: 'items',
          required: false
        }
      ]
    });

    if (!quote) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Quote not found'
        }
      });
    }

    if (!quote.canBeConverted()) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot convert quote',
          details: 'Only sent or accepted quotes can be converted'
        }
      });
    }

    const { sequelize } = require('../config/database');

    const result = await sequelize.transaction(async (t) => {
      // Générer numéro de facture
      const invoiceCount = await Invoice.count({
        where: { company_id: req.user.companyId },
        transaction: t
      });
      const invoiceNumber = `FA-${String(invoiceCount + 1).padStart(4, '0')}`;

      // Créer la facture
      const invoice = await Invoice.create({
        company_id: req.user.companyId,
        client_id: quote.client_id,
        number: invoiceNumber,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 jours
        subtotal: quote.subtotal,
        discount_type: quote.discount_type,
        discount_value: quote.discount_value,
        tax_amount: quote.tax_amount,
        total: quote.total,
        currency: quote.currency,
        notes: `Facture générée à partir du devis ${quote.number}`,
        status: 'draft'
      }, { transaction: t });

      // Copier les items
      if (quote.items && quote.items.length > 0) {
        await DocumentItem.copyFromDocument(
          quote.id,
          'quote',
          invoice.id,
          'invoice',
          t
        );
      }

      // Mettre à jour le devis
      await quote.update({
        status: 'converted',
        converted_invoice_id: invoice.id,
        converted_at: new Date()
      }, { transaction: t });

      return { invoice, quote };
    });

    logger.info(`Quote converted to invoice: ${quote.number} -> ${result.invoice.number}`, {
      quoteId: quote.id,
      invoiceId: result.invoice.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.json({
      success: true,
      data: {
        invoice: result.invoice,
        quote: result.quote
      },
      message: 'Quote converted to invoice successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/quotes/stats
 * @desc Get quote statistics
 * @access Private
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [statusStats, conversionStats] = await Promise.all([
      Quote.getTotalsByStatus(req.user.companyId),
      Quote.getConversionStats(req.user.companyId, 'month')
    ]);

    res.json({
      success: true,
      data: {
        byStatus: statusStats,
        conversion: conversionStats
      }
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;