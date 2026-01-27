/**
 * Migration: Create categories table
 * Categories are reusable across the SaaS (products, services, etc.)
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('categories', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      slug: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      color: {
        type: Sequelize.STRING(7),
        allowNull: false,
        defaultValue: '#6B7280'
      },
      icon: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      // Category type for filtering (product, service, appointment, etc.)
      type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'product'
      },
      // For hierarchical categories (optional)
      parent_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'categories',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      // Display order
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      // Tenant isolation
      company_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Indexes
    await queryInterface.addIndex('categories', ['company_id']);
    await queryInterface.addIndex('categories', ['type']);
    await queryInterface.addIndex('categories', ['parent_id']);
    await queryInterface.addIndex('categories', ['company_id', 'type']);
    await queryInterface.addIndex('categories', ['company_id', 'slug'], {
      unique: true,
      where: { slug: { [Sequelize.Op.ne]: null } }
    });

    // Add category_id to products_services table
    await queryInterface.addColumn('products_services', 'category_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'categories',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addIndex('products_services', ['category_id']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('products_services', 'category_id');
    await queryInterface.dropTable('categories');
  }
};
