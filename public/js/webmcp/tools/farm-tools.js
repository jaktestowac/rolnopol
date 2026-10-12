/**
 * WebMCP tools for the staff & fields pages: fields, staff, animals,
 * staff-to-field assignments and JSON export.
 * Input limits mirror the validation of the forms on staff-fields-main.html.
 */
(function (root) {
  "use strict";

  const { defineToolGroup } = root.RolnopolWebMcp || require("../webmcp-service.js");

  const MAX_ITEMS = 100;
  const ID_SCHEMA = { type: "integer", minimum: 1 };
  const NAME_SCHEMA = { type: "string", minLength: 2, maxLength: 32 };
  const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false };

  /** Re-run the page's own loaders/renderers so the user sees what the agent changed. */
  async function refreshPage(page, steps) {
    if (!page) return;
    for (const [method, ...args] of steps) {
      if (typeof page[method] !== "function") continue;
      try {
        await page[method](...args);
      } catch (error) {
        console.warn(`[WebMCP] Page refresh step ${method} failed:`, error);
      }
    }
  }

  function refreshCurrentPage() {
    const mainPage = root.staffFieldsMainPage;
    if (mainPage) {
      return refreshPage(mainPage, [
        ["_loadFields", true],
        ["_loadStaff", true],
        ["_loadAssignments"],
        ["_loadAnimals", true],
        ["_renderFieldsPage"],
        ["_renderStaffPage"],
        ["_renderAnimalsPage"],
        ["_renderFieldAssignments"],
        ["_renderStats"],
        ["_renderAnimalsStats"],
        ["_setupDragAndDrop"],
      ]);
    }

    return refreshPage(root.staffFieldsAssignPage, [
      ["_loadFields"],
      ["_loadStaff"],
      ["_loadAssignments"],
      ["_loadAnimals"],
      ["_updateStaffAssignmentSummary"],
      ["_updateAnimalAndFieldWarnings"],
      ["_renderAssignments"],
      ["_populateAssignModal"],
    ]);
  }

  function asList(result) {
    return result.ok && Array.isArray(result.data) ? result.data : [];
  }

  function limited(items) {
    return { items: items.slice(0, MAX_ITEMS), total: items.length, truncated: items.length > MAX_ITEMS };
  }

  async function loadFarm(service) {
    const [fields, staff, animals, assignments] = await Promise.all([
      service.call("GET", "fields"),
      service.call("GET", "staff"),
      service.call("GET", "animals"),
      service.call("GET", "fields/assign"),
    ]);
    const failed = [fields, staff, animals, assignments].find((result) => !result.ok);
    if (failed) return { error: failed };
    return { fields: asList(fields), staff: asList(staff), animals: asList(animals), assignments: asList(assignments) };
  }

  function sameId(a, b) {
    return String(a) === String(b);
  }

  // --- fields ---

  async function listFields(service) {
    const farm = await loadFarm(service);
    if (farm.error) return farm.error;

    const fields = farm.fields.map((field) => ({
      id: field.id,
      name: field.name,
      areaHa: field.area,
      district: field.district || null,
      staffIds: farm.assignments.filter((a) => sameId(a.fieldId, field.id)).map((a) => a.staffId),
      animals: farm.animals
        .filter((animal) => animal.fieldId && sameId(animal.fieldId, field.id))
        .map((animal) => ({ id: animal.id, type: animal.type, amount: animal.amount })),
    }));

    return { ok: true, fields: limited(fields) };
  }

  async function checkDistrict(service, district) {
    if (!district) return null;
    const result = await service.call("GET", "map/districts");
    const districts = asList(result);
    if (districts.length > 0 && !districts.includes(district)) {
      return { ok: false, error: "unknown_district", availableDistricts: districts };
    }
    return null;
  }

  async function createField(service, { name, area, district }) {
    const districtError = await checkDistrict(service, district);
    if (districtError) return districtError;

    const body = { name: name.trim(), area };
    if (district) body.district = district;

    const result = await service.call("POST", "fields", { body });
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, field: result.data };
  }

  async function updateField(service, { fieldId, name, area, district }) {
    const current = asList(await service.call("GET", "fields")).find((field) => sameId(field.id, fieldId));
    if (!current) return { ok: false, error: "field_not_found" };

    const districtError = await checkDistrict(service, district);
    if (districtError) return districtError;

    // PUT replaces the record, so start from the current values (as the edit modal does).
    const body = {
      name: name !== undefined ? name.trim() : current.name,
      area: area !== undefined ? area : current.area,
      district: district !== undefined ? district || null : current.district || null,
    };

    const result = await service.call("PUT", `fields/${fieldId}`, { body });
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, field: result.data };
  }

  // --- staff ---

  async function listStaff(service) {
    const farm = await loadFarm(service);
    if (farm.error) return farm.error;

    const staff = farm.staff.map((member) => {
      const assignment = farm.assignments.find((a) => sameId(a.staffId, member.id));
      return {
        id: member.id,
        name: member.name,
        surname: member.surname,
        age: member.age,
        fieldId: assignment ? assignment.fieldId : null,
      };
    });

    return { ok: true, staff: limited(staff) };
  }

  async function createStaff(service, { name, surname, age }) {
    const result = await service.call("POST", "staff", { body: { name: name.trim(), surname: surname.trim(), age } });
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, staff: result.data };
  }

  // --- animals ---

  async function getAnimalTypes(service) {
    const result = await service.call("GET", "animals/types", { requiresAuth: false });
    return result.ok && result.data && typeof result.data === "object" ? Object.keys(result.data) : [];
  }

  async function listAnimals(service) {
    const [animals, types] = await Promise.all([service.call("GET", "animals"), getAnimalTypes(service)]);
    if (!animals.ok) return animals;

    const items = asList(animals).map((animal) => ({
      id: animal.id,
      type: animal.type,
      amount: animal.amount,
      fieldId: animal.fieldId || null,
    }));

    return { ok: true, animals: limited(items), availableTypes: types };
  }

  async function checkFieldExists(service, fieldId) {
    if (fieldId === undefined) return null;
    const fields = asList(await service.call("GET", "fields"));
    return fields.some((field) => sameId(field.id, fieldId)) ? null : { ok: false, error: "field_not_found" };
  }

  async function addAnimal(service, { type, amount, fieldId }) {
    const types = await getAnimalTypes(service);
    if (types.length > 0 && !types.includes(type)) {
      return { ok: false, error: "unknown_animal_type", availableTypes: types };
    }

    const fieldError = await checkFieldExists(service, fieldId);
    if (fieldError) return fieldError;

    const result = await service.call("POST", "animals", { body: { type, amount, fieldId: fieldId ?? null } });
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, animal: result.data };
  }

  async function moveAnimal(service, { animalId, fieldId }) {
    const fieldError = await checkFieldExists(service, fieldId);
    if (fieldError) return fieldError;

    const result = await service.call("PUT", `animals/${animalId}`, { body: { fieldId: fieldId ?? null } });
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, animal: result.data };
  }

  // --- assignments ---

  async function listAssignments(service) {
    const farm = await loadFarm(service);
    if (farm.error) return farm.error;

    const nameOf = (list, id, format) => {
      const item = list.find((entry) => sameId(entry.id, id));
      return item ? format(item) : null;
    };

    const assignments = farm.assignments.map((assignment) => ({
      id: assignment.id,
      fieldId: assignment.fieldId,
      fieldName: nameOf(farm.fields, assignment.fieldId, (field) => field.name),
      staffId: assignment.staffId,
      staffName: nameOf(farm.staff, assignment.staffId, (member) => `${member.name} ${member.surname}`),
    }));

    const assignedStaff = new Set(farm.assignments.map((a) => String(a.staffId)));
    const staffedFields = new Set(farm.assignments.map((a) => String(a.fieldId)));

    return {
      ok: true,
      assignments: limited(assignments),
      unassignedStaffIds: farm.staff.filter((member) => !assignedStaff.has(String(member.id))).map((member) => member.id),
      fieldsWithoutStaffIds: farm.fields.filter((field) => !staffedFields.has(String(field.id))).map((field) => field.id),
    };
  }

  async function assignStaff(service, { fieldId, staffId }) {
    const farm = await loadFarm(service);
    if (farm.error) return farm.error;

    if (!farm.fields.some((field) => sameId(field.id, fieldId))) return { ok: false, error: "field_not_found" };
    if (!farm.staff.some((member) => sameId(member.id, staffId))) return { ok: false, error: "staff_not_found" };

    // Same rule as the assign page: a staff member works on one field at a time.
    const existing = farm.assignments.find((a) => sameId(a.staffId, staffId));
    if (existing) {
      return { ok: false, error: "staff_already_assigned", fieldId: existing.fieldId, assignmentId: existing.id };
    }

    const result = await service.call("POST", "fields/assign", { body: { fieldId, staffId } });
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, assignment: result.data };
  }

  async function unassignStaff(service, { fieldId, staffId }) {
    const assignments = asList(await service.call("GET", "fields/assign"));
    const assignment = assignments.find((a) => sameId(a.fieldId, fieldId) && sameId(a.staffId, staffId));
    if (!assignment) return { ok: false, error: "assignment_not_found" };

    const result = await service.call("DELETE", `fields/assign/${assignment.id}`);
    if (!result.ok) return result;

    await refreshCurrentPage();
    return { ok: true, removedAssignmentId: assignment.id };
  }

  // --- export ---

  async function downloadExport(service, { resource }) {
    const result = await service.call("GET", resource);
    if (!result.ok) return result;

    const rows = Array.isArray(result.data) ? result.data : [];
    const exportPage = root.staffFieldsExportPage;
    if (!exportPage || typeof exportPage._downloadJson !== "function") {
      return { ok: false, error: "export_page_unavailable" };
    }

    const filename = exportPage._getExportFilename(resource);
    exportPage._downloadJson(filename, rows);
    exportPage._setStatus?.(`${resource} export downloaded.`, "success");

    return { ok: true, resource, filename, rows: rows.length };
  }

  defineToolGroup("farm", {
    pages: ["staff-fields-main", "staff-fields-assign", "staff-fields-export"],
    tools: (service) => {
      const tools = [];
      const page = service.page;

      if (page === "staff-fields-main") {
        tools.push(
          {
            name: "fields.list",
            title: "List fields",
            description: "List the user's fields with id, name, area (ha), district, assigned staff ids and the animals kept on each field.",
            auth: "required",
            inputSchema: EMPTY_INPUT,
            annotations: { readOnlyHint: true },
            execute: () => listFields(service),
          },
          {
            name: "fields.create",
            title: "Create field",
            description: "Create a new field. District is optional and must be one of the Rolnopol map districts.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: {
                name: NAME_SCHEMA,
                area: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Area in hectares." },
                district: { type: "string", maxLength: 64, description: "District name as shown on the Rolnopol map." },
              },
              required: ["name", "area"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => createField(service, input),
          },
          {
            name: "fields.update",
            title: "Update field",
            description: "Change a field's name, area or district. Omitted properties keep their current value; an empty district removes it.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: {
                fieldId: ID_SCHEMA,
                name: NAME_SCHEMA,
                area: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
                district: { type: "string", maxLength: 64 },
              },
              required: ["fieldId"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => updateField(service, input),
          },
          {
            name: "staff.list",
            title: "List staff",
            description: "List the user's staff members with id, name, surname, age and the field they are assigned to (if any).",
            auth: "required",
            inputSchema: EMPTY_INPUT,
            annotations: { readOnlyHint: true },
            execute: () => listStaff(service),
          },
          {
            name: "staff.create",
            title: "Hire staff member",
            description: "Add a staff member to the farm.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 2, maxLength: 32 },
                surname: { type: "string", minLength: 2, maxLength: 32 },
                age: { type: "integer", minimum: 1, maximum: 120 },
              },
              required: ["name", "surname", "age"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => createStaff(service, input),
          },
          {
            name: "animals.list",
            title: "List animals",
            description: "List the user's animal records (type, amount, field) and the animal types Rolnopol supports.",
            auth: "required",
            inputSchema: EMPTY_INPUT,
            annotations: { readOnlyHint: true },
            execute: () => listAnimals(service),
          },
          {
            name: "animals.add",
            title: "Add animals",
            description: "Add animals of one type, optionally placing them on a field. Use animals.list to see the supported types.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: {
                type: { type: "string", minLength: 1, maxLength: 40, description: "Animal type key, e.g. cow, pig, chicken." },
                amount: { type: "integer", minimum: 1, maximum: 9999999 },
                fieldId: ID_SCHEMA,
              },
              required: ["type", "amount"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => addAnimal(service, input),
          },
          {
            name: "animals.move",
            title: "Move animals to a field",
            description: "Move an animal record to another field. Omit fieldId to take the animals off their field.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: { animalId: ID_SCHEMA, fieldId: ID_SCHEMA },
              required: ["animalId"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => moveAnimal(service, input),
          },
        );
      }

      if (page === "staff-fields-main" || page === "staff-fields-assign") {
        tools.push(
          {
            name: "assignments.list",
            title: "List staff assignments",
            description: "List which staff member works on which field, plus unassigned staff and fields without staff.",
            auth: "required",
            inputSchema: EMPTY_INPUT,
            annotations: { readOnlyHint: true },
            execute: () => listAssignments(service),
          },
          {
            name: "assignments.assign",
            title: "Assign staff to field",
            description: "Assign a staff member to a field. A staff member can work on only one field at a time.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: { fieldId: ID_SCHEMA, staffId: ID_SCHEMA },
              required: ["fieldId", "staffId"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => assignStaff(service, input),
          },
          {
            name: "assignments.unassign",
            title: "Unassign staff from field",
            description: "Remove a staff member from a field.",
            auth: "required",
            inputSchema: {
              type: "object",
              properties: { fieldId: ID_SCHEMA, staffId: ID_SCHEMA },
              required: ["fieldId", "staffId"],
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => unassignStaff(service, input),
          },
        );
      }

      if (page === "staff-fields-export") {
        tools.push({
          name: "export.download",
          title: "Download farm data export",
          description: "Download the user's fields, staff or animals as a JSON file and return how many rows it contains.",
          auth: "required",
          flag: "staffFieldsExportEnabled",
          inputSchema: {
            type: "object",
            properties: { resource: { type: "string", enum: ["fields", "staff", "animals"] } },
            required: ["resource"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: (input) => downloadExport(service, input),
        });
      }

      return tools;
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
