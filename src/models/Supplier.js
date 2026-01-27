const { DataTypes } = require('sequelize');

/**
 * Supplier model factory
 * Represents vendors/suppliers for products and services
 * @param {Sequelize} sequelize - Database Sequelize instance
 */
module.exports = (sequelize) => {
  const Supplier = sequelize.define('Supplier', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    // Multi-tenant
    company_id: {
      type: DataTypes.UUID,
      allowNull: false
    },

    // Basic info
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 200]
      }
    },

    // Address fields
    address_line1: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    address_line2: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    postal_code: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    country_code: {
      type: DataTypes.CHAR(2),
      allowNull: true,
      validate: {
        len: [2, 2],
        isUppercase: true
      }
    },

    // Contact information
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    website: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    // Primary contact person
    contact_name: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    contact_email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    contact_phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Additional info
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    tax_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Status
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },

    // Timestamps
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'suppliers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      { fields: ['company_id'] },
      { fields: ['name'] },
      { fields: ['country_code'] },
      { fields: ['is_active'] }
    ]
  });

  // ============================================
  // STATIC METHODS
  // ============================================

  /**
   * Find all active suppliers for a company
   */
  Supplier.findActive = async function(companyId, options = {}) {
    return await this.findAll({
      where: {
        company_id: companyId,
        is_active: true,
        ...options.where
      },
      order: [['name', 'ASC']],
      ...options
    });
  };

  /**
   * Search suppliers by name, email or contact
   */
  Supplier.search = async function(companyId, searchTerm, options = {}) {
    const { Op } = require('sequelize');
    const term = `%${searchTerm}%`;

    return await this.findAll({
      where: {
        company_id: companyId,
        is_active: true,
        [Op.or]: [
          { name: { [Op.iLike]: term } },
          { email: { [Op.iLike]: term } },
          { contact_name: { [Op.iLike]: term } },
          { city: { [Op.iLike]: term } },
          { country: { [Op.iLike]: term } }
        ]
      },
      order: [['name', 'ASC']],
      limit: options.limit || 20,
      ...options
    });
  };

  /**
   * Get formatted address
   */
  Supplier.prototype.getFormattedAddress = function() {
    const parts = [];
    if (this.address_line1) parts.push(this.address_line1);
    if (this.address_line2) parts.push(this.address_line2);

    const cityLine = [this.postal_code, this.city].filter(Boolean).join(' ');
    if (cityLine) parts.push(cityLine);

    if (this.state) parts.push(this.state);
    if (this.country) parts.push(this.country);

    return parts.join(', ');
  };

  /**
   * Transform to API format (camelCase)
   */
  Supplier.prototype.toApiFormat = function() {
    return {
      id: this.id,
      companyId: this.company_id,
      name: this.name,
      // Address
      addressLine1: this.address_line1,
      addressLine2: this.address_line2,
      city: this.city,
      postalCode: this.postal_code,
      state: this.state,
      country: this.country,
      countryCode: this.country_code,
      formattedAddress: this.getFormattedAddress(),
      // Contact
      phone: this.phone,
      email: this.email,
      website: this.website,
      // Contact person
      contactName: this.contact_name,
      contactEmail: this.contact_email,
      contactPhone: this.contact_phone,
      // Additional
      notes: this.notes,
      taxId: this.tax_id,
      isActive: this.is_active,
      // Timestamps
      createdAt: this.created_at,
      updatedAt: this.updated_at
    };
  };

  return Supplier;
};

/**
 * Transform supplier data from API format to DB format
 * Reusable utility function
 * @param {Object} data - API format data (camelCase)
 * @returns {Object} DB format data (snake_case)
 */
module.exports.transformSupplierToDb = (data) => {
  const dbData = {};

  // Map camelCase to snake_case
  const fieldMap = {
    companyId: 'company_id',
    name: 'name',
    addressLine1: 'address_line1',
    addressLine2: 'address_line2',
    city: 'city',
    postalCode: 'postal_code',
    state: 'state',
    country: 'country',
    countryCode: 'country_code',
    phone: 'phone',
    email: 'email',
    website: 'website',
    contactName: 'contact_name',
    contactEmail: 'contact_email',
    contactPhone: 'contact_phone',
    notes: 'notes',
    taxId: 'tax_id',
    isActive: 'is_active'
  };

  for (const [apiKey, dbKey] of Object.entries(fieldMap)) {
    if (data[apiKey] !== undefined) {
      dbData[dbKey] = data[apiKey];
    }
  }

  return dbData;
};

/**
 * Transform supplier data from DB format to API format
 * Reusable utility function
 * @param {Object} data - DB format data (snake_case or model instance)
 * @returns {Object} API format data (camelCase)
 */
module.exports.transformSupplierToApi = (data) => {
  if (!data) return null;

  const raw = data.toJSON ? data.toJSON() : data;

  // Build formatted address
  const addressParts = [];
  if (raw.address_line1) addressParts.push(raw.address_line1);
  if (raw.address_line2) addressParts.push(raw.address_line2);
  const cityLine = [raw.postal_code, raw.city].filter(Boolean).join(' ');
  if (cityLine) addressParts.push(cityLine);
  if (raw.state) addressParts.push(raw.state);
  if (raw.country) addressParts.push(raw.country);

  return {
    id: raw.id,
    companyId: raw.company_id,
    name: raw.name,
    // Address
    addressLine1: raw.address_line1,
    addressLine2: raw.address_line2,
    city: raw.city,
    postalCode: raw.postal_code,
    state: raw.state,
    country: raw.country,
    countryCode: raw.country_code,
    formattedAddress: addressParts.join(', '),
    // Contact
    phone: raw.phone,
    email: raw.email,
    website: raw.website,
    // Contact person
    contactName: raw.contact_name,
    contactEmail: raw.contact_email,
    contactPhone: raw.contact_phone,
    // Additional
    notes: raw.notes,
    taxId: raw.tax_id,
    isActive: raw.is_active,
    // Timestamps
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
};
