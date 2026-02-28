const dbManager = require("../data/database-manager");
const { ALLOWED_ANIMAL_TYPES } = require("../data/animal-types");
const { logDebug, logInfo } = require("../helpers/logger-api");

class ResourceService {
  constructor(resourceType) {
    this.resourceType = resourceType; // 'fields', 'staff', or 'animals'
    if (resourceType === "fields") {
      this.db = dbManager.getFieldsDatabase();
    } else if (resourceType === "staff") {
      this.db = dbManager.getStaffDatabase();
    } else if (resourceType === "animals") {
      this.db = dbManager.getAnimalsDatabase();
    } else {
      throw new Error(`Unsupported resource type: ${resourceType}`);
    }
  }

  async getFieldsByUserId(userId) {
    // Find fields matching user ID
    const fields = await this.db.find((f) => {
      return f.userId === userId;
    });
    return fields;
  }

  // --- Districts aggregation for fields ---
  async listDistricts(userId, districtName) {
    logDebug("Listing districts for user:", {
      userId,
      districtName,
      resourceType: this.resourceType,
    });

    // Load fields for user (if provided), else all
    let fields = [];
    if (this.resourceType !== "fields") return [];

    if (userId !== undefined && userId !== null) {
      const userIdNum = Number(userId);
      fields = await this.db.find((f) => Number(f.userId) === userIdNum);
    } else {
      fields = await this.db.find(() => true);
    }

    // Aggregate by district name (case-insensitive, trimmed)
    const byDistrict = new Map(); // normName -> { name, fieldsCount, fieldsAreaHa }
    for (const f of fields) {
      const rawName = f.districtName || f.powiatName || f.countyName || f.district || "";
      if (typeof rawName !== "string") continue;
      logDebug("Processing field for district aggregation:", {
        fieldId: f.id,
        districtName: rawName,
      });
      const name = rawName.trim();
      if (!name) continue;
      const norm = name.toLowerCase();

      const area = Number(f.area) || 0;
      const agg = byDistrict.get(norm) || {
        name,
        fieldsCount: 0,
        fieldsAreaHa: 0,
      };
      // Keep the first encountered display name casing
      if (!agg.name) agg.name = name;
      agg.fieldsCount += 1;
      agg.fieldsAreaHa += area;
      byDistrict.set(norm, agg);
    }
    logDebug("District aggregation complete:", { byDistrict });

    // Build response object keyed by district name
    const resultObj = {};
    const list = Array.from(byDistrict.values()).sort((a, b) => a.name.localeCompare(b.name));
    for (const d of list) {
      resultObj[d.name] = {
        fieldsCount: d.fieldsCount,
        fieldsAreaHa: d.fieldsAreaHa,
      };
    }

    if (typeof districtName === "string" && districtName.trim()) {
      logDebug("Fetching district stats for:", districtName);
      const norm = districtName.trim().toLowerCase();
      const found = list.find((d) => d.name.toLowerCase() === norm);
      return found
        ? {
            districtName,
            fieldsCount: found.fieldsCount,
            fieldsAreaHa: found.fieldsAreaHa,
          }
        : { districtName, fieldsCount: 0, fieldsAreaHa: 0 };
    }

    return resultObj;
  }

  async list(userId) {
    // Convert userId to number for comparison with database
    const numericUserId = Number(userId);
    return await this.db.find((item) => item.userId === numericUserId);
  }

  async create(userId, data) {
    // Convert userId to number for storage
    const numericUserId = Number(userId);
    const newItem = { userId: numericUserId, ...data };
    await this.db.add(newItem);
    // The add() method will assign the next numeric ID
    // Return the item with the assigned ID
    logDebug("Created new item:", { newItem });
    const items = await this.db.find((i) => i.userId === numericUserId);
    return items[items.length - 1];
  }

  async delete(userId, id) {
    // Convert userId and id to numbers for comparison
    const numericUserId = Number(userId);
    const numericId = Number(id);

    if (isNaN(numericUserId) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
      throw new Error("Invalid user ID format");
    }
    if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
      throw new Error("Invalid resource ID format");
    }

    await this.db.remove((item) => item.userId === numericUserId && item.id === numericId);
    // Cascade delete related assignments
    if (this.resourceType === "fields") {
      await ResourceService.cascadeDelete({ type: "field", id: numericId });
    } else if (this.resourceType === "staff") {
      await ResourceService.cascadeDelete({ type: "staff", id: numericId });
    } else if (this.resourceType === "animals") {
      await ResourceService.cascadeDelete({ type: "animal", id: numericId });
    }
    return true;
  }

  async update(userId, id, updateData) {
    // Convert userId and id to numbers for comparison
    const numericUserId = Number(userId);
    const numericId = Number(id);

    if (isNaN(numericUserId) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
      throw new Error("Invalid user ID format");
    }
    if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
      throw new Error("Invalid resource ID format");
    }

    const updatedArr = await this.db.updateRecords(
      (item) => item.userId === numericUserId && item.id === numericId,
      (item) => ({ ...item, ...updateData }),
    );
    // Return the updated item (if found)
    return Array.isArray(updatedArr) ? updatedArr.find((item) => item.userId === numericUserId && item.id === numericId) : null;
  }

  // --- Cascading delete logic ---
  /**
   * Delete all resources related to a user, field, or staff.
   * type: 'user' | 'field' | 'staff'
   * id: the id of the resource
   * userId: the userId (for user-level deletes)
   */
  static async cascadeDelete({ type, id, userId }) {
    // Load DBs using singleton instances
    const fieldsDb = dbManager.getFieldsDatabase();
    const staffDb = dbManager.getStaffDatabase();
    const animalsDb = dbManager.getAnimalsDatabase();
    const assignmentsDb = dbManager.getAssignmentsDatabase();

    if (type === "user") {
      // Convert userId to number for comparison
      const numericUserId = Number(userId);
      if (isNaN(numericUserId) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
        throw new Error("Invalid user ID format");
      }
      // Delete all fields, staff, animals, and assignments for this user
      await fieldsDb.update((data) => (Array.isArray(data) ? data.filter((f) => f.userId !== numericUserId) : data));
      await staffDb.update((data) => (Array.isArray(data) ? data.filter((s) => s.userId !== numericUserId) : data));
      await animalsDb.update((data) => (Array.isArray(data) ? data.filter((a) => a.userId !== numericUserId) : data));
      await assignmentsDb.update((data) => (Array.isArray(data) ? data.filter((a) => a.userId !== numericUserId) : data));
    } else if (type === "field") {
      // Convert field ID to number for comparison
      const numericId = Number(id);
      if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid field ID format");
      }
      // Delete all assignments for this field
      await assignmentsDb.update((data) => (Array.isArray(data) ? data.filter((a) => a.fieldId !== numericId) : data));
    } else if (type === "staff") {
      // Convert staff ID to number for comparison
      const numericId = Number(id);
      if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid staff ID format");
      }
      // Delete all assignments for this staff
      await assignmentsDb.update((data) => (Array.isArray(data) ? data.filter((a) => a.staffId !== numericId) : data));
    } else if (type === "animal") {
      // Convert animal ID to number for comparison
      const numericId = Number(id);
      if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid animal ID format");
      }
      // For animals, we might want to handle field assignments differently
      // Currently, animals can be assigned to fields, so we update the fieldId to null/undefined
      await animalsDb.update((data) =>
        Array.isArray(data) ? data.map((a) => (a.id === numericId ? { ...a, fieldId: undefined } : a)) : data,
      );
    }
    // To extend: add more resource types here as needed
  }
}

const assignmentsDb = dbManager.getAssignmentsDatabase();

ResourceService.prototype.assignStaffToField = async function (userId, fieldId, staffId) {
  // Convert all IDs to numbers for storage and comparison
  const numericUserId = Number(userId);
  const numericFieldId = Number(fieldId);
  const numericStaffId = Number(staffId);

  if (isNaN(numericUserId) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new Error("Invalid user ID format");
  }
  if (isNaN(numericFieldId) || !Number.isInteger(numericFieldId) || numericFieldId <= 0) {
    throw new Error("Invalid field ID format");
  }
  if (isNaN(numericStaffId) || !Number.isInteger(numericStaffId) || numericStaffId <= 0) {
    throw new Error("Invalid staff ID format");
  }

  const newAssignment = {
    userId: numericUserId,
    fieldId: numericFieldId,
    staffId: numericStaffId,
    createdAt: new Date().toISOString(),
  };
  await assignmentsDb.add(newAssignment);
  // The add() method will assign the next numeric ID
  // Return the assignment with the assigned ID
  const assignments = await assignmentsDb.find(
    (a) => a.userId === numericUserId && a.fieldId === numericFieldId && a.staffId === numericStaffId,
  );
  return assignments[assignments.length - 1];
};

ResourceService.prototype.listAssignments = async function (userId) {
  // Convert userId to number for comparison
  const numericUserId = Number(userId);
  return await assignmentsDb.find((a) => a.userId === numericUserId);
};

ResourceService.prototype.removeAssignment = async function (userId, assignmentId) {
  // Convert userId and assignmentId to numbers for comparison
  const numericUserId = Number(userId);
  const numericAssignmentId = Number(assignmentId);

  if (isNaN(numericUserId) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new Error("Invalid user ID format");
  }
  if (isNaN(numericAssignmentId) || !Number.isInteger(numericAssignmentId) || numericAssignmentId <= 0) {
    throw new Error("Invalid assignment ID format");
  }

  await assignmentsDb.remove((a) => a.userId === numericUserId && a.id === numericAssignmentId);
  return true;
};

// --- Animal validation and creation ---

ResourceService.prototype.validateAnimal = function (data) {
  const errors = [];
  if (!data.type || !ALLOWED_ANIMAL_TYPES[data.type]) {
    const allowedTypes = Object.keys(ALLOWED_ANIMAL_TYPES).join(", ");
    errors.push(`Invalid animal type. Allowed: ${allowedTypes}.`);
  }
  // amount is required and must be a positive number
  if (!data.amount || isNaN(Number(data.amount)) || Number(data.amount) <= 0) {
    errors.push("Amount must be a positive number.");
  }
  // fieldId is optional, but if present must be a number
  if (data.fieldId !== undefined && data.fieldId !== null && isNaN(Number(data.fieldId))) {
    errors.push("fieldId must be a number if provided.");
  }
  return errors;
};

ResourceService.prototype.createAnimal = async function (userId, data) {
  const errors = this.validateAnimal(data);
  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.status = 400;
    throw err;
  }
  // Convert userId to number for storage
  const numericUserId = Number(userId);
  const animal = {
    userId: numericUserId,
    type: data.type,
    amount: Number(data.amount),
    fieldId: data.fieldId !== undefined ? Number(data.fieldId) : undefined,
    createdAt: new Date().toISOString(),
  };
  await this.db.add(animal);
  const items = await this.db.find((i) => i.userId === numericUserId);
  return items[items.length - 1];
};

ResourceService.prototype.updateAnimal = async function (userId, id, updateData) {
  // Convert userId and id to numbers for comparison
  const numericUserId = Number(userId);
  const numericId = Number(id);

  if (isNaN(numericUserId) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new Error("Invalid user ID format");
  }
  if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Invalid animal ID format");
  }

  // For partial updates, we need to validate only the fields being updated
  const errors = [];

  // Validate type if it's being updated
  if (updateData.type !== undefined && (!updateData.type || !ALLOWED_ANIMAL_TYPES[updateData.type])) {
    const allowedTypes = Object.keys(ALLOWED_ANIMAL_TYPES).join(", ");
    errors.push(`Invalid animal type. Allowed: ${allowedTypes}.`);
  }

  // Validate amount if it's being updated
  if (updateData.amount !== undefined && (!updateData.amount || isNaN(Number(updateData.amount)) || Number(updateData.amount) <= 0)) {
    errors.push("Amount must be a positive number.");
  }

  // Validate fieldId if it's being updated
  if (updateData.fieldId !== undefined && updateData.fieldId !== null && isNaN(Number(updateData.fieldId))) {
    errors.push("fieldId must be a number if provided.");
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.status = 400;
    throw err;
  }

  const updatedArr = await this.db.updateRecords(
    (item) => item.userId === numericUserId && item.id === numericId,
    (item) => {
      const updated = { ...item };
      if (updateData.type !== undefined) updated.type = updateData.type;
      if (updateData.amount !== undefined) updated.amount = Number(updateData.amount);
      if (updateData.fieldId !== undefined) updated.fieldId = updateData.fieldId !== null ? Number(updateData.fieldId) : undefined;
      return updated;
    },
  );
  return Array.isArray(updatedArr) ? updatedArr.find((item) => item.userId === numericUserId && item.id === numericId) : null;
};

module.exports = ResourceService;
