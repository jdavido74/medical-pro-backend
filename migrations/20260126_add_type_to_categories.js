/**
 * Migration: Add type and sort_order fields to categories table
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('categories');

    // Add type column if it doesn't exist
    if (!tableInfo.type) {
      await queryInterface.addColumn('categories', 'type', {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'product'
      });
      await queryInterface.addIndex('categories', ['type']);
      await queryInterface.addIndex('categories', ['company_id', 'type']);
    }

    // Add sort_order column if it doesn't exist
    if (!tableInfo.sort_order) {
      await queryInterface.addColumn('categories', 'sort_order', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('categories', 'type');
    await queryInterface.removeColumn('categories', 'sort_order');
  }
};
