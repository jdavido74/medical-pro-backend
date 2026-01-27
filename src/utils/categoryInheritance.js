/**
 * Category Inheritance Utility
 * Handles category inheritance from parent to variants
 */

/**
 * Enriches items with inherited categories from their parents
 * @param {Array} items - Array of items (products/treatments)
 * @param {Function} getModel - Function to get Sequelize model
 * @param {Object} clinicDb - Clinic database connection
 * @returns {Promise<Map>} Map of item ID to effective categories
 */
async function buildCategoryInheritanceMap(items, getModel, clinicDb) {
  const ProductService = await getModel(clinicDb, 'ProductService');
  const Category = await getModel(clinicDb, 'Category');

  // Collect parent IDs for variants without categories
  const parentIdsToFetch = new Set();
  items.forEach(item => {
    const hasOwnCategories = item.categories && item.categories.length > 0;
    const isVariant = item.is_variant || item.isVariant;
    const parentId = item.parent_id || item.parentId;

    if (isVariant && parentId && !hasOwnCategories) {
      parentIdsToFetch.add(parentId);
    }
  });

  // Fetch parent categories if needed
  const parentCategoriesMap = {};
  if (parentIdsToFetch.size > 0) {
    const parents = await ProductService.findAll({
      where: { id: Array.from(parentIdsToFetch) },
      attributes: ['id'],
      include: [{
        model: Category,
        as: 'categories',
        attributes: ['id', 'name', 'color'],
        through: { attributes: [] }
      }]
    });
    parents.forEach(p => {
      if (p.categories && p.categories.length > 0) {
        parentCategoriesMap[p.id] = p.categories.map(c => ({
          id: c.id,
          name: c.name,
          color: c.color
        }));
      }
    });
  }

  return parentCategoriesMap;
}

/**
 * Gets effective categories for an item (own or inherited from parent)
 * @param {Object} item - The item to get categories for
 * @param {Object} parentCategoriesMap - Map of parent ID to categories
 * @returns {Array} Array of categories
 */
function getEffectiveCategories(item, parentCategoriesMap) {
  // Check for own categories (handle both raw and transformed data)
  const ownCategories = item.categories;
  if (ownCategories && ownCategories.length > 0) {
    return ownCategories.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color
    }));
  }

  // Inherit from parent if variant
  const isVariant = item.is_variant || item.isVariant;
  const parentId = item.parent_id || item.parentId;

  if (isVariant && parentId && parentCategoriesMap[parentId]) {
    return parentCategoriesMap[parentId];
  }

  return [];
}

/**
 * Enriches an array of items with effective categories
 * @param {Array} items - Array of items
 * @param {Function} getModel - Function to get Sequelize model
 * @param {Object} clinicDb - Clinic database connection
 * @returns {Promise<Array>} Items with effectiveCategories property added
 */
async function enrichItemsWithCategories(items, getModel, clinicDb) {
  const parentCategoriesMap = await buildCategoryInheritanceMap(items, getModel, clinicDb);

  return items.map(item => {
    const effectiveCategories = getEffectiveCategories(item, parentCategoriesMap);
    return {
      ...item,
      effectiveCategories,
      // Also update the categories property for backward compatibility
      categories: effectiveCategories.length > 0 ? effectiveCategories : (item.categories || [])
    };
  });
}

module.exports = {
  buildCategoryInheritanceMap,
  getEffectiveCategories,
  enrichItemsWithCategories
};
