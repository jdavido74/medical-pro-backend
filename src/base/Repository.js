/**
 * Base Repository for Clinic-Specific Database Operations
 *
 * Purpose: Abstract away database connection logic
 * All models use this base to ensure they query the correct clinic database
 *
 * Usage:
 * class PatientRepository extends Repository {
 *   static MODEL = Patient;
 *
 *   async getPatients(clinicDb, filters) {
 *     return this.findAll(clinicDb, filters);
 *   }
 * }
 *
 * // In route handler:
 * const patients = await PatientRepository.getPatients(req.clinicDb, filters);
 */

class Repository {
  // Must be overridden in subclasses
  static MODEL = null;

  /**
   * Validate that model is defined
   * @private
   */
  static validateModel() {
    if (!this.MODEL) {
      throw new Error(`${this.constructor.name} must define static MODEL`);
    }
  }

  /**
   * Find all records
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Object} options - Query options (where, include, limit, offset, etc)
   * @returns {Promise<Array>} - Array of records
   */
  static async findAll(clinicDb, options = {}) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const result = await model.findAll({
        where: options.where || {},
        include: options.include || [],
        limit: options.limit || undefined,
        offset: options.offset || undefined,
        order: options.order || [['createdAt', 'DESC']],
        subQuery: false,
        raw: options.raw || false
      });

      return result;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.findAll: ${error.message}`);
    }
  }

  /**
   * Find one record by primary key
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string|UUID} id - Record ID
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} - Record or null
   */
  static async findById(clinicDb, id, options = {}) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const result = await model.findByPk(id, {
        include: options.include || [],
        raw: options.raw || false
      });

      return result;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.findById: ${error.message}`);
    }
  }

  /**
   * Find one record by custom filter
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Object} where - WHERE clause
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} - Record or null
   */
  static async findOne(clinicDb, where, options = {}) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const result = await model.findOne({
        where,
        include: options.include || [],
        raw: options.raw || false
      });

      return result;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.findOne: ${error.message}`);
    }
  }

  /**
   * Create a new record
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Object} data - Record data
   * @returns {Promise<Object>} - Created record
   */
  static async create(clinicDb, data) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const result = await model.create(data);

      return result;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.create: ${error.message}`);
    }
  }

  /**
   * Update record(s)
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Object} data - Updated data
   * @param {Object} where - WHERE clause
   * @returns {Promise<number>} - Number of rows updated
   */
  static async update(clinicDb, data, where) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const [count] = await model.update(data, { where });

      return count;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.update: ${error.message}`);
    }
  }

  /**
   * Delete record(s) (soft delete if available)
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Object} where - WHERE clause
   * @param {boolean} hardDelete - Force hard delete (default: false for soft delete)
   * @returns {Promise<number>} - Number of rows deleted
   */
  static async delete(clinicDb, where, hardDelete = false) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      if (hardDelete) {
        // Hard delete
        const count = await model.destroy({ where });
        return count;
      } else {
        // Soft delete
        const count = await this.update(clinicDb, { deletedAt: new Date() }, where);
        return count;
      }
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.delete: ${error.message}`);
    }
  }

  /**
   * Count records
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Object} where - WHERE clause
   * @returns {Promise<number>} - Count of records
   */
  static async count(clinicDb, where = {}) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const count = await model.count({ where });

      return count;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.count: ${error.message}`);
    }
  }

  /**
   * Paginate records
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {number} page - Page number (1-indexed)
   * @param {number} limit - Records per page
   * @param {Object} options - Query options
   * @returns {Promise<{data, pagination}>} - Records + pagination metadata
   */
  static async paginate(clinicDb, page = 1, limit = 10, options = {}) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const offset = (page - 1) * limit;

      const { count, rows } = await model.findAndCountAll({
        where: options.where || {},
        include: options.include || [],
        limit,
        offset,
        order: options.order || [['createdAt', 'DESC']],
        subQuery: false,
        raw: options.raw || false
      });

      return {
        data: rows,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit),
          hasNextPage: page < Math.ceil(count / limit),
          hasPrevPage: page > 1
        }
      };
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.paginate: ${error.message}`);
    }
  }

  /**
   * Bulk create records
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Array} records - Array of records to create
   * @param {Object} options - Options (ignoreDuplicates, etc)
   * @returns {Promise<Array>} - Created records
   */
  static async bulkCreate(clinicDb, records, options = {}) {
    this.validateModel();

    try {
      const model = this.MODEL.init(clinicDb);

      const result = await model.bulkCreate(records, {
        ignoreDuplicates: options.ignoreDuplicates || false,
        validate: true
      });

      return result;
    } catch (error) {
      throw new Error(`Error in ${this.constructor.name}.bulkCreate: ${error.message}`);
    }
  }

  /**
   * Transaction support for multi-step operations
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Function} callback - Callback function that receives transaction
   * @returns {Promise<any>} - Result of callback
   *
   * Usage:
   * await PatientRepository.transaction(clinicDb, async (t) => {
   *   await Patient.create({...}, { transaction: t });
   *   await PatientFile.create({...}, { transaction: t });
   * });
   */
  static async transaction(clinicDb, callback) {
    try {
      const result = await clinicDb.transaction(async (t) => {
        return await callback(t);
      });

      return result;
    } catch (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }
}

module.exports = Repository;
