// Staff & Fields Main Page Logic

class StaffFieldsMainPage {
  constructor() {
    this.apiService = window.ApiService ? new window.ApiService() : null;
    this.fields = [];
    this.staff = [];
    this.animals = [];
    this.assignments = {}; // { fieldId: [staffId, ...] }
    this.fieldsPage = 1;
    this.staffPage = 1;
    this.animalsPage = 1;
    this.itemsPerPage = 5;
    this.animalSearchTerm = "";
    this.animalTypes = {}; // Cache for animal types
  }

  async _loadAnimalTypes() {
    if (Object.keys(this.animalTypes).length === 0) {
      try {
        const resp = await this.apiService.get("animals/types", {
          requiresAuth: true,
        });
        if (resp.success && resp.data && resp.data.data && typeof resp.data.data === "object") {
          this.animalTypes = resp.data.data;
        }
      } catch (e) {
        console.error("Error loading animal types:", e);
      }
    }
    return this.animalTypes;
  }

  async init() {
    await this._loadFields();
    await this._loadStaff();
    await this._loadAssignments(); // <-- load assignments
    await this._loadAnimals();
    this._setupEventListeners();
    this._setupAnimalModal();
    await this._renderFieldsPage();
    this._renderStaffPage();
    await this._renderAnimalsPage();
    this._setupFiltering();
    this._setupDragAndDrop();
    this._setupModals();
    this._setupTabs();
    this._renderStats();
    this._renderAnimalsStats();
    this._setupAnimalSearch();
    this._renderFieldAssignments(); // <-- render badges after fields
  }

  _renderStats() {
    const fieldsStats = document.getElementById("fieldsStats");
    if (fieldsStats) {
      const totalFields = this.fields.length;
      const totalArea = this.fields.reduce((sum, f) => sum + (parseFloat(f.area) || 0), 0);
      fieldsStats.innerHTML = `<strong>Fields:</strong> ${totalFields} | <strong>Total Area:</strong> ${totalArea} ha`;
    }
    const staffStats = document.getElementById("staffStats");
    if (staffStats) {
      const totalStaff = this.staff.length;
      staffStats.innerHTML = `<strong>Staff:</strong> ${totalStaff}`;
    }
  }

  async _loadFields(preservePage = false) {
    const fieldsList = document.getElementById("fieldsList");
    const assignField = document.getElementById("assignField");
    if (fieldsList) fieldsList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.get("fields", {
        requiresAuth: true,
      });
      const fieldsArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
      if (response.success && Array.isArray(fieldsArray)) {
        this.fields = fieldsArray;
        this._renderStats();

        // Preserve current page if requested, otherwise reset to page 1
        if (!preservePage) {
          this.fieldsPage = 1;
        }

        this._renderFieldsPage();
        if (assignField) assignField.innerHTML = "";
        if (assignField)
          fieldsArray.forEach((field) => {
            const opt = document.createElement("option");
            opt.value = field.id;
            opt.textContent = `${field.name} (${field.area} ha)`;
            assignField.appendChild(opt);
          });
      } else if (!response.success && fieldsList) {
        fieldsList.innerHTML = `<li>${response.error || "Error loading fields."}</li>`;
      } else if (fieldsList) {
        fieldsList.innerHTML = "<li>Error loading fields.</li>";
      }
    } catch (e) {
      if (fieldsList) fieldsList.innerHTML = "<li>Error loading fields.</li>";
    }
  }

  async _loadAssignments() {
    try {
      const response = await this.apiService.get("fields/assign", {
        requiresAuth: true,
      });
      const assignmentsArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
      this.assignments = assignmentsArray.reduce((acc, a) => {
        if (!acc[a.fieldId]) acc[a.fieldId] = [];
        acc[a.fieldId].push(a);
        return acc;
      }, {});
    } catch {
      this.assignments = {};
    }
  }

  _renderFieldAssignments() {
    // Show assigned staff under each field
    const fieldsList = document.getElementById("fieldsList");
    Array.from(fieldsList.children).forEach((li) => {
      const fieldId = li.dataset.fieldId;
      const assignmentArr = this.assignments[fieldId] || [];
      let assigned = "";
      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find((s) => String(s.id) === String(assignment.staffId));
        if (staff) {
          assigned += `<span class='assignment-info badge field-badge assigned-staff' style='font-weight: 600;color: #2a7a2a;display:flex;align-items:center;justify-content:space-between;vertical-align:middle;;background:#e6f4ea;padding:0.18em 0.85em;border-radius:12px;font-size:0.97em;gap:0.4em;'><span style='width: 250px;flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class="fas fa-user"></i>: ${staff.name} ${staff.surname}</span><button class='btn btn-xs btn-danger btn-unassign' data-unassign='${assignment.id}' title='Unassign' style='flex-shrink:0;margin-left:0.5em;padding:0 0.4em;font-size:1em;vertical-align:middle;'>&times;</button></span> `;
        }
      });
      let assignedDiv = li.querySelector(".assigned-staff");
      if (!assignedDiv) {
        assignedDiv = document.createElement("div");
        assignedDiv.className = "assigned-staff";
        li.appendChild(assignedDiv);
      }
      if (assigned) {
        assignedDiv.innerHTML = assigned;
        assignedDiv.style.display = "";
      } else {
        assignedDiv.innerHTML = "";
        assignedDiv.style.display = "none";
      }
      // Add unassign button handlers
      Array.from(assignedDiv.querySelectorAll("button[data-unassign]")).forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const assignmentId = btn.getAttribute("data-unassign");
          await this._removeAssignmentById(assignmentId);
        });
      });
    });
  }

  async _removeAssignmentById(assignmentId) {
    try {
      const response = await this.apiService.delete(`fields/assign/${assignmentId}`, { requiresAuth: true });
      if (response.success) {
        await this._loadFields(true); // Preserve page
        await this._loadStaff(true); // Preserve page
        await this._loadAssignments();
        await this._renderFieldsPage();
        this._renderStaffPage();
        this._renderFieldAssignments();
        await this._renderAnimalsPage(); // Update animal warnings when staff assignments change
        // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
        setTimeout(() => {
          this._setupDragAndDrop();
        }, 50);
      }
    } catch {}
  }

  async _assignStaffToField(fieldId, staffId) {
    // Prevent assigning a staff to the same field more than once
    if (this.assignments[fieldId] && this.assignments[fieldId].some((a) => String(a.staffId) === String(staffId))) {
      alert("This staff is already assigned to this field.");
      return;
    }
    // Prevent assigning a staff to any field more than once
    for (const fid in this.assignments) {
      if (this.assignments[fid].some((a) => String(a.staffId) === String(staffId))) {
        alert("This staff is already assigned to a field.");
        return;
      }
    }
    try {
      const response = await this.apiService.post("fields/assign", { fieldId, staffId }, { requiresAuth: true });
      if (response.success) {
        await this._loadFields(true); // Preserve page
        await this._loadStaff(true); // Preserve page
        await this._loadAssignments();
        await this._renderFieldsPage();
        this._renderStaffPage();
        this._renderFieldAssignments();
        await this._renderAnimalsPage(); // Update animal warnings when staff assignments change
        // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
        setTimeout(() => {
          this._setupDragAndDrop();
        }, 50);
      }
    } catch {}
  }

  // Update _renderFieldsPage to display assigned animals under each field
  async _renderFieldsPage() {
    const fieldsList = document.getElementById("fieldsList");
    if (!fieldsList) return;
    const start = (this.fieldsPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    const pageFields = this.fields.slice(start, end);
    fieldsList.innerHTML = pageFields.length === 0 ? "<li>No fields found.</li>" : "";
    for (const field of pageFields) {
      // Get animals assigned to this field
      const assignedAnimals = this.animals.filter((animal) => String(animal.fieldId) === String(field.id));
      // Create animal info display
      let animalInfo = "";
      if (assignedAnimals.length > 0) {
        // Load animal types from cache
        const animalTypes = await this._loadAnimalTypes();
        // Group by type
        const animalTypeMap = {};
        assignedAnimals.forEach((animal) => {
          if (!animalTypeMap[animal.type]) animalTypeMap[animal.type] = [];
          animalTypeMap[animal.type].push(animal);
        });
        animalInfo = Object.entries(animalTypeMap)
          .map(([type, animals]) => {
            const count = animals.reduce((sum, a) => sum + parseInt(a.amount), 0);
            const animalIdList = animals.map((a) => a.id).join(",");
            const animalType = animalTypes[type];
            const icon = animalType ? animalType.icon : "🐾";
            const displayName = animalType ? animalType.fullName : type;
            return `<span class='assignment-info badge field-badge assigned-animal' style='color:#2563eb;font-size:0.97em;display:flex;align-items:center;justify-content:space-between;gap:0.5em;margin-bottom:0.1em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'>${icon}: ${count} ${displayName}</span><button class='btn btn-xs btn-danger btn-unassign btn-unassign-animal-type-field' data-animal-ids='${animalIdList}' title='Unassign all ${displayName} from field' style='flex-shrink:0;margin-left:0.5em;'>&times;</button></span>`;
          })
          .join("");
        animalInfo = `<div class="list-card-meta mt-1">${animalInfo}</div>`;
      }
      const li = document.createElement("li");
      li.className = `list-card glass mb-1 compact-list-card field-card field-card-${field.id}`;
      li.innerHTML = `
        <div class="list-card-header">
          <div style="display:flex;align-items:center;gap:0.5em;flex:1;min-width:0;">
            <span class="list-card-icon field-icon" title="Field" style="flex-shrink:0;"><i class="fas fa-leaf" style='color:#2a7a2a;font-size:0.97em;'></i></span>
            <span class="list-card-title list-card-title-animal" style="flex:1;min-width:0;"><strong>${field.name}</strong></span>
            <span class="list-card-area" style="flex-shrink:0;">${field.area} ha</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.3em;flex-shrink:0;">
            <button class="btn btn-xs btn-secondary btn-edit-field" title="Edit Field"><i class="fas fa-edit"></i></button>
            <button class="btn btn-xs btn-danger btn-delete-field" title="Delete Field"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        ${animalInfo}
      `;
      li.dataset.fieldId = field.id;
      li.querySelector(".btn-edit-field").addEventListener("click", () => {
        this._openEditFieldModal(field);
      });
      li.querySelector(".btn-delete-field").addEventListener("click", async () => {
        const confirmed = await this._showConfirmModal("Are you sure you want to delete this field?");
        if (confirmed) {
          try {
            const response = await this.apiService.delete(`fields/${field.id}`, { requiresAuth: true });
            if (response.success) {
              await this._loadFields(true); // Preserve page
              await this._loadAssignments();
              this._renderFieldAssignments();
            } else {
              alert(response.error || "Error deleting field.");
            }
          } catch (e) {
            alert("Error deleting field.");
          }
        }
      });
      // Add event listeners for unassign animals button if present
      const unassignAnimalsBtn = li.querySelector(".btn-unassign-animals-field");
      if (unassignAnimalsBtn) {
        unassignAnimalsBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const fieldId = unassignAnimalsBtn.getAttribute("data-field-id");
          await this._unassignAllAnimalsFromField(fieldId);
        });
      }
      // Add event listeners for unassign animal type buttons
      const unassignAnimalTypeBtns = li.querySelectorAll(".btn-unassign-animal-type-field");
      unassignAnimalTypeBtns.forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const animalIds = btn.getAttribute("data-animal-ids").split(",");
          for (const animalId of animalIds) {
            await this._unassignAnimalFromField(animalId);
          }
        });
      });
      fieldsList.appendChild(li);
    }
    this._renderFieldsPagination();
    this._renderFieldAssignments();
    // Add pointer-events CSS for assigned-animal badges to not block drag
    const styleId = "assigned-animal-pointer-events-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.innerHTML = `
        .assigned-animal { pointer-events: none; }
        .assigned-animal .btn-unassign-animal-type-field, .assigned-animal .btn-unassign { pointer-events: auto; }
      `;
      document.head.appendChild(style);
    }
  }

  _renderFieldsPagination() {
    let pagination = document.getElementById("fieldsPagination");
    if (pagination && pagination.parentNode) {
      pagination.parentNode.removeChild(pagination);
    }
    pagination = document.createElement("div");
    pagination.id = "fieldsPagination";
    pagination.className = "pagination";
    const fieldsList = document.getElementById("fieldsList");
    let searchInput = document.getElementById("fieldsSearch");
    if (searchInput && searchInput.parentNode !== fieldsList.parentNode) {
      fieldsList.parentNode.insertBefore(searchInput, fieldsList);
    }
    if (searchInput) {
      searchInput.before(pagination);
    } else {
      fieldsList.before(pagination);
    }
    const totalPages = Math.ceil(this.fields.length / this.itemsPerPage);
    let html = "";
    html += `<button class='pagination-btn' data-page='prev' ${
      this.fieldsPage === 1 ? "disabled" : ""
    } title='Previous page' aria-label='Previous page'>&laquo;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="pagination-btn${i === this.fieldsPage ? " active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class='pagination-btn' data-page='next' ${
      this.fieldsPage === totalPages ? "disabled" : ""
    } title='Next page' aria-label='Next page'>&raquo;</button>`;
    html += `<span class='pagination-info pagination-info-compact'>${this.fieldsPage}/${totalPages}</span>`;
    pagination.innerHTML = html;
    Array.from(pagination.querySelectorAll(".pagination-btn")).forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        let page = btn.dataset.page;
        if (page === "prev") page = this.fieldsPage - 1;
        else if (page === "next") page = this.fieldsPage + 1;
        else page = parseInt(page);
        if (page >= 1 && page <= totalPages && page !== this.fieldsPage) {
          this.fieldsPage = page;
          await this._renderFieldsPage();
          // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
          setTimeout(() => {
            this._setupDragAndDrop();
          }, 50);
        }
      });
    });
  }

  async _loadStaff(preservePage = false) {
    const staffList = document.getElementById("staffList");
    if (staffList) staffList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.get("staff", {
        requiresAuth: true,
      });
      const staffArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
      if (response.success && Array.isArray(staffArray)) {
        this.staff = staffArray;
        this._renderStats();

        // Preserve current page if requested, otherwise reset to page 1
        if (!preservePage) {
          this.staffPage = 1;
        }

        this._renderStaffPage();
      } else if (!response.success && staffList) {
        staffList.innerHTML = `<li>${response.error || "Error loading staff."}</li>`;
      } else if (staffList) {
        staffList.innerHTML = "<li>Error loading staff.</li>";
      }
    } catch (e) {
      if (staffList) staffList.innerHTML = "<li>Error loading staff.</li>";
    }
  }

  _renderStaffPage() {
    const staffList = document.getElementById("staffList");
    if (!staffList) return;
    const start = (this.staffPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    const pageStaff = this.staff.slice(start, end);
    staffList.innerHTML = pageStaff.length === 0 ? "<li>No staff found.</li>" : "";
    pageStaff.forEach((staff) => {
      // Find assignment for this staff
      let assignedField = null;
      let assignmentObj = null;
      for (const fieldId in this.assignments) {
        const assignmentArr = this.assignments[fieldId] || [];
        const found = assignmentArr.find((a) => String(a.staffId) === String(staff.id));
        if (found) {
          assignedField = this.fields.find((f) => String(f.id) === String(fieldId));
          assignmentObj = found;
          break;
        }
      }
      let assignmentInfo = "<span class='assignment-info' style='color:#888;font-size:0.97em;'>Unassigned</span>";
      if (assignedField && assignmentObj) {
        assignmentInfo = `<span class='assignment-info badge field-badge' style='color:#2a7a2a;font-size:0.97em;display:flex;align-items:center;justify-content:space-between;gap:0.5em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class=\"fas fa-leaf\"></i>: ${assignedField.name}</span><button class='btn btn-xs btn-danger btn-unassign btn-unassign-staff-card' data-unassign='${assignmentObj.id}' title='Unassign' style='flex-shrink:0;margin-left:0.5em;'>&times;</button></span>`;
      }
      const li = document.createElement("li");
      li.className = `list-card glass mb-1 compact-list-card staff-card staff-card-${staff.id}`;
      li.innerHTML = `
        <div class="list-card-header">
          <div style="display:flex;align-items:center;gap:0.5em;flex:1;min-width:0;">
            <span class="list-card-icon staff-icon" title="Staff" style="flex-shrink:0;"><i class="fas fa-user"></i></span>
            <span class="list-card-title list-card-title-animal" style="flex:1;min-width:0;"><strong>${staff.name} ${staff.surname}</strong></span>
            <span class="list-card-age" style="flex-shrink:0;">age: ${staff.age}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.3em;flex-shrink:0;">
            <button class="btn btn-xs btn-secondary btn-edit-staff" title="Edit Staff"><i class="fas fa-edit"></i></button>
            <button class="btn btn-xs btn-danger btn-delete-staff" title="Delete Staff"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="list-card-meta mt-1">${assignmentInfo}</div>
      `;
      li.dataset.staffId = staff.id;
      // Edit button event
      li.querySelector(".btn-edit-staff").addEventListener("click", () => {
        this._openEditStaffModal(staff);
      });
      // Delete button event
      li.querySelector(".btn-delete-staff").addEventListener("click", async () => {
        const confirmed = await this._showConfirmModal("Are you sure you want to delete this staff?");
        if (confirmed) {
          try {
            const response = await this.apiService.delete(`staff/${staff.id}`, { requiresAuth: true });
            if (response.success) {
              await this._loadStaff(true); // Preserve page
              this._setupDragAndDrop();
              this._renderFieldAssignments();
            } else {
              alert(response.error || "Error deleting staff.");
            }
          } catch (e) {
            alert("Error deleting staff.");
          }
        }
      });
      // Unassign button event (if assigned)
      const unassignBtn = li.querySelector(".btn-unassign-staff-card");
      if (unassignBtn) {
        unassignBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const assignmentId = unassignBtn.getAttribute("data-unassign");
          await this._removeAssignmentById(assignmentId);
        });
      }
      staffList.appendChild(li);
    });
    this._renderStaffPagination();
    // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
    setTimeout(() => {
      this._setupDragAndDrop();
    }, 50);
  }

  _renderStaffPagination() {
    let pagination = document.getElementById("staffPagination");
    if (pagination && pagination.parentNode) {
      pagination.parentNode.removeChild(pagination);
    }
    pagination = document.createElement("div");
    pagination.id = "staffPagination";
    pagination.className = "pagination";
    const staffList = document.getElementById("staffList");
    let searchInput = document.getElementById("staffSearch");
    if (searchInput && searchInput.parentNode !== staffList.parentNode) {
      staffList.parentNode.insertBefore(searchInput, staffList);
    }
    if (searchInput) {
      searchInput.before(pagination);
    } else {
      staffList.before(pagination);
    }
    const totalPages = Math.ceil(this.staff.length / this.itemsPerPage);
    let html = "";
    html += `<button class='pagination-btn' data-page='prev' ${
      this.staffPage === 1 ? "disabled" : ""
    } title='Previous page' aria-label='Previous page'>&laquo;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="pagination-btn${i === this.staffPage ? " active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class='pagination-btn' data-page='next' ${
      this.staffPage === totalPages ? "disabled" : ""
    } title='Next page' aria-label='Next page'>&raquo;</button>`;
    html += `<span class='pagination-info pagination-info-compact'>${this.staffPage}/${totalPages}</span>`;
    pagination.innerHTML = html;
    Array.from(pagination.querySelectorAll(".pagination-btn")).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        let page = btn.dataset.page;
        if (page === "prev") page = this.staffPage - 1;
        else if (page === "next") page = this.staffPage + 1;
        else page = parseInt(page);
        if (page >= 1 && page <= totalPages && page !== this.staffPage) {
          this.staffPage = page;
          this._renderStaffPage();
          // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
          setTimeout(() => {
            this._setupDragAndDrop();
          }, 50);
        }
      });
    });
  }

  async _loadAnimals(preservePage = false) {
    const animalsList = document.getElementById("animalsList");
    if (animalsList) animalsList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.getAnimals({ requiresAuth: true });
      const animalsArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
      if (response.success && Array.isArray(animalsArray)) {
        // Remove duplicates based on id to prevent frontend duplication
        this.animals = animalsArray.filter((animal, index, self) => index === self.findIndex((a) => a.id === animal.id));

        // Preserve current page if requested, otherwise reset to page 1
        if (!preservePage) {
          this.animalsPage = 1;
        }

        this._renderAnimalsPage();
        this._renderAnimalsStats();
      } else if (animalsList) {
        animalsList.innerHTML = `<li>${response.error || "Error loading animals."}</li>`;
      }
    } catch (e) {
      if (animalsList) animalsList.innerHTML = "<li>Error loading animals.</li>";
    }
  }

  _renderAnimalsStats() {
    const animalsStats = document.getElementById("animalsStats");
    if (animalsStats) {
      const totalAnimals = this.animals.reduce((sum, a) => sum + (parseInt(a.amount) || 0), 0);
      animalsStats.innerHTML = `<strong>Total Animals:</strong> ${totalAnimals}`;
    }
  }

  _setupTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        tabContents.forEach((content) => content.classList.remove("active"));
        button.classList.add("active");
        const targetContent = document.getElementById(targetTab + "Tab");
        if (targetContent) {
          targetContent.classList.add("active");
        }
      });
    });
  }

  _setupAnimalSearch() {
    const searchInput = document.getElementById("animalsSearch");
    if (searchInput) {
      searchInput.value = "";
      searchInput.addEventListener("input", (e) => {
        this.animalSearchTerm = e.target.value;
        this._renderAnimalsPage();
      });
    }
  }

  _getFilteredAnimals() {
    if (!this.animalSearchTerm) return this.animals;
    const term = this.animalSearchTerm.toLowerCase();
    return this.animals.filter((animal) => {
      const type = (animal.type || "").toLowerCase();
      const field = this.fields.find((f) => String(f.id) === String(animal.fieldId));
      const fieldName = field ? (field.name || "").toLowerCase() : "";
      return type.includes(term) || fieldName.includes(term);
    });
  }

  async _renderAnimalsPage() {
    const animalsList = document.getElementById("animalsList");
    if (!animalsList) return;
    const filteredAnimals = this._getFilteredAnimals();
    const start = (this.animalsPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    const pageAnimals = filteredAnimals.slice(start, end);
    animalsList.innerHTML = pageAnimals.length === 0 ? "<li>No animals found.</li>" : "";

    // Load animal types from cache
    const animalTypes = await this._loadAnimalTypes();
    pageAnimals.forEach((animal) => {
      const field = this.fields.find((f) => String(f.id) === String(animal.fieldId));
      const animalType = animalTypes[animal.type];
      const emoji = animalType ? animalType.icon : "🐾";
      const assigned = !!animal.fieldId;

      // Check if field has staff assigned
      let fieldWarning = "";
      if (field && assigned) {
        const fieldAssignments = this.assignments[field.id] || [];
        if (fieldAssignments.length === 0) {
          fieldWarning = `<div class="field-warning-badge" style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;"><i class="fas fa-exclamation-triangle"></i> Field has no staff assigned</div>`;
        }
      }

      const li = document.createElement("li");
      li.className = `list-card glass mb-1 compact-list-card animal-card animal-card-${animal.id}`;
      let assignmentInfo = `<span class='assignment-info' style='color:#888;font-size:0.97em;'>Unassigned</span>`;
      if (field) {
        assignmentInfo = `<span class='assignment-info badge field-badge' style='color:#2a7a2a;font-size:0.97em;display:flex;align-items:center;justify-content:space-between;gap:0.5em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class="fas fa-leaf"></i>: ${field.name}</span><button class='btn btn-xs btn-danger btn-unassign btn-unassign-animal-card' data-animal-id='${animal.id}' title='Unassign from field' style='flex-shrink:0;margin-left:0.5em;'>&times;</button></span>`;
      }
      li.innerHTML = `
        <div class="list-card-header" style="display:flex;align-items:center;gap:0.5em;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:0.5em;flex:1;min-width:0;">
            <span class="drag-handle${assigned ? " drag-disabled" : ""}" title="${
        assigned ? "Already assigned" : "Drag to assign to field"
      }" style="flex-shrink:0;"><i class='fas fa-grip-lines'></i></span>
            <span class="list-card-icon animal-icon" title="Animal" style="flex-shrink:0;">${emoji}</span>
            <span class="list-card-title list-card-title-animal" style="flex:1;min-width:0;"><strong>${animal.type}</strong></span>
            <span class="list-card-amount" style="display:inline-block;width:60px;text-align:right;flex-shrink:0;" title="Amount of ${animal.type}: ${animal.amount}">${animal.amount}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.3em;flex-shrink:0;">
            <button class="btn btn-xs btn-secondary btn-edit-animal" title="Edit Animal"><i class="fas fa-edit"></i></button>
            <button class="btn btn-xs btn-danger btn-delete-animal" title="Delete Animal"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="list-card-meta mt-1">${assignmentInfo}</div>
        ${fieldWarning}
      `;
      li.dataset.animalId = animal.id;
      li.querySelector(".btn-edit-animal").addEventListener("click", () => {
        this._openEditAnimalModal(animal);
      });
      li.querySelector(".btn-delete-animal").addEventListener("click", async () => {
        const confirmed = await this._showConfirmModal("Are you sure you want to delete this animal?");
        if (confirmed) {
          try {
            const response = await this.apiService.deleteAnimal(animal.id, {
              requiresAuth: true,
            });
            if (response.success) {
              await this._loadAnimals(true); // Preserve page
            } else {
              alert(response.error || "Error deleting animal.");
            }
          } catch (e) {
            alert("Error deleting animal.");
          }
        }
      });

      // Add event listener for unassign button if it exists
      const unassignBtn = li.querySelector(".btn-unassign-animal-card");
      if (unassignBtn) {
        unassignBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this._unassignAnimalFromField(animal.id);
        });
      }
      animalsList.appendChild(li);
    });
    this._renderAnimalsPagination(filteredAnimals.length);
    this._setupDragAndDrop();
  }

  _renderAnimalsPagination(filteredCount) {
    let pagination = document.getElementById("animalsPagination");
    if (pagination && pagination.parentNode) {
      pagination.parentNode.removeChild(pagination);
    }
    pagination = document.createElement("div");
    pagination.id = "animalsPagination";
    pagination.className = "pagination";
    const animalsStats = document.getElementById("animalsStats");
    if (animalsStats) animalsStats.after(pagination);
    const totalPages = Math.ceil((filteredCount !== undefined ? filteredCount : this.animals.length) / this.itemsPerPage);
    let html = "";
    html += `<button class='pagination-btn' data-page='prev' ${
      this.animalsPage === 1 ? "disabled" : ""
    } title='Previous page' aria-label='Previous page'>&laquo;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="pagination-btn${i === this.animalsPage ? " active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class='pagination-btn' data-page='next' ${
      this.animalsPage === totalPages ? "disabled" : ""
    } title='Next page' aria-label='Next page'>&raquo;</button>`;
    html += `<span class='pagination-info pagination-info-compact'>${this.animalsPage}/${totalPages}</span>`;
    pagination.innerHTML = html;
    Array.from(pagination.querySelectorAll(".pagination-btn")).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        let page = btn.dataset.page;
        if (page === "prev") page = this.animalsPage - 1;
        else if (page === "next") page = this.animalsPage + 1;
        else page = parseInt(page);
        if (page >= 1 && page <= totalPages && page !== this.animalsPage) {
          this.animalsPage = page;
          this._renderAnimalsPage();
        }
      });
    });
  }

  _setupFiltering() {
    const fieldsList = document.getElementById("fieldsList");
    const staffList = document.getElementById("staffList");
    let fieldSearch = document.getElementById("fieldsSearch");
    if (!fieldSearch) {
      fieldSearch = document.createElement("input");
      fieldSearch.type = "text";
      fieldSearch.placeholder = "Search fields...";
      fieldSearch.className = "form-input-modern";
      fieldSearch.id = "fieldsSearch";
      fieldsList.parentNode.insertBefore(fieldSearch, fieldsList);
      fieldSearch.addEventListener("input", () => {
        const val = fieldSearch.value.toLowerCase();
        Array.from(fieldsList.children).forEach((li) => {
          li.style.display = li.textContent.toLowerCase().includes(val) ? "" : "none";
        });
      });
    }
    let staffSearch = document.getElementById("staffSearch");
    if (!staffSearch) {
      staffSearch = document.createElement("input");
      staffSearch.type = "text";
      staffSearch.placeholder = "Search staff...";
      staffSearch.className = "form-input-modern";
      staffSearch.id = "staffSearch";
      staffList.parentNode.insertBefore(staffSearch, staffList);
      staffSearch.addEventListener("input", () => {
        const val = staffSearch.value.toLowerCase();
        Array.from(staffList.children).forEach((li) => {
          li.style.display = li.textContent.toLowerCase().includes(val) ? "" : "none";
        });
      });
    }
  }

  // Update assignment logic to reload and re-render assignments and badges as needed
  async _assignStaffToField(fieldId, staffId) {
    try {
      const response = await this.apiService.post("fields/assign", { fieldId, staffId }, { requiresAuth: true });
      if (response.success) {
        await this._loadFields(true); // Preserve page
        await this._loadStaff(true); // Preserve page
        await this._loadAssignments();
        this._renderFieldsPage();
        this._renderStaffPage();
        this._renderFieldAssignments();
        this._renderAnimalsPage(); // Update animal warnings when staff assignments change
        this._setupDragAndDrop();
      }
    } catch {}
  }

  async _unassignAnimalFromField(animalId) {
    const animal = this.animals.find((a) => String(a.id) === String(animalId));
    if (!animal || !animal.fieldId) return;
    try {
      const response = await this.apiService.put(`animals/${animalId}`, { fieldId: null }, { requiresAuth: true });
      if (response.success) {
        await this._loadAnimals(true); // Preserve page
        this._renderFieldsPage();
        this._renderFieldAssignments();
        this._renderAnimalsPage(); // Update animal warnings when staff assignments change
        // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
        setTimeout(() => {
          this._setupDragAndDrop();
        }, 50);
      }
    } catch (error) {}
  }

  async _unassignAllAnimalsFromField(fieldId) {
    const field = this.fields.find((f) => String(f.id) === String(fieldId));
    if (!field) return;

    const confirmed = await this._showConfirmModal(
      `Are you sure you want to unassign all animals from "${field.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const response = await this.apiService.put(`fields/${fieldId}/unassign-all-animals`, {}, { requiresAuth: true });
      if (response.success) {
        await this._loadAnimals(true); // Preserve page
        await this._loadFields(true); // Preserve page
        this._renderAnimalsPage();
        this._renderFieldsPage();
        this._renderFieldAssignments();
        // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
        setTimeout(() => {
          this._setupDragAndDrop();
        }, 50);
      } else {
        alert(response.error || "Error unassigning all animals.");
      }
    } catch (error) {
      alert("Error unassigning all animals.");
    }
  }

  // Update _setupDragAndDrop to include drop handlers for assignment
  _setupDragAndDrop() {
    document.querySelectorAll(".staff-card, .animal-card").forEach((card) => {
      card.ondragstart = null;
      card.ondragend = null;
      card.draggable = false;
      const handle = card.querySelector(".drag-handle");
      if (handle) handle.remove();
    });
    document.querySelectorAll(".field-card").forEach((card) => {
      card.ondragover = null;
      card.ondragenter = null;
      card.ondragleave = null;
      card.ondrop = null;
      card.classList.remove("drag-over");
    });
    this.staff.forEach((staff) => {
      let assigned = false;
      for (const fieldId in this.assignments) {
        if (this.assignments[fieldId].some((a) => String(a.staffId) === String(staff.id))) {
          assigned = true;
          break;
        }
      }
      const card = document.querySelector(`.staff-card-${staff.id}`);
      if (card) {
        const oldHandle = card.querySelector(".drag-handle");
        if (oldHandle) oldHandle.remove();
        const handle = document.createElement("span");
        handle.className = "drag-handle" + (assigned ? " drag-disabled" : "");
        handle.setAttribute("aria-disabled", assigned ? "true" : "false");
        handle.title = assigned ? "Already assigned to a field" : "Drag to assign to field";
        handle.innerHTML = assigned
          ? '<i class="fas fa-grip-lines" style="color:#aaa;opacity:0.5;"></i> '
          : '<i class="fas fa-grip-lines"></i>';
        handle.style.cursor = assigned ? "not-allowed" : "grab";
        card.querySelector(".list-card-header").prepend(handle);
        card.draggable = !assigned;
        if (!assigned) {
          card.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", staff.id);
            card.classList.add("dragging");
          };
          card.ondragend = () => {
            card.classList.remove("dragging");
          };
        } else {
          card.ondragstart = null;
          card.ondragend = null;
        }
      }
    });
    this.animals.forEach((animal) => {
      const card = document.querySelector(`.animal-card-${animal.id}`);
      if (card) {
        const oldHandle = card.querySelector(".drag-handle");
        if (oldHandle) oldHandle.remove();
        const handle = document.createElement("span");
        const assigned = !!animal.fieldId;
        handle.className = "drag-handle" + (assigned ? " drag-disabled" : "");
        handle.setAttribute("aria-disabled", assigned ? "true" : "false");
        handle.title = assigned ? "Already assigned to a field" : "Drag to assign to field";
        handle.innerHTML = assigned
          ? '<i class="fas fa-grip-lines" style="color:#aaa;opacity:0.5;"></i>'
          : '<i class="fas fa-grip-lines"></i>';
        handle.style.cursor = assigned ? "not-allowed" : "grab";
        const header = card.querySelector(".list-card-header");
        if (header) header.prepend(handle);
        card.draggable = !assigned;
        if (!assigned) {
          card.ondragstart = (e) => {
            e.dataTransfer.setData("animal-id", animal.id);
            card.classList.add("dragging");
          };
          card.ondragend = () => {
            card.classList.remove("dragging");
          };
        } else {
          card.ondragstart = null;
          card.ondragend = null;
        }
      }
    });
    this.fields.forEach((field) => {
      const card = document.querySelector(`.field-card-${field.id}`);
      if (card) {
        card.ondragover = (e) => {
          e.preventDefault();
          card.classList.add("drag-over");
        };
        card.ondragenter = (e) => {
          e.preventDefault();
          card.classList.add("drag-over");
        };
        card.ondragleave = () => {
          card.classList.remove("drag-over");
        };
        card.ondrop = async (e) => {
          e.preventDefault();
          card.classList.remove("drag-over");
          const staffId = e.dataTransfer.getData("text/plain");
          const animalId = e.dataTransfer.getData("animal-id");
          if (staffId) {
            // Prevent duplicate assignment at drop time
            if (this.assignments[field.id] && this.assignments[field.id].some((a) => String(a.staffId) === String(staffId))) {
              alert("This staff is already assigned to this field.");
              return;
            }
            for (const fid in this.assignments) {
              if (this.assignments[fid].some((a) => String(a.staffId) === String(staffId))) {
                alert("This staff is already assigned to a field.");
                return;
              }
            }
            await this._assignStaffToField(field.id, staffId);
            // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
            setTimeout(() => {
              this._setupDragAndDrop();
            }, 50);
          } else if (animalId) {
            await this.apiService.put(`animals/${animalId}`, { fieldId: field.id }, { requiresAuth: true });
            await this._loadAnimals(true); // Preserve page
            this._renderAnimalsPage();
            this._renderFieldsPage();
            this._renderFieldAssignments();
            // Use setTimeout to ensure DOM is fully updated before setting up drag and drop
            setTimeout(() => {
              this._setupDragAndDrop();
            }, 50);
          }
        };
      }
    });
  }

  _setupModals() {
    // Add Field Modal
    const addFieldModal = document.getElementById("addFieldModal");
    const openAddFieldModal = document.getElementById("openAddFieldModal");
    const closeAddFieldModal = document.getElementById("closeAddFieldModal");
    if (openAddFieldModal)
      openAddFieldModal.addEventListener("click", async () => {
        addFieldModal.style.display = "flex";
        // Ensure district select exists and is populated
        await this._ensureAddFieldDistrictSelect();
        const fieldNameInput = document.getElementById("fieldName");
        if (fieldNameInput) fieldNameInput.focus();
      });
    if (closeAddFieldModal)
      closeAddFieldModal.addEventListener("click", () => {
        addFieldModal.style.display = "none";
      });
    if (addFieldModal)
      addFieldModal.addEventListener("click", (e) => {
        if (e.target === addFieldModal) addFieldModal.style.display = "none";
      });
    // Add Staff Modal
    const addStaffModal = document.getElementById("addStaffModal");
    const openAddStaffModal = document.getElementById("openAddStaffModal");
    const closeAddStaffModal = document.getElementById("closeAddStaffModal");
    if (openAddStaffModal)
      openAddStaffModal.addEventListener("click", () => {
        addStaffModal.style.display = "flex";
        const staffNameInput = document.getElementById("staffName");
        if (staffNameInput) staffNameInput.focus();
      });
    if (closeAddStaffModal)
      closeAddStaffModal.addEventListener("click", () => {
        addStaffModal.style.display = "none";
      });
    if (addStaffModal)
      addStaffModal.addEventListener("click", (e) => {
        if (e.target === addStaffModal) addStaffModal.style.display = "none";
      });
    // Escape closes modals
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        addFieldModal.style.display = "none";
        addStaffModal.style.display = "none";
      }
    });
  }

  /**
   * Ensure Add Field form contains optional District dropdown and populate it.
   */
  async _ensureAddFieldDistrictSelect() {
    const form = document.getElementById("addFieldForm");
    if (!form) return;
    // If select already present, just (re)populate
    let group = document.getElementById("fieldDistrictGroup");
    if (!group) {
      group = document.createElement("div");
      group.className = "form-group-modern";
      group.id = "fieldDistrictGroup";
      group.innerHTML = `
        <label for="fieldDistrict" class="form-label-modern"><i class="fas fa-map"></i> District (optional)</label>
        <select id="fieldDistrict" class="form-input-modern">
          <option value="">None</option>
        </select>
        <div class="form-error" id="fieldDistrictError"></div>
      `;
      // Insert before the last form group if possible, else append to end
      const groups = form.querySelectorAll(".form-group-modern");
      if (groups.length > 0) {
        const lastGroup = groups[groups.length - 1];
        lastGroup.parentNode.insertBefore(group, lastGroup);
      } else {
        form.appendChild(group);
      }
    }
    // Populate options
    const select = group.querySelector("#fieldDistrict");
    const errorDiv = group.querySelector("#fieldDistrictError");
    if (select) {
      select.disabled = true;
      select.innerHTML = `<option value="">Loading…</option>`;
      try {
        // Prefer map/districts endpoint which returns a simple array of names
        const resp = await this.apiService.getMapDistricts({
          requiresAuth: true,
        });
        let districts = [];
        if (resp && resp.success && Array.isArray(resp.data)) {
          districts = resp.data;
        } else if (resp && resp.success && resp.data && Array.isArray(resp.data.data)) {
          districts = resp.data.data;
        }
        // Fallback to fields/districts (object keyed by name)
        if (districts.length === 0) {
          const resp2 = await this.apiService.getDistricts({
            requiresAuth: true,
          });
          if (resp2 && resp2.success) {
            if (Array.isArray(resp2.data)) {
              districts = resp2.data;
            } else if (resp2.data && typeof resp2.data.data === "object" && resp2.data.data) {
              districts = Object.keys(resp2.data.data);
            }
          }
        }
        districts = (districts || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
        select.innerHTML = `<option value="">None</option>` + districts.map((d) => `<option value="${d}">${d}</option>`).join("");
        select.disabled = false;
        if (errorDiv) errorDiv.textContent = "";
      } catch (err) {
        select.innerHTML = `<option value="">None</option>`;
        select.disabled = false;
        if (errorDiv) errorDiv.textContent = "Unable to load districts (optional).";
      }
    }
  }

  _setupEventListeners() {
    // Add Field (modal)
    const addFieldForm = document.getElementById("addFieldForm");
    if (addFieldForm) {
      // Ensure the optional District select exists and is populated
      // (in case the modal was opened via different trigger than the standard button)
      this._ensureAddFieldDistrictSelect();

      const fieldName = document.getElementById("fieldName");
      const fieldArea = document.getElementById("fieldArea");
      const fieldNameError = document.getElementById("fieldNameError");
      const fieldAreaError = document.getElementById("fieldAreaError");
      const fieldDistrictError = document.getElementById("fieldDistrictError");
      const fieldMessage = document.getElementById("fieldMessage");
      function validateFieldForm() {
        let valid = true;
        fieldNameError.textContent = "";
        fieldAreaError.textContent = "";
        if (fieldDistrictError) fieldDistrictError.textContent = "";
        fieldMessage.textContent = "";
        if (!fieldName.value.trim()) {
          fieldNameError.textContent = "Field name is required.";
          valid = false;
        } else if (fieldName.value.trim().length < 2) {
          fieldNameError.textContent = "Field name must be at least 2 characters.";
          valid = false;
        } else if (fieldName.value.trim().length > 32) {
          fieldNameError.textContent = "Field name must be at most 32 characters.";
          valid = false;
        }
        if (!fieldArea.value || isNaN(fieldArea.value) || parseFloat(fieldArea.value) <= 0) {
          fieldAreaError.textContent = "Area must be a positive number.";
          valid = false;
        } else if (parseFloat(fieldArea.value) > 10000) {
          fieldAreaError.textContent = "Area cannot exceed 10,000 ha.";
          valid = false;
        }
        return valid;
      }
      fieldName.addEventListener("input", validateFieldForm);
      fieldArea.addEventListener("input", validateFieldForm);
      addFieldForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!validateFieldForm()) {
          (fieldNameError.textContent ? fieldName : fieldArea).focus();
          return;
        }
        const name = fieldName.value.trim();
        const area = parseFloat(fieldArea.value);
        // Query the district control at submit time to avoid stale/null refs
        const fieldDistrictEl = document.getElementById("fieldDistrict");
        const districtVal = fieldDistrictEl ? String(fieldDistrictEl.value || "").trim() : "";
        const payload = { name, area };
        if (districtVal) payload.district = districtVal;
        try {
          const response = await this.apiService.post("fields", payload, {
            requiresAuth: true,
          });
          if (response.success) {
            fieldMessage.textContent = "Field added!";
            addFieldForm.reset();
            document.getElementById("addFieldModal").style.display = "none";
            await this._loadFields();
            this._setupDragAndDrop();
          } else {
            fieldMessage.textContent = response.error || "Error adding field.";
          }
        } catch (e) {
          fieldMessage.textContent = "Error adding field.";
        }
      });
    }
    // Add Staff (modal)
    const addStaffForm = document.getElementById("addStaffForm");
    if (addStaffForm) {
      const staffName = document.getElementById("staffName");
      const staffSurname = document.getElementById("staffSurname");
      const staffAge = document.getElementById("staffAge");
      const staffNameError = document.getElementById("staffNameError");
      const staffSurnameError = document.getElementById("staffSurnameError");
      const staffAgeError = document.getElementById("staffAgeError");
      const staffMessage = document.getElementById("staffMessage");
      function validateStaffForm() {
        let valid = true;
        staffNameError.textContent = "";
        staffSurnameError.textContent = "";
        staffAgeError.textContent = "";
        staffMessage.textContent = "";
        if (!staffName.value.trim()) {
          staffNameError.textContent = "Name is required.";
          valid = false;
        } else if (staffName.value.trim().length < 2) {
          staffNameError.textContent = "Name must be at least 2 characters.";
          valid = false;
        }
        if (!staffSurname.value.trim()) {
          staffSurnameError.textContent = "Surname is required.";
          valid = false;
        } else if (staffSurname.value.trim().length < 2) {
          staffSurnameError.textContent = "Surname must be at least 2 characters.";
          valid = false;
        }
        if (!staffAge.value || isNaN(staffAge.value) || parseInt(staffAge.value) < 1 || parseInt(staffAge.value) > 120) {
          staffAgeError.textContent = "Age must be between 1 and 120.";
          valid = false;
        }
        return valid;
      }
      staffName.addEventListener("input", validateStaffForm);
      staffSurname.addEventListener("input", validateStaffForm);
      staffAge.addEventListener("input", validateStaffForm);
      addStaffForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!validateStaffForm()) {
          if (staffNameError.textContent) {
            staffName.focus();
          } else if (staffSurnameError.textContent) {
            staffSurname.focus();
          } else {
            staffAge.focus();
          }
          return;
        }
        const name = staffName.value.trim();
        const surname = staffSurname.value.trim();
        const age = parseInt(staffAge.value);
        try {
          const response = await this.apiService.post("staff", { name, surname, age }, { requiresAuth: true });
          if (response.success) {
            staffMessage.textContent = "Staff added!";
            addStaffForm.reset();
            document.getElementById("addStaffModal").style.display = "none";
            await this._loadStaff();
            this._setupDragAndDrop();
          } else {
            staffMessage.textContent = response.error || "Error adding staff.";
          }
        } catch (e) {
          staffMessage.textContent = "Error adding staff.";
        }
      });
    }
  }

  _setupAnimalModal() {
    const openBtn = document.getElementById("openAddAnimalModal");
    const modal = document.getElementById("addAnimalModal");
    const closeBtn = document.getElementById("closeAddAnimalModal");
    const form = document.getElementById("addAnimalForm");
    const typeSelect = document.getElementById("animalType");
    const amountInput = document.getElementById("animalAmount");
    const fieldSelect = document.getElementById("animalField");
    const messageDiv = document.getElementById("animalMessage");
    if (openBtn)
      openBtn.onclick = () => {
        modal.style.display = "flex";
        this._populateAnimalModalFields();
      };
    if (closeBtn)
      closeBtn.onclick = () => {
        modal.style.display = "none";
        form.reset();
        messageDiv.textContent = "";
        // Clear all error messages
        const typeError = document.getElementById("animalTypeError");
        const amountError = document.getElementById("animalAmountError");
        const fieldError = document.getElementById("animalFieldError");
        if (typeError) typeError.textContent = "";
        if (amountError) amountError.textContent = "";
        if (fieldError) fieldError.textContent = "";
        const searchInput = document.getElementById("animalsSearch");
        if (searchInput) searchInput.value = "";
        this.animalSearchTerm = "";
        this._renderAnimalsPage();
      };
    window.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        form.reset();
        messageDiv.textContent = "";
        // Clear all error messages
        const typeError = document.getElementById("animalTypeError");
        const amountError = document.getElementById("animalAmountError");
        const fieldError = document.getElementById("animalFieldError");
        if (typeError) typeError.textContent = "";
        if (amountError) amountError.textContent = "";
        if (fieldError) fieldError.textContent = "";
      }
    });
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();

        // Clear all error messages
        const typeError = document.getElementById("animalTypeError");
        const amountError = document.getElementById("animalAmountError");
        const fieldError = document.getElementById("animalFieldError");
        messageDiv.textContent = "";
        typeError.textContent = "";
        amountError.textContent = "";
        fieldError.textContent = "";

        const type = typeSelect.value;
        const amount = amountInput.value;
        const fieldId = fieldSelect.value ? Number(fieldSelect.value) : null;

        let valid = true;

        // Validate animal type
        if (!type) {
          typeError.textContent = "Animal type is required.";
          valid = false;
        }

        // Validate amount
        if (!amount) {
          amountError.textContent = "Amount is required.";
          valid = false;
        } else if (isNaN(amount) || Number(amount) <= 0) {
          amountError.textContent = "Amount must be a positive number.";
          valid = false;
        } else if (Number(amount) > 9999999) {
          amountError.textContent = "Amount cannot exceed 9,999,999.";
          valid = false;
        }

        // Validate field (optional but if provided, should be valid)
        if (fieldSelect.value && (!fieldId || isNaN(fieldId))) {
          fieldError.textContent = "Please select a valid field.";
          valid = false;
        }

        if (!valid) return;

        try {
          const response = await this.apiService.addAnimal({ type, amount, fieldId }, { requiresAuth: true });
          if (response.success) {
            modal.style.display = "none";
            form.reset();
            const searchInput = document.getElementById("animalsSearch");
            if (searchInput) searchInput.value = "";
            this.animalSearchTerm = "";
            await this._loadAnimals(true); // Preserve page
            this._renderFieldsPage();
            this._renderFieldAssignments();
            this._renderAnimalsPage(); // Update animal warnings when staff assignments change
            this._setupDragAndDrop();
          } else {
            messageDiv.textContent = response.error || "Error adding animal.";
          }
        } catch (err) {
          messageDiv.textContent = err.message || "Error adding animal.";
        }
      };
    }
    if (amountInput) amountInput.max = 9999999;

    // Add real-time validation
    if (typeSelect) {
      typeSelect.addEventListener("change", () => {
        const typeError = document.getElementById("animalTypeError");
        if (typeSelect.value) {
          typeError.textContent = "";
        }
      });
    }

    if (amountInput) {
      amountInput.addEventListener("input", () => {
        const amountError = document.getElementById("animalAmountError");
        const value = amountInput.value;

        if (!value) {
          amountError.textContent = "";
        } else if (isNaN(value) || Number(value) <= 0) {
          amountError.textContent = "Amount must be a positive number.";
        } else if (Number(value) > 9999999) {
          amountError.textContent = "Amount cannot exceed 9,999,999.";
        } else {
          amountError.textContent = "";
        }
      });
    }

    if (fieldSelect) {
      fieldSelect.addEventListener("change", () => {
        const fieldError = document.getElementById("animalFieldError");
        if (!fieldSelect.value || !isNaN(Number(fieldSelect.value))) {
          fieldError.textContent = "";
        }
      });
    }
  }

  async _populateAnimalModalFields() {
    const typeSelect = document.getElementById("animalType");
    typeSelect.innerHTML = "<option value=''>Loading...</option>";
    try {
      const resp = await this.apiService.get("animals/types", {
        requiresAuth: true,
      });
      const typesObj = resp.success && resp.data && resp.data.data && typeof resp.data.data === "object" ? resp.data.data : {};
      const types = Object.values(typesObj);
      typeSelect.innerHTML = types.map((t) => `<option value='${t.key}'>${t.icon} ${t.fullName}</option>`).join("");
    } catch (e) {
      typeSelect.innerHTML = "<option value=''>Error loading types</option>";
    }
    const fieldSelect = document.getElementById("animalField");
    fieldSelect.innerHTML = "<option value=''>None</option>";
    this.fields.forEach((f) => {
      fieldSelect.innerHTML += `<option value='${f.id}'>${f.name}</option>`;
    });
  }

  _openEditFieldModal(field) {
    let modal = document.getElementById("editFieldModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "editFieldModal";
      modal.className = "modal";
      modal.innerHTML = `
        <div class="modal-content glass">
          <div class="modal-header">
            <h3><i class="fas fa-seedling"></i> Edit Field</h3>
            <button class="modal-close" id="closeEditFieldModal"><i class="fas fa-times"></i></button>
          </div>
          <form id="editFieldForm" class="update-form-modern modal-form" novalidate>
            <div class="form-group-modern">
              <label for="editFieldName" class="form-label-modern"><i class="fas fa-tag"></i> Field Name</label>
              <input type="text" id="editFieldName" class="form-input-modern" maxlength="32" required />
              <div class="form-error" id="editFieldNameError"></div>
            </div>
            <div class="form-group-modern">
              <label for="editFieldArea" class="form-label-modern"><i class="fas fa-ruler-combined"></i> Area (ha)</label>
              <input type="number" id="editFieldArea" class="form-input-modern" min="0.01" max="10000" step="0.01" required />
              <div class="form-error" id="editFieldAreaError"></div>
            </div>
            <div class="form-group-modern" id="editFieldDistrictGroup">
              <label for="editFieldDistrict" class="form-label-modern"><i class="fas fa-map"></i> District (optional)</label>
              <select id="editFieldDistrict" class="form-input-modern">
                <option value="">None</option>
              </select>
              <div class="form-error" id="editFieldDistrictError"></div>
            </div>
            <div class="form-group-modern">
              <button type="submit" class="btn btn-futuristic btn-compact">Save</button>
              <span class="form-error" id="editFieldMessage"></span>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);
      // Close logic
      modal.querySelector("#closeEditFieldModal").onclick = () => {
        modal.style.display = "none";
      };
      modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = "none";
      };
    }
    modal.querySelector(".modal-content").style.padding = "1.2rem 1.2rem 1rem 1.2rem";
    document.getElementById("editFieldName").value = field.name;
    document.getElementById("editFieldArea").value = field.area;
    document.getElementById("editFieldNameError").textContent = "";
    document.getElementById("editFieldAreaError").textContent = "";
    const districtSelect = document.getElementById("editFieldDistrict");
    const districtError = document.getElementById("editFieldDistrictError");
    if (districtError) districtError.textContent = "";
    if (districtSelect) {
      // Populate options each time to reflect latest list
      (async () => {
        try {
          districtSelect.disabled = true;
          districtSelect.innerHTML = `<option value="">Loading…</option>`;
          // Prefer /map/districts (array)
          const resp = await this.apiService.getMapDistricts({
            requiresAuth: true,
          });
          let districts = [];
          if (resp && resp.success && Array.isArray(resp.data)) {
            districts = resp.data;
          } else if (resp && resp.success && resp.data && Array.isArray(resp.data.data)) {
            districts = resp.data.data;
          }
          if (districts.length === 0) {
            // Fallback to fields/districts
            const resp2 = await this.apiService.getDistricts({
              requiresAuth: true,
            });
            if (resp2 && resp2.success) {
              if (Array.isArray(resp2.data)) {
                districts = resp2.data;
              } else if (resp2.data && resp2.data.data && typeof resp2.data.data === "object") {
                districts = Object.keys(resp2.data.data);
              }
            }
          }
          districts = (districts || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
          districtSelect.innerHTML = `<option value="">None</option>` + districts.map((d) => `<option value="${d}">${d}</option>`).join("");
          // Preselect current district if present
          districtSelect.value = field.district || "";
        } catch (err) {
          districtSelect.innerHTML = `<option value="">None</option>`;
        } finally {
          districtSelect.disabled = false;
        }
      })();
    }
    document.getElementById("editFieldMessage").textContent = "";
    modal.style.display = "flex";
    const form = document.getElementById("editFieldForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("editFieldName").value.trim();
      const area = parseFloat(document.getElementById("editFieldArea").value);
      const districtEl = document.getElementById("editFieldDistrict");
      const district = districtEl ? String(districtEl.value || "").trim() : "";
      let valid = true;
      if (!name) {
        document.getElementById("editFieldNameError").textContent = "Field name is required.";
        valid = false;
      } else if (name.length < 2) {
        document.getElementById("editFieldNameError").textContent = "Field name must be at least 2 characters.";
        valid = false;
      } else if (name.length > 32) {
        document.getElementById("editFieldNameError").textContent = "Field name must be at most 32 characters.";
        valid = false;
      } else {
        document.getElementById("editFieldNameError").textContent = "";
      }
      if (!area || isNaN(area) || area <= 0) {
        document.getElementById("editFieldAreaError").textContent = "Area must be a positive number.";
        valid = false;
      } else if (area > 10000) {
        document.getElementById("editFieldAreaError").textContent = "Area cannot exceed 10,000 ha.";
        valid = false;
      } else {
        document.getElementById("editFieldAreaError").textContent = "";
      }
      if (!valid) return;
      try {
        const payload = { name, area };
        // Send null if cleared to remove district
        if (district) payload.district = district;
        else payload.district = null;
        const response = await this.apiService.put(`fields/${field.id}`, payload, { requiresAuth: true });
        if (response.success) {
          document.getElementById("editFieldMessage").textContent = "Field updated!";
          modal.style.display = "none";
          await this._loadFields(true); // Preserve page
          this._renderFieldAssignments();
        } else {
          document.getElementById("editFieldMessage").textContent = response.error || "Error updating field.";
        }
      } catch (e) {
        document.getElementById("editFieldMessage").textContent = "Error updating field.";
      }
    };
  }

  _openEditStaffModal(staff) {
    let modal = document.getElementById("editStaffModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "editStaffModal";
      modal.className = "modal";
      modal.innerHTML = `
        <div class="modal-content glass">
          <div class="modal-header">
            <h3><i class="fas fa-user-staff"></i> Edit Staff</h3>
            <button class="modal-close" id="closeEditStaffModal"><i class="fas fa-times"></i></button>
          </div>
          <form id="editStaffForm" class="update-form-modern modal-form" novalidate>
            <div class="form-group-modern">
              <label for="editStaffName" class="form-label-modern"><i class="fas fa-user"></i> Name</label>
              <input type="text" id="editStaffName" class="form-input-modern" maxlength="32" required />
              <div class="form-error" id="editStaffNameError"></div>
            </div>
            <div class="form-group-modern">
              <label for="editStaffSurname" class="form-label-modern"><i class="fas fa-user-tag"></i> Surname</label>
              <input type="text" id="editStaffSurname" class="form-input-modern" maxlength="32" required />
              <div class="form-error" id="editStaffSurnameError"></div>
            </div>
            <div class="form-group-modern">
              <label for="editStaffAge" class="form-label-modern"><i class="fas fa-birthday-cake"></i> Age</label>
              <input type="number" id="editStaffAge" class="form-input-modern" min="1" max="120" required />
              <div class="form-error" id="editStaffAgeError"></div>
            </div>
            <div class="form-group-modern">
              <button type="submit" class="btn btn-futuristic btn-compact">Save</button>
              <span class="form-error" id="editStaffMessage"></span>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);
      // Close logic
      modal.querySelector("#closeEditStaffModal").onclick = () => {
        modal.style.display = "none";
      };
      modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = "none";
      };
    }
    modal.querySelector(".modal-content").style.padding = "1.2rem 1.2rem 1rem 1.2rem";
    document.getElementById("editStaffName").value = staff.name;
    document.getElementById("editStaffSurname").value = staff.surname;
    document.getElementById("editStaffAge").value = staff.age;
    document.getElementById("editStaffNameError").textContent = "";
    document.getElementById("editStaffSurnameError").textContent = "";
    document.getElementById("editStaffAgeError").textContent = "";
    document.getElementById("editStaffMessage").textContent = "";
    modal.style.display = "flex";
    const form = document.getElementById("editStaffForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("editStaffName").value.trim();
      const surname = document.getElementById("editStaffSurname").value.trim();
      const age = parseInt(document.getElementById("editStaffAge").value);
      let valid = true;
      if (!name) {
        document.getElementById("editStaffNameError").textContent = "Name is required.";
        valid = false;
      } else if (name.length < 2) {
        document.getElementById("editStaffNameError").textContent = "Name must be at least 2 characters.";
        valid = false;
      } else if (name.length > 32) {
        document.getElementById("editStaffNameError").textContent = "Name must be at most 32 characters.";
        valid = false;
      } else {
        document.getElementById("editStaffNameError").textContent = "";
      }
      if (!surname) {
        document.getElementById("editStaffSurnameError").textContent = "Surname is required.";
        valid = false;
      } else if (surname.length < 2) {
        document.getElementById("editStaffSurnameError").textContent = "Surname must be at least 2 characters.";
        valid = false;
      } else if (surname.length > 32) {
        document.getElementById("editStaffSurnameError").textContent = "Surname must be at most 32 characters.";
        valid = false;
      } else {
        document.getElementById("editStaffSurnameError").textContent = "";
      }
      if (!age || isNaN(age) || age < 1 || age > 120) {
        document.getElementById("editStaffAgeError").textContent = "Age must be between 1 and 120.";
        valid = false;
      } else {
        document.getElementById("editStaffAgeError").textContent = "";
      }
      if (!valid) return;
      try {
        const response = await this.apiService.put(`staff/${staff.id}`, { name, surname, age }, { requiresAuth: true });
        if (response.success) {
          document.getElementById("editStaffMessage").textContent = "Staff updated!";
          modal.style.display = "none";
          await this._loadStaff(true); // Preserve page
          this._renderFieldAssignments();
        } else {
          document.getElementById("editStaffMessage").textContent = response.error || "Error updating staff.";
        }
      } catch (e) {
        document.getElementById("editStaffMessage").textContent = "Error updating staff.";
      }
    };
  }

  _openEditAnimalModal(animal) {
    const modal = document.getElementById("editAnimalModal");
    const closeBtn = document.getElementById("closeEditAnimalModal");
    const form = document.getElementById("editAnimalForm");
    const idInput = document.getElementById("editAnimalId");
    const typeSelect = document.getElementById("editAnimalType");
    const amountInput = document.getElementById("editAnimalAmount");
    const fieldSelect = document.getElementById("editAnimalField");
    const messageDiv = document.getElementById("editAnimalMessage");
    // Populate type dropdown
    typeSelect.innerHTML = '<option value="">Loading...</option>';
    this.apiService.get("animals/types", { requiresAuth: true }).then((resp) => {
      const typesObj = resp.success && resp.data && resp.data.data && typeof resp.data.data === "object" ? resp.data.data : {};
      const types = Object.values(typesObj);
      typeSelect.innerHTML = types.map((t) => `<option value='${t.key}'>${t.icon} ${t.fullName}</option>`).join("");
      typeSelect.value = animal.type;
    });
    // Populate field dropdown
    fieldSelect.innerHTML = "<option value=''>None</option>";
    this.fields.forEach((f) => {
      fieldSelect.innerHTML += `<option value='${f.id}'>${f.name}</option>`;
    });
    fieldSelect.value = animal.fieldId || "";
    // Set other fields
    idInput.value = animal.id;
    amountInput.value = animal.amount;
    messageDiv.textContent = "";
    this._hideAllModals();
    modal.style.display = "flex";
    // Close logic
    closeBtn.onclick = () => {
      modal.style.display = "none";
      form.reset();
      messageDiv.textContent = "";
    };
    window.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        form.reset();
        messageDiv.textContent = "";
      }
    };
    // Submit
    form.onsubmit = async (e) => {
      e.preventDefault();
      messageDiv.textContent = "";
      const id = idInput.value;
      const type = typeSelect.value;
      const amount = amountInput.value;
      const fieldId = fieldSelect.value ? Number(fieldSelect.value) : null;
      if (!type) {
        messageDiv.textContent = "Type is required.";
        return;
      }
      if (!amount || isNaN(amount) || Number(amount) <= 0) {
        messageDiv.textContent = "Amount must be a positive number.";
        return;
      }
      if (Number(amount) > 9999999) {
        messageDiv.textContent = "Amount cannot exceed 9,999,999.";
        return;
      }
      try {
        const response = await this.apiService.put(`animals/${id}`, { type, amount, fieldId }, { requiresAuth: true });
        if (response.success) {
          modal.style.display = "none";
          form.reset();
          await this._loadAnimals(true); // Preserve page
          this._renderFieldsPage();
          this._renderFieldAssignments();
          this._renderAnimalsPage(); // Update animal warnings when staff assignments change
          this._setupDragAndDrop();
        } else {
          messageDiv.textContent = response.error || "Error updating animal.";
        }
      } catch (err) {
        messageDiv.textContent = err.message || "Error updating animal.";
      }
    };
    // Set max attribute for edit animal input
    amountInput.max = 9999999;
  }

  _hideAllModals() {
    document.querySelectorAll(".modal").forEach((m) => (m.style.display = "none"));
  }

  async _showConfirmModal(message, title = "Confirm Action") {
    return new Promise((resolve) => {
      const modal = document.getElementById("confirmModal");
      const msg = document.getElementById("confirmModalMessage");
      const titleEl = document.getElementById("confirmModalTitle");
      const btnCancel = document.getElementById("cancelConfirmModal");
      const btnConfirm = document.getElementById("confirmConfirmModal");
      const btnClose = document.getElementById("closeConfirmModal");
      msg.textContent = message;
      titleEl.textContent = title;
      modal.style.display = "flex";
      const cleanup = () => {
        modal.style.display = "none";
        btnCancel.onclick = null;
        btnConfirm.onclick = null;
        btnClose.onclick = null;
      };
      btnCancel.onclick = () => {
        cleanup();
        resolve(false);
      };
      btnClose.onclick = () => {
        cleanup();
        resolve(false);
      };
      btnConfirm.onclick = () => {
        cleanup();
        resolve(true);
      };
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const page = new StaffFieldsMainPage();
  window.staffFieldsMainPage = page; // Make it globally accessible
  page.init();
});
