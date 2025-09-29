const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const ResourceService = require("../services/resource.service");
const { ALLOWED_ANIMAL_TYPES } = require("../data/animal-types");
const { isValidId } = require("../helpers/validators");

class ResourceController {
  constructor(resourceType) {
    this.resourceType = resourceType; // 'fields' or 'staff'
    this.service = new ResourceService(resourceType);
  }

  async list(req, res) {
    try {
      const items = await this.service.list(req.user.userId);
      res.status(200).json(formatResponseBody({ data: items }, false));
    } catch (error) {
      logError(`Error offer ${this.resourceType}:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async create(req, res) {
    try {
      const data = req.body;
      const newItem = await this.service.create(req.user.userId, data);
      res.status(201).json(
        formatResponseBody(
          {
            data: newItem,
            message: `${this.resourceType.slice(0, -1)} added`,
          },
          false
        )
      );
    } catch (error) {
      logError(`Error creating ${this.resourceType.slice(0, -1)}:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json(formatResponseBody({ error: "Invalid ID format" }));
      }

      await this.service.delete(req.user.userId, id);
      res.status(200).json(
        formatResponseBody({
          data: { message: `${this.resourceType.slice(0, -1)} deleted` },
        })
      );
    } catch (error) {
      logError(`Error deleting ${this.resourceType.slice(0, -1)}:`, error);
      const status = error?.status || (error?.code === "READ_ONLY" ? 403 : 500);
      res.status(status).json(formatResponseBody({ error: error.message }));
    }
  }

  async assign(req, res) {
    try {
      const { fieldId, staffId } = req.body;
      if (!fieldId || !staffId) {
        return res.status(400).json(formatResponseBody({ error: "Field and Staff are required" }));
      }

      if (!isValidId(fieldId) || !isValidId(staffId)) {
        return res.status(400).json(formatResponseBody({ error: "Invalid field or staff ID format" }));
      }

      const assignment = await this.service.assignStaffToField(req.user.userId, fieldId, staffId);
      res.status(201).json(formatResponseBody({ data: assignment, message: "Assignment created" }, false));
    } catch (error) {
      logError(`Error assigning staff to field:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async listAssignments(req, res) {
    try {
      const assignments = await this.service.listAssignments(req.user.userId);
      res.status(200).json(formatResponseBody({ data: assignments }, false));
    } catch (error) {
      logError(`Error offer assignments:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async removeAssignment(req, res) {
    try {
      const { id } = req.params;
      await this.service.removeAssignment(req.user.userId, id);
      res.status(200).json(formatResponseBody({ message: "Assignment removed" }));
    } catch (error) {
      logError(`Error removing assignment:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json(formatResponseBody({ error: "Invalid ID format" }));
      }

      const updateData = req.body;
      const updated = await this.service.update(req.user.userId, id, updateData);
      if (!updated) {
        return res.status(404).json(formatResponseBody({ error: "Not found" }));
      }
      res.status(200).json(
        formatResponseBody({
          data: updated,
          message: "Updated successfully",
        })
      );
    } catch (error) {
      logError(`Error updating ${this.resourceType}:`, error);
      const status = error?.status || (error?.code === "READ_ONLY" ? 403 : 500);
      res.status(status).json(formatResponseBody({ error: error.message }));
    }
  }

  // --- Fields endpoints ---
  async listDistricts(req, res) {
    try {
      const raw = req.params?.id || req.params?.district_id;
      const filterName = typeof raw === "string" ? raw.replace(/-/g, " ") : undefined;
      const districts = await this.service.listDistricts(req.user.userId, filterName);
      res.status(200).json(formatResponseBody({ data: districts }, false));
    } catch (error) {
      logError(`Error listing districts:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  // --- Animals endpoints ---
  async listAnimals(req, res) {
    try {
      const animals = await this.service.list(req.user.userId);
      res.status(200).json(formatResponseBody({ data: animals }, false));
    } catch (error) {
      logError(`Error offer animals:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async createAnimal(req, res) {
    try {
      const data = req.body;
      const animal = await this.service.createAnimal(req.user.userId, data);
      res.status(201).json(formatResponseBody({ data: animal, message: "Animal added" }, false));
    } catch (error) {
      if (error && error.status === 400) {
        return res.status(400).json(formatResponseBody({ error: error.message }));
      }
      logError(`Error creating animal:`, error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }

  async deleteAnimal(req, res) {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json(formatResponseBody({ error: "Invalid ID format" }));
      }

      await this.service.delete(req.user.userId, id);
      res.status(200).json(formatResponseBody({ data: { message: "Animal deleted" } }));
    } catch (error) {
      logError(`Error deleting animal:`, error);
      const status = error?.status || (error?.code === "READ_ONLY" ? 403 : 500);
      res.status(status).json(formatResponseBody({ error: error.message }));
    }
  }

  async updateAnimal(req, res) {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json(formatResponseBody({ error: "Invalid ID format" }));
      }

      const updateData = req.body;
      const updated = await this.service.updateAnimal(req.user.userId, id, updateData);
      if (!updated) {
        return res.status(404).json(formatResponseBody({ error: "Animal not found" }));
      }
      res.status(200).json(formatResponseBody({ data: updated, message: "Animal updated" }));
    } catch (error) {
      logError(`Error updating animal:`, error);
      const status = error?.status || (error?.code === "READ_ONLY" ? 403 : 500);
      res.status(status).json(formatResponseBody({ error: error.message }));
    }
  }

  // --- Animal types endpoint ---
  static getAnimalTypes(req, res) {
    // Expose only visible (non-hidden) animal types
    const visibleAnimalTypes = Object.fromEntries(Object.entries(ALLOWED_ANIMAL_TYPES).filter(([, def]) => !def.hidden));

    res.status(200).json({
      success: true,
      data: visibleAnimalTypes,
      message: "Allowed animal types",
    });
  }
}

module.exports = ResourceController;
