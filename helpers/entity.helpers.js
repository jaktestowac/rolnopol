const { logDebug } = require("./logger-api");

// ID logic will be replaced with numeric auto-increment (to be added)

/**
 * Update entity timestamps
 * @param {Object} entity - The entity to update
 * @returns {Object} - Entity with updated timestamp
 */
function updateEntityTimestamp(entity) {
  return {
    ...entity,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Filter out internal fields from entity for user-facing responses
 * @param {Object} entity - The entity to filter
 * @param {boolean} isAdmin - Whether this is an admin response
 * @returns {Object} - Filtered entity
 */
function filterEntityForResponse(entity, isAdmin = false) {
  if (isAdmin) {
    return entity; // Return all fields for admin
  }

  // Remove internalId for user-facing responses
  const { internalId, ...filteredEntity } = entity;
  return filteredEntity;
}

/**
 * Filter out internal fields from array of entities
 * @param {Array} entities - Array of entities to filter
 * @param {boolean} isAdmin - Whether this is an admin response
 * @returns {Array} - Filtered entities
 */
function filterEntitiesForResponse(entities, isAdmin = false) {
  if (!Array.isArray(entities)) {
    return entities;
  }

  return entities.map((entity) => filterEntityForResponse(entity, isAdmin));
}

module.exports = {
  updateEntityTimestamp,
  filterEntityForResponse,
  filterEntitiesForResponse,
};
