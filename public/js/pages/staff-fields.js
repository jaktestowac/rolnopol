// Staff & Fields Page Logic

class StaffFieldsPage {
  constructor() {
    this.apiService = window.ApiService ? new window.ApiService() : null;
    this.fields = [];
    this.staff = [];
    this.animals = [];
    this.assignments = {}; // { fieldId: [staffId, ...] }
    // Pagination state
    this.fieldsPage = 1;
    this.staffPage = 1;
    this.animalsPage = 1;
    this.itemsPerPage = 5;
    this._fieldsChartType = "bar"; // Default chart type
    this._animalsChartType = "bar"; // Default animals chart type
    this._animalTypesChartType = "bar"; // Default animal types chart type
    this.animalSearchTerm = "";
  }

  async init() {
    await this._loadFields();
    await this._loadStaff();
    await this._loadAssignments();
    await this._loadAnimals();
    this._setupEventListeners();
    this._setupAnimalModal();
    this._renderAssignments();
    this._renderFieldsPage();
    this._renderStaffPage();
    await this._renderAnimalsPage();
    this._renderFieldAssignments();
    this._renderChart();
    this._renderAnimalsChart();
    this._renderAnimalTypesChart();
    this._setupFiltering();
    this._setupDragAndDrop();
    this._setupModals();
    this._setupTabs();
    this._renderStats();
    this._renderAnimalsStats();
    this._setupAnimalSearch();
  }

  _renderStats() {
    // Fields stats
    const fieldsStats = document.getElementById("fieldsStats");
    if (fieldsStats) {
      const totalFields = this.fields.length;
      const totalArea = this.fields.reduce(
        (sum, f) => sum + (parseFloat(f.area) || 0),
        0,
      );
      fieldsStats.innerHTML = `<strong>Fields:</strong> ${totalFields} | <strong>Total Area:</strong> ${totalArea} ha`;
    }
    // Staff stats
    const staffStats = document.getElementById("staffStats");
    if (staffStats) {
      const totalStaff = this.staff.length;
      staffStats.innerHTML = `<strong>Staff:</strong> ${totalStaff}`;
    }
  }

  async _loadFields() {
    const fieldsList = document.getElementById("fieldsList");
    const assignField = document.getElementById("assignField");
    fieldsList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.get("fields", {
        requiresAuth: true,
      });
      const fieldsArray =
        response.success && response.data && Array.isArray(response.data.data)
          ? response.data.data
          : [];
      if (response.success && Array.isArray(fieldsArray)) {
        this.fields = fieldsArray;
        this._renderStats();
        this.fieldsPage = 1; // Reset page on reload
        this._renderFieldsPage();
        assignField.innerHTML = "";
        fieldsArray.forEach((field) => {
          const opt = document.createElement("option");
          opt.value = field.id;
          opt.textContent = `${field.name} (${field.area} ha)`;
          assignField.appendChild(opt);
        });
      } else if (!response.success) {
        fieldsList.innerHTML = `<li>${
          response.error || "Error loading fields."
        }</li>`;
      } else {
        fieldsList.innerHTML = "<li>Error loading fields.</li>";
      }
    } catch (e) {
      fieldsList.innerHTML = "<li>Error loading fields.</li>";
    }
  }

  _renderFieldsPage() {
    const fieldsList = document.getElementById("fieldsList");
    if (!fieldsList) return;
    const start = (this.fieldsPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    const pageFields = this.fields.slice(start, end);
    fieldsList.innerHTML =
      pageFields.length === 0 ? "<li>No fields found.</li>" : "";
    pageFields.forEach((field) => {
      // Get animals assigned to this field
      const assignedAnimals = this.animals.filter(
        (animal) => String(animal.fieldId) === String(field.id),
      );

      // Create animal info display
      let animalInfo = "";
      if (assignedAnimals.length > 0) {
        const animalEmoji = {
          chicken: "🐔",
          cow: "🐄",
          pig: "🐖",
          squid: "🦑",
        };
        // Group by type
        const animalTypeMap = {};
        assignedAnimals.forEach((animal) => {
          if (!animalTypeMap[animal.type]) animalTypeMap[animal.type] = [];
          animalTypeMap[animal.type].push(animal);
        });
        animalInfo = Object.entries(animalTypeMap)
          .map(([type, animals]) => {
            const count = animals.reduce(
              (sum, a) => sum + parseInt(a.amount),
              0,
            );
            const animalIdList = animals.map((a) => a.id).join(",");
            return `<span class='assignment-info badge field-badge assigned-animal' style='color:#2563eb;font-size:0.97em;display:flex;align-items:center;justify-content:space-between;gap:0.5em;margin-bottom:0.1em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class="fa-solid fa-cow"></i> ${animalEmoji[type] || "🐾"} ${count} ${type}</span><button class='btn btn-xs btn-danger btn-unassign btn-unassign-animal-type-field' data-animal-ids='${animalIdList}' title='Unassign all ${type} from field' style='flex-shrink:0;margin-left:0.5em;'>&times;</button></span>`;
          })
          .join("");
        animalInfo = `<div class="list-card-meta mt-1">${animalInfo}</div>`;
      }

      const li = document.createElement("li");
      li.className = `list-card glass mb-1 compact-list-card field-card field-card-${field.id}`;
      li.innerHTML = `
        <div class="list-card-header">
          <span class="list-card-icon field-icon" title="Field"><i class="fas fa-leaf" style='color:#2a7a2a;font-size:0.97em;'></i></span>
          <span class="list-card-title"><strong>${field.name}</strong></span>
          <span class="list-card-area">${field.area} ha</span>
          <button class="btn btn-xs btn-secondary btn-edit-field" title="Edit Field"><i class="fas fa-edit"></i></button>
          <button class="btn btn-xs btn-danger btn-delete-field" title="Delete Field"><i class="fas fa-trash"></i></button>
        </div>
        ${animalInfo}
      `;
      li.dataset.fieldId = field.id;
      // Edit button event
      li.querySelector(".btn-edit-field").addEventListener("click", () => {
        this._openEditFieldModal(field);
      });
      // Delete button event
      li.querySelector(".btn-delete-field").addEventListener(
        "click",
        async () => {
          const confirmed = await this._showConfirmModal(
            "Are you sure you want to delete this field?",
          );
          if (confirmed) {
            try {
              const response = await this.apiService.delete(
                `fields/${field.id}`,
                { requiresAuth: true },
              );
              if (response.success) {
                await this._loadFields();
                this._renderFieldAssignments();
                this._renderChart();
              } else {
                alert(response.error || "Error deleting field.");
              }
            } catch (e) {
              alert("Error deleting field.");
            }
          }
        },
      );
      // Add event listener for unassign animals button if present
      const unassignAnimalsBtn = li.querySelector(
        ".btn-unassign-animals-field",
      );
      if (unassignAnimalsBtn) {
        unassignAnimalsBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const fieldId = unassignAnimalsBtn.getAttribute("data-field-id");
          await this._unassignAllAnimalsFromField(fieldId);
        });
      }
      // Add event listeners for unassign animal type buttons
      const unassignAnimalTypeBtns = li.querySelectorAll(
        ".btn-unassign-animal-type-field",
      );
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
    });
    this._renderFieldsPagination();
    this._renderFieldAssignments(); // Ensure assignments are rendered for visible fields after pagination
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
    // Always place search input above pagination and pagination above list
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
      html += `<button class="pagination-btn${
        i === this.fieldsPage ? " active" : ""
      }" data-page="${i}">${i}</button>`;
    }
    html += `<button class='pagination-btn' data-page='next' ${
      this.fieldsPage === totalPages ? "disabled" : ""
    } title='Next page' aria-label='Next page'>&raquo;</button>`;
    html += `<span class='pagination-info pagination-info-compact'>${this.fieldsPage}/${totalPages}</span>`;
    pagination.innerHTML = html;
    Array.from(pagination.querySelectorAll(".pagination-btn")).forEach(
      (btn) => {
        btn.addEventListener("click", (e) => {
          let page = btn.dataset.page;
          if (page === "prev") page = this.fieldsPage - 1;
          else if (page === "next") page = this.fieldsPage + 1;
          else page = parseInt(page);
          if (page >= 1 && page <= totalPages && page !== this.fieldsPage) {
            this.fieldsPage = page;
            this._renderFieldsPage();
            this._setupDragAndDrop(); // Ensure drag and drop is re-initialized after pagination
          }
        });
      },
    );
  }

  async _loadStaff() {
    const staffList = document.getElementById("staffList");
    const assignStaff = document.getElementById("assignStaff");
    staffList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.get("staff", {
        requiresAuth: true,
      });
      const staffArray =
        response.success && response.data && Array.isArray(response.data.data)
          ? response.data.data
          : [];
      if (response.success && Array.isArray(staffArray)) {
        this.staff = staffArray;
        this._renderStats();
        this.staffPage = 1; // Reset page on reload
        this._renderStaffPage();
        assignStaff.innerHTML = "";
        staffArray.forEach((staff) => {
          const opt = document.createElement("option");
          opt.value = staff.id;
          opt.textContent = `${staff.name} ${staff.surname}`;
          assignStaff.appendChild(opt);
        });
      } else if (!response.success) {
        staffList.innerHTML = `<li>${
          response.error || "Error loading staff."
        }</li>`;
      } else {
        staffList.innerHTML = "<li>Error loading staff.</li>";
      }
    } catch (e) {
      staffList.innerHTML = "<li>Error loading staff.</li>";
    }
  }

  _renderStaffPage() {
    const staffList = document.getElementById("staffList");
    if (!staffList) return;
    const start = (this.staffPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    const pageStaff = this.staff.slice(start, end);
    staffList.innerHTML =
      pageStaff.length === 0 ? "<li>No staff found.</li>" : "";
    pageStaff.forEach((staff) => {
      // Find assignment for this staff
      let assignedField = null;
      let assignmentObj = null;
      for (const fieldId in this.assignments) {
        const assignmentArr = this.assignments[fieldId] || [];
        const found = assignmentArr.find(
          (a) => String(a.staffId) === String(staff.id),
        );
        if (found) {
          assignedField = this.fields.find(
            (f) => String(f.id) === String(fieldId),
          );
          assignmentObj = found;
          break;
        }
      }
      let assignmentInfo =
        "<span class='assignment-info' style='color:#888;font-size:0.97em;'>Unassigned</span>";
      if (assignedField && assignmentObj) {
        assignmentInfo = `<span class='assignment-info badge field-badge' style='color:#2a7a2a;font-size:0.97em;display:flex;align-items:center;justify-content:space-between;gap:0.5em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class=\"fas fa-leaf\"></i>: ${assignedField.name}</span><button class='btn btn-xs btn-danger btn-unassign btn-unassign-staff-card' data-unassign='${assignmentObj.id}' title='Unassign' style='flex-shrink:0;margin-left:0.5em;'>&times;</button></span>`;
      }
      const li = document.createElement("li");
      li.className = `list-card glass mb-1 compact-list-card staff-card staff-card-${staff.id}`;
      li.innerHTML = `
        <div class="list-card-header">
          <span class="list-card-icon staff-icon" title="Staff"><i class="fas fa-user"></i></span>
          <span class="list-card-title"><strong>${staff.name} ${
            staff.surname
          }</strong></span>
          <span class="list-card-age">age: ${staff.age}</span>
          <button class="btn btn-xs btn-secondary btn-edit-staff" title="Edit Staff"><i class="fas fa-edit"></i></button>
          <button class="btn btn-xs btn-danger btn-delete-staff" title="Delete Staff"><i class="fas fa-trash"></i></button>
        </div>
        <div class="list-card-meta mt-1">${assignmentInfo}</div>
      `;
      li.dataset.staffId = staff.id;
      // Edit button event
      li.querySelector(".btn-edit-staff").addEventListener("click", () => {
        this._openEditStaffModal(staff);
      });
      // Delete button event
      li.querySelector(".btn-delete-staff").addEventListener(
        "click",
        async () => {
          const confirmed = await this._showConfirmModal(
            "Are you sure you want to delete this staff?",
          );
          if (confirmed) {
            try {
              const response = await this.apiService.delete(
                `staff/${staff.id}`,
                { requiresAuth: true },
              );
              if (response.success) {
                await this._loadStaff();
                this._setupDragAndDrop(); // Ensure drag handles are refreshed
                this._renderFieldAssignments();
                this._renderChart();
              } else {
                alert(response.error || "Error deleting staff.");
              }
            } catch (e) {
              alert("Error deleting staff.");
            }
          }
        },
      );
      // Unassign button event (if assigned)
      const unassignBtn = li.querySelector(".btn-unassign-staff-card");
      if (unassignBtn) {
        unassignBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const assignmentId = unassignBtn.getAttribute("data-unassign");
          await this._removeAssignmentById(assignmentId);
          await this._loadAssignments();
          this._renderAssignments();
          this._renderStaffPage();
          this._renderFieldAssignments();
          this._renderChart();
          await this._renderAnimalsPage(); // Ensure animal warnings are up-to-date
          this._setupDragAndDrop(); // Ensure drag handles are refreshed
        });
      }
      staffList.appendChild(li);
    });
    this._renderStaffPagination();
    this._setupDragAndDrop(); // Ensure drag handles are refreshed after rendering
  }

  _renderStaffPagination() {
    let pagination = document.getElementById("staffPagination");
    if (pagination && pagination.parentNode) {
      pagination.parentNode.removeChild(pagination);
    }
    pagination = document.createElement("div");
    pagination.id = "staffPagination";
    pagination.className = "pagination";
    // Always place search input above pagination and pagination above list
    const staffList = document.getElementById("staffList");
    let searchInput = document.getElementById("staffSearch");
    if (searchInput && searchInput.parentNode !== staffList.parentNode) {
      staffList.parentNode.insertBefore(searchInput, staffList);
    }
    if (searchInput) {
      searchInput.after(pagination);
    } else {
      staffList.before(pagination);
    }
    const totalPages = Math.ceil(this.staff.length / this.itemsPerPage);
    let html = "";
    html += `<button class='pagination-btn' data-page='prev' ${
      this.staffPage === 1 ? "disabled" : ""
    } title='Previous page' aria-label='Previous page'>&laquo;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="pagination-btn${
        i === this.staffPage ? " active" : ""
      }" data-page="${i}">${i}</button>`;
    }
    html += `<button class='pagination-btn' data-page='next' ${
      this.staffPage === totalPages ? "disabled" : ""
    } title='Next page' aria-label='Next page'>&raquo;</button>`;
    html += `<span class='pagination-info pagination-info-compact'>${this.staffPage}/${totalPages}</span>`;
    pagination.innerHTML = html;
    Array.from(pagination.querySelectorAll(".pagination-btn")).forEach(
      (btn) => {
        btn.addEventListener("click", (e) => {
          let page = btn.dataset.page;
          if (page === "prev") page = this.staffPage - 1;
          else if (page === "next") page = this.staffPage + 1;
          else page = parseInt(page);
          if (page >= 1 && page <= totalPages && page !== this.staffPage) {
            this.staffPage = page;
            this._renderStaffPage();
          }
        });
      },
    );
  }

  _setupModals() {
    // Add Field Modal
    const addFieldModal = document.getElementById("addFieldModal");
    const openAddFieldModal = document.getElementById("openAddFieldModal");
    const closeAddFieldModal = document.getElementById("closeAddFieldModal");
    openAddFieldModal.addEventListener("click", () => {
      addFieldModal.style.display = "flex";
      document.getElementById("fieldName").focus();
    });
    closeAddFieldModal.addEventListener("click", () => {
      addFieldModal.style.display = "none";
    });
    addFieldModal.addEventListener("click", (e) => {
      if (e.target === addFieldModal) addFieldModal.style.display = "none";
    });
    // Add Staff Modal
    const addStaffModal = document.getElementById("addStaffModal");
    const openAddStaffModal = document.getElementById("openAddStaffModal");
    const closeAddStaffModal = document.getElementById("closeAddStaffModal");
    openAddStaffModal.addEventListener("click", () => {
      addStaffModal.style.display = "flex";
      document.getElementById("staffName").focus();
    });
    closeAddStaffModal.addEventListener("click", () => {
      addStaffModal.style.display = "none";
    });
    addStaffModal.addEventListener("click", (e) => {
      if (e.target === addStaffModal) addStaffModal.style.display = "none";
    });
    // Assign Modal
    const assignModal = document.getElementById("assignModal");
    const openAssignModal = document.getElementById("openAssignModal");
    const closeAssignModal = document.getElementById("closeAssignModal");
    openAssignModal.addEventListener("click", () => {
      this._populateAssignModal();
      assignModal.style.display = "flex";
      document.getElementById("assignField").focus();
    });
    closeAssignModal.addEventListener("click", () => {
      assignModal.style.display = "none";
    });
    assignModal.addEventListener("click", (e) => {
      if (e.target === assignModal) assignModal.style.display = "none";
    });
    // Escape closes modals
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        addFieldModal.style.display = "none";
        addStaffModal.style.display = "none";
        assignModal.style.display = "none";
      }
    });
  }

  _setupEventListeners() {
    // Add Field (modal)
    const addFieldForm = document.getElementById("addFieldForm");
    if (addFieldForm) {
      const fieldName = document.getElementById("fieldName");
      const fieldArea = document.getElementById("fieldArea");
      const fieldNameError = document.getElementById("fieldNameError");
      const fieldAreaError = document.getElementById("fieldAreaError");
      const fieldMessage = document.getElementById("fieldMessage");
      function validateFieldForm() {
        let valid = true;
        fieldNameError.textContent = "";
        fieldAreaError.textContent = "";
        fieldMessage.textContent = "";
        if (!fieldName.value.trim()) {
          fieldNameError.textContent = "Field name is required.";
          valid = false;
        } else if (fieldName.value.trim().length < 2) {
          fieldNameError.textContent =
            "Field name must be at least 2 characters.";
          valid = false;
        } else if (fieldName.value.trim().length > 32) {
          fieldNameError.textContent =
            "Field name must be at most 32 characters.";
          valid = false;
        }
        if (
          !fieldArea.value ||
          isNaN(fieldArea.value) ||
          parseFloat(fieldArea.value) <= 0
        ) {
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
        try {
          const response = await this.apiService.post(
            "fields",
            { name, area },
            { requiresAuth: true },
          );
          if (response.success) {
            fieldMessage.textContent = "Field added!";
            addFieldForm.reset();
            document.getElementById("addFieldModal").style.display = "none";
            await this._loadFields();
            this._setupDragAndDrop();
            this._renderFieldAssignments();
            this._renderChart();
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
          staffSurnameError.textContent =
            "Surname must be at least 2 characters.";
          valid = false;
        }
        if (
          !staffAge.value ||
          isNaN(staffAge.value) ||
          parseInt(staffAge.value) < 1 ||
          parseInt(staffAge.value) > 120
        ) {
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
          const response = await this.apiService.post(
            "staff",
            { name, surname, age },
            { requiresAuth: true },
          );
          if (response.success) {
            staffMessage.textContent = "Staff added!";
            addStaffForm.reset();
            document.getElementById("addStaffModal").style.display = "none";
            await this._loadStaff();
            this._setupDragAndDrop(); // Ensure drag handles are refreshed
            this._renderFieldAssignments();
            this._renderChart();
          } else {
            staffMessage.textContent = response.error || "Error adding staff.";
          }
        } catch (e) {
          staffMessage.textContent = "Error adding staff.";
        }
      });
    }
    // Assign Staff (modal)
    const assignStaffForm = document.getElementById("assignStaffForm");
    if (assignStaffForm) {
      const assignField = document.getElementById("assignField");
      const assignStaff = document.getElementById("assignStaff");
      const assignFieldError = document.getElementById("assignFieldError");
      const assignStaffError = document.getElementById("assignStaffError");
      const assignMessage = document.getElementById("assignMessage");
      function validateAssignForm() {
        let valid = true;
        assignFieldError.textContent = "";
        assignStaffError.textContent = "";
        assignMessage.textContent = "";
        if (!assignField.value) {
          assignFieldError.textContent = "Please select a field.";
          valid = false;
        }
        if (!assignStaff.value) {
          assignStaffError.textContent = "Please select a staff.";
          valid = false;
        }
        return valid;
      }
      assignField.addEventListener("change", validateAssignForm);
      assignStaff.addEventListener("change", validateAssignForm);
      assignStaffForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!validateAssignForm()) {
          if (assignFieldError.textContent) {
            assignField.focus();
          } else {
            assignStaff.focus();
          }
          return;
        }
        await this._assignStaffToField(assignField.value, assignStaff.value);
        document.getElementById("assignModal").style.display = "none";
        await this._loadAssignments();
        this._renderAssignments();
        this._renderFieldAssignments();
        this._renderChart();
      });
    }
  }

  async _loadAssignments() {
    try {
      const response = await this.apiService.get("fields/assign", {
        requiresAuth: true,
      });
      const assignmentsArray =
        response.success && response.data && Array.isArray(response.data.data)
          ? response.data.data
          : [];
      this.assignments = assignmentsArray.reduce((acc, a) => {
        if (!acc[a.fieldId]) acc[a.fieldId] = [];
        acc[a.fieldId].push(a);
        return acc;
      }, {});
    } catch {
      this.assignments = {};
    }
  }

  async _assignStaffToField(fieldId, staffId) {
    // Prevent assigning a staff to more than one field
    for (const fid in this.assignments) {
      if (
        this.assignments[fid].some((a) => String(a.staffId) === String(staffId))
      ) {
        const assignMessage = document.getElementById("assignMessage");
        if (assignMessage)
          assignMessage.textContent =
            "This staff is already assigned to a field.";
        return;
      }
    }
    try {
      const response = await this.apiService.post(
        "fields/assign",
        { fieldId, staffId },
        { requiresAuth: true },
      );
      if (response.success) {
        // Reload all data and re-render everything for consistency
        await this._loadFields();
        await this._loadStaff();
        await this._loadAssignments();
        this._renderAssignments();
        this._renderFieldsPage();
        this._renderStaffPage();
        this._renderFieldAssignments();
        this._renderChart();
        await this._renderAnimalsPage(); // Ensure animal warnings are up-to-date
        this._setupDragAndDrop(); // Ensure drag handles are refreshed
      }
    } catch {}
  }

  async _removeAssignment(fieldId, staffId) {
    // Find assignmentId for this fieldId+staffId
    const assignments = this.assignments[fieldId] || [];
    const assignment = assignments.find(
      (a) => String(a.staffId) === String(staffId),
    );
    if (!assignment) return;
    try {
      const response = await this.apiService.delete(
        `fields/assign/${assignment.id}`,
        { requiresAuth: true },
      );
      if (response.success) {
        await this._loadAssignments();
        this._renderAssignments();
        this._renderFieldAssignments();
        this._renderChart();
        this._renderStaffPage(); // <-- Add this line
        await this._renderAnimalsPage(); // Ensure animal warnings are up-to-date
        this._setupDragAndDrop(); // Ensure drag handles are refreshed
      }
    } catch {}
  }

  _renderAssignments() {
    const assignmentsList = document.getElementById("assignmentsList");
    assignmentsList.innerHTML = "";
    for (const fieldId in this.assignments) {
      // Compare as string to match backend data
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];
      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (f) => String(f.id) === String(assignment.staffId),
        );
        if (staff) {
          const div = document.createElement("div");
          div.className = "assignment-item";
          div.innerHTML = `<span class='assignment-info badge field-badge assigned-staff' style='font-weight: 600;color: #2a7a2a;display:flex;align-items:center;justify-content:space-between;max-width:180px;vertical-align:middle;margin-right:0.3em;background:#e6f4ea;padding:0.18em 0.85em;border-radius:12px;font-size:0.97em;gap:0.4em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class="fas fa-user"></i> ${staff.name} ${staff.surname}</span><button class='btn btn-xs btn-danger btn-unassign' data-unassign='${assignment.id}' title='Unassign' style='flex-shrink:0;margin-left:0.5em;padding:0 0.4em;font-size:1em;vertical-align:middle;'>&times;</button></span> <span style='color:#888;'>→</span> <span class='badge field-badge' style='color:#2a7a2a;'><i class="fas fa-leaf"></i> ${field.name}</span>`;
          div.querySelector("button").addEventListener("click", () => {
            this._removeAssignment(fieldId, staff.id);
          });
          assignmentsList.appendChild(div);
        }
      });
    }
  }

  _setupFiltering() {
    // Add simple search/filter for fields and staff
    const fieldsList = document.getElementById("fieldsList");
    const staffList = document.getElementById("staffList");
    // Add search boxes only if not already present
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
          li.style.display = li.textContent.toLowerCase().includes(val)
            ? ""
            : "none";
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
          li.style.display = li.textContent.toLowerCase().includes(val)
            ? ""
            : "none";
        });
      });
    }
  }

  _setupDragAndDrop() {
    // Remove any previous drag event listeners and drag handles from staff and animals
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
    // Staff: always add drag handle, but allow dragging from anywhere on the card if unassigned
    this.staff.forEach((staff) => {
      let assigned = false;
      for (const fieldId in this.assignments) {
        if (
          this.assignments[fieldId].some(
            (a) => String(a.staffId) === String(staff.id),
          )
        ) {
          assigned = true;
          break;
        }
      }
      const card = document.querySelector(`.staff-card-${staff.id}`);
      if (card) {
        // Remove any existing handle, then add
        const oldHandle = card.querySelector(".drag-handle");
        if (oldHandle) oldHandle.remove();
        const handle = document.createElement("span");
        handle.className = "drag-handle" + (assigned ? " drag-disabled" : "");
        handle.title = assigned ? "Already assigned" : "Drag to assign";
        handle.innerHTML = '<i class="fas fa-grip-lines"></i>';
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
    // Animals: always add drag handle, but allow dragging from anywhere on the card if unassigned
    this.animals.forEach((animal) => {
      const card = document.querySelector(`.animal-card-${animal.id}`);
      if (card) {
        // Remove any existing handle, then add
        const oldHandle = card.querySelector(".drag-handle");
        if (oldHandle) oldHandle.remove();
        const assigned = !!animal.fieldId;
        const handle = document.createElement("span");
        handle.className = "drag-handle" + (assigned ? " drag-disabled" : "");
        handle.title = assigned
          ? "Already assigned"
          : "Drag to assign to field";
        handle.innerHTML = '<i class="fas fa-grip-lines"></i>';
        handle.style.cursor = assigned ? "not-allowed" : "grab";
        // Prepend to .list-card-header (not .animal-row1)
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
    // Make fields droppable for both staff and animals
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
            await this._assignStaffToField(field.id, staffId);
            this._setupDragAndDrop();
          } else if (animalId) {
            // Assign animal to field
            await this.apiService.put(
              `animals/${animalId}`,
              { fieldId: field.id },
              { requiresAuth: true },
            );
            await this._loadAnimals();
            await this._renderAnimalsPage();
            this._renderFieldsPage(); // Update field display to show new animal
            this._renderFieldAssignments(); // Ensure staff assignments are preserved
            this._renderAnimalsChart(); // Update animals chart
            this._renderAnimalTypesChart(); // Update animal types chart
            this._setupDragAndDrop();
          }
        };
      }
    });
  }

  _renderFieldAssignments() {
    // Show assigned staff under each field
    const fieldsList = document.getElementById("fieldsList");
    Array.from(fieldsList.children).forEach((li) => {
      const fieldId = li.dataset.fieldId;
      const assignmentArr = this.assignments[fieldId] || [];
      let assigned = "";
      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (f) => String(f.id) === String(assignment.staffId),
        );
        if (staff) {
          assigned += `<span class='assignment-info badge field-badge assigned-staff' style='font-weight: 600;color: #2a7a2a;display:flex;align-items:center;justify-content:space-between;vertical-align:middle;;background:#e6f4ea;padding:0.18em 0.85em;border-radius:12px;font-size:0.97em;gap:0.4em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class="fas fa-user"></i>: ${staff.name} ${staff.surname}</span><button class='btn btn-xs btn-danger btn-unassign' data-unassign='${assignment.id}' title='Unassign' style='flex-shrink:0;margin-left:0.5em;padding:0 0.4em;font-size:1em;vertical-align:middle;'>&times;</button></span> `;
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
      // Unassign buttons
      Array.from(assignedDiv.querySelectorAll("button[data-unassign]")).forEach(
        (btn) => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const assignmentId = btn.getAttribute("data-unassign");
            await this._removeAssignmentById(assignmentId);
            await this._loadAssignments();
            this._renderAssignments();
            this._renderFieldAssignments();
            this._renderChart();
            await this._renderAnimalsPage(); // Ensure animal warnings are up-to-date
            this._setupDragAndDrop(); // Ensure drag handles are refreshed
          });
        },
      );
    });
  }

  async _removeAssignmentById(assignmentId) {
    try {
      const response = await this.apiService.delete(
        `fields/assign/${assignmentId}`,
        { requiresAuth: true },
      );
      if (response.success) {
        // Reload all data and re-render everything for consistency
        await this._loadFields();
        await this._loadStaff();
        await this._loadAssignments();
        this._renderAssignments();
        this._renderFieldsPage();
        this._renderStaffPage();
        this._renderFieldAssignments();
        this._renderChart();
        await this._renderAnimalsPage(); // Ensure animal warnings are up-to-date
        this._setupDragAndDrop(); // Ensure drag handles are refreshed
      }
    } catch {}
  }

  async _renderChart() {
    // Chart type switcher UI
    let chartSwitcher = document.getElementById("fieldsChartSwitcher");
    if (!chartSwitcher) {
      chartSwitcher = document.createElement("div");
      chartSwitcher.id = "fieldsChartSwitcher";
      chartSwitcher.style.display = "flex";
      chartSwitcher.style.gap = "0.5em";
      chartSwitcher.style.alignItems = "center";
      chartSwitcher.style.margin = "0.5em 0 0.5em 0";
      chartSwitcher.innerHTML = `
        <label style="font-weight:500;margin-right:0.5em;">Chart:</label>
        <button class="chart-switch-btn chart-type-btn" data-type="bar">Bar</button>
        <button class="chart-switch-btn chart-type-btn" data-type="pie">Pie</button>
        <button class="chart-switch-btn chart-type-btn" data-type="doughnut">Doughnut</button>
      `;
    }
    // Place switcher and chart in correct container
    const chartContainer = document.getElementById("fieldsChartContainer");
    if (chartContainer) {
      chartContainer.innerHTML = "";
      chartContainer.appendChild(chartSwitcher);
      let canvas = document.getElementById("fieldsChart");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "fieldsChart";
        canvas.style.maxWidth = "100%";
        canvas.style.height = "220px";
        canvas.style.maxHeight = "220px";
      }
      chartContainer.appendChild(canvas);
    }
    chartSwitcher.addEventListener("click", (e) => {
      if (e.target.classList.contains("chart-type-btn")) {
        this._fieldsChartType = e.target.getAttribute("data-type");
        this._renderChart();
      }
    });
    // Set default chart type
    if (!this._fieldsChartType) this._fieldsChartType = "bar";
    // Highlight active button
    Array.from(document.querySelectorAll(".chart-type-btn")).forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-type") === this._fieldsChartType,
      );
    });
    // Load Chart.js if not present
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderChart();
      return;
    }
    const chartCanvas = document.getElementById("fieldsChart");
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
    // Prepare data
    const labels = this.fields.map((f) => f.name);
    const data = this.fields.map((f) => (this.assignments[f.id] || []).length);
    if (this._chartInstance) this._chartInstance.destroy();
    this._chartInstance = new window.Chart(ctx, {
      type: this._fieldsChartType,
      data: {
        labels,
        datasets: [
          {
            label: "Number of Staff Assigned",
            data,
            backgroundColor: [
              "rgba(100, 200, 100, 0.7)",
              "rgba(54, 162, 235, 0.7)",
              "rgba(255, 206, 86, 0.7)",
              "rgba(255, 99, 132, 0.7)",
              "rgba(153, 102, 255, 0.7)",
              "rgba(255, 159, 64, 0.7)",
              "rgba(75, 192, 192, 0.7)",
              "rgba(255, 99, 71, 0.7)",
              "rgba(199, 199, 199, 0.7)",
              "rgba(255, 205, 86, 0.7)",
            ],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: this._fieldsChartType !== "bar" },
          title: { display: true, text: "Staff per Field" },
        },
        scales:
          this._fieldsChartType === "bar"
            ? {
                y: { beginAtZero: true, precision: 0 },
              }
            : {},
      },
    });
  }

  async _renderAnimalsChart() {
    // Chart type switcher UI
    let chartSwitcher = document.getElementById("animalsChartSwitcher");
    if (!chartSwitcher) {
      chartSwitcher = document.createElement("div");
      chartSwitcher.id = "animalsChartSwitcher";
      chartSwitcher.style.display = "flex";
      chartSwitcher.style.gap = "0.5em";
      chartSwitcher.style.alignItems = "center";
      chartSwitcher.style.margin = "0.5em 0 0.5em 0";
      chartSwitcher.innerHTML = `
        <label style="font-weight:500;margin-right:0.5em;">Animals Chart:</label>
        <button class="chart-switch-btn animals-chart-type-btn" data-type="bar">Bar</button>
        <button class="chart-switch-btn animals-chart-type-btn" data-type="pie">Pie</button>
        <button class="chart-switch-btn animals-chart-type-btn" data-type="doughnut">Doughnut</button>
      `;
    }
    // Place switcher and chart in correct container
    const chartContainer = document.getElementById("animalsChartContainer");
    if (chartContainer) {
      chartContainer.innerHTML = "";
      chartContainer.appendChild(chartSwitcher);
      let canvas = document.getElementById("animalsChart");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "animalsChart";
        canvas.style.maxWidth = "100%";
        canvas.style.height = "220px";
        canvas.style.maxHeight = "220px";
      }
      chartContainer.appendChild(canvas);
    }
    chartSwitcher.addEventListener("click", (e) => {
      if (e.target.classList.contains("animals-chart-type-btn")) {
        this._animalsChartType = e.target.getAttribute("data-type");
        this._renderAnimalsChart();
      }
    });
    // Set default chart type
    if (!this._animalsChartType) this._animalsChartType = "bar";
    // Highlight active button
    Array.from(document.querySelectorAll(".animals-chart-type-btn")).forEach(
      (btn) => {
        btn.classList.toggle(
          "active",
          btn.getAttribute("data-type") === this._animalsChartType,
        );
      },
    );
    // Load Chart.js if not present
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderAnimalsChart();
      return;
    }
    const chartCanvas = document.getElementById("animalsChart");
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
    // Prepare data - show animals per field
    const labels = this.fields.map((f) => f.name);
    const animalData = this.fields.map((field) => {
      const assignedAnimals = this.animals.filter(
        (animal) => String(animal.fieldId) === String(field.id),
      );
      return assignedAnimals.reduce(
        (sum, animal) => sum + (parseInt(animal.amount) || 0),
        0,
      );
    });
    if (this._animalsChartInstance) this._animalsChartInstance.destroy();
    this._animalsChartInstance = new window.Chart(ctx, {
      type: this._animalsChartType,
      data: {
        labels,
        datasets: [
          {
            label: "Number of Animals",
            data: animalData,
            backgroundColor: [
              "rgba(255, 99, 132, 0.7)",
              "rgba(54, 162, 235, 0.7)",
              "rgba(255, 206, 86, 0.7)",
              "rgba(75, 192, 192, 0.7)",
              "rgba(153, 102, 255, 0.7)",
              "rgba(255, 159, 64, 0.7)",
              "rgba(100, 200, 100, 0.7)",
              "rgba(255, 99, 71, 0.7)",
              "rgba(199, 199, 199, 0.7)",
              "rgba(255, 205, 86, 0.7)",
            ],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: this._animalsChartType !== "bar" },
          title: { display: true, text: "Animals per Field" },
        },
        scales:
          this._animalsChartType === "bar"
            ? {
                y: { beginAtZero: true, precision: 0 },
              }
            : {},
      },
    });
  }

  async _renderAnimalTypesChart() {
    // Chart type switcher UI
    let chartSwitcher = document.getElementById("animalTypesChartSwitcher");
    if (!chartSwitcher) {
      chartSwitcher = document.createElement("div");
      chartSwitcher.id = "animalTypesChartSwitcher";
      chartSwitcher.style.display = "flex";
      chartSwitcher.style.gap = "0.5em";
      chartSwitcher.style.alignItems = "center";
      chartSwitcher.style.margin = "0.5em 0 0.5em 0";
      chartSwitcher.innerHTML = `
        <label style="font-weight:500;margin-right:0.5em;">Animal Types Chart:</label>
        <button class="chart-switch-btn animal-types-chart-type-btn" data-type="bar">Bar</button>
        <button class="chart-switch-btn animal-types-chart-type-btn" data-type="pie">Pie</button>
        <button class="chart-switch-btn animal-types-chart-type-btn" data-type="doughnut">Doughnut</button>
      `;
    }
    // Place switcher and chart in correct container
    const chartContainer = document.getElementById("animalTypesChartContainer");
    if (chartContainer) {
      chartContainer.innerHTML = "";
      chartContainer.appendChild(chartSwitcher);
      let canvas = document.getElementById("animalTypesChart");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "animalTypesChart";
        canvas.style.maxWidth = "100%";
        canvas.style.height = "220px";
        canvas.style.maxHeight = "220px";
      }
      chartContainer.appendChild(canvas);
    }
    chartSwitcher.addEventListener("click", (e) => {
      if (e.target.classList.contains("animal-types-chart-type-btn")) {
        this._animalTypesChartType = e.target.getAttribute("data-type");
        this._renderAnimalTypesChart();
      }
    });
    // Set default chart type
    if (!this._animalTypesChartType) this._animalTypesChartType = "bar";
    // Highlight active button
    Array.from(
      document.querySelectorAll(".animal-types-chart-type-btn"),
    ).forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-type") === this._animalTypesChartType,
      );
    });
    // Load Chart.js if not present
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderAnimalTypesChart();
      return;
    }
    const chartCanvas = document.getElementById("animalTypesChart");
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
    // Load animal types from API
    let animalTypes = {};
    try {
      const resp = await this.apiService.get("animals/types", {
        requiresAuth: true,
      });
      if (
        resp.success &&
        resp.data &&
        resp.data.data &&
        typeof resp.data.data === "object"
      ) {
        animalTypes = resp.data.data;
      }
    } catch (e) {
      console.error("Error loading animal types:", e);
    }

    const animalTypeCounts = {};
    // If you want to filter only assigned animals, uncomment the next line:
    // const animals = this.animals.filter(animal => animal.fieldId);
    // If you want only unassigned, use: const animals = this.animals.filter(animal => !animal.fieldId);
    const animals = this.animals; // all animals
    animals.forEach((animal) => {
      const type = animal.type;
      let amount = parseInt(animal.amount);
      if (!type || isNaN(amount) || amount <= 0) return;
      if (!animalTypeCounts[type]) {
        animalTypeCounts[type] = 0;
      }
      animalTypeCounts[type] += amount;
    });
    const labels = Object.keys(animalTypeCounts).map((type) => {
      const animalType = animalTypes[type];
      const icon = animalType ? animalType.icon : "🐾";
      const displayName = animalType ? animalType.fullName : type;
      return `${icon} ${displayName}`;
    });
    const data = Object.values(animalTypeCounts);
    if (this._animalTypesChartInstance)
      this._animalTypesChartInstance.destroy();
    this._animalTypesChartInstance = new window.Chart(ctx, {
      type: this._animalTypesChartType,
      data: {
        labels,
        datasets: [
          {
            label: "Number of Animals",
            data: data,
            backgroundColor: [
              "rgba(255, 193, 7, 0.7)",
              "rgba(40, 167, 69, 0.7)",
              "rgba(220, 53, 69, 0.7)",
              "rgba(23, 162, 184, 0.7)",
              "rgba(102, 16, 242, 0.7)",
              "rgba(255, 159, 64, 0.7)",
              "rgba(75, 192, 192, 0.7)",
              "rgba(255, 99, 71, 0.7)",
              "rgba(199, 199, 199, 0.7)",
              "rgba(255, 205, 86, 0.7)",
            ],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: this._animalTypesChartType !== "bar" },
          title: { display: true, text: "Animals by Type" },
        },
        scales:
          this._animalTypesChartType === "bar"
            ? {
                y: { beginAtZero: true, precision: 0 },
              }
            : {},
      },
    });
  }

  _populateAssignModal() {
    // Repopulate selects with latest data
    const assignField = document.getElementById("assignField");
    const assignStaff = document.getElementById("assignStaff");
    assignField.innerHTML = "";
    assignStaff.innerHTML = "";
    this.fields.forEach((field) => {
      const opt = document.createElement("option");
      opt.value = field.id;
      opt.textContent = `${field.name} (${field.area} ha)`;
      assignField.appendChild(opt);
    });
    // Only show staff who are not assigned to any field
    const assignedStaffIds = new Set();
    for (const fieldId in this.assignments) {
      const assignmentArr = this.assignments[fieldId] || [];
      assignmentArr.forEach((assignment) => {
        assignedStaffIds.add(assignment.staffId);
      });
    }
    this.staff.forEach((staff) => {
      if (!assignedStaffIds.has(staff.id)) {
        const opt = document.createElement("option");
        opt.value = staff.id;
        opt.textContent = `${staff.name} ${staff.surname}`;
        assignStaff.appendChild(opt);
      }
    });
  }

  // --- Edit Field Modal Logic ---
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
    // Make modals more compact by reducing padding
    modal.querySelector(".modal-content").style.padding =
      "1.2rem 1.2rem 1rem 1.2rem";
    // Fill form
    document.getElementById("editFieldName").value = field.name;
    document.getElementById("editFieldArea").value = field.area;
    document.getElementById("editFieldNameError").textContent = "";
    document.getElementById("editFieldAreaError").textContent = "";
    document.getElementById("editFieldMessage").textContent = "";
    modal.style.display = "flex";
    // Validation and submit
    const form = document.getElementById("editFieldForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("editFieldName").value.trim();
      const area = parseFloat(document.getElementById("editFieldArea").value);
      let valid = true;
      if (!name) {
        document.getElementById("editFieldNameError").textContent =
          "Field name is required.";
        valid = false;
      } else if (name.length < 2) {
        document.getElementById("editFieldNameError").textContent =
          "Field name must be at least 2 characters.";
        valid = false;
      } else if (name.length > 32) {
        document.getElementById("editFieldNameError").textContent =
          "Field name must be at most 32 characters.";
        valid = false;
      } else {
        document.getElementById("editFieldNameError").textContent = "";
      }
      if (!area || isNaN(area) || area <= 0) {
        document.getElementById("editFieldAreaError").textContent =
          "Area must be a positive number.";
        valid = false;
      } else if (area > 10000) {
        document.getElementById("editFieldAreaError").textContent =
          "Area cannot exceed 10,000 ha.";
        valid = false;
      } else {
        document.getElementById("editFieldAreaError").textContent = "";
      }
      if (!valid) return;
      try {
        const response = await this.apiService.put(
          `fields/${field.id}`,
          { name, area },
          { requiresAuth: true },
        );
        if (response.success) {
          document.getElementById("editFieldMessage").textContent =
            "Field updated!";
          modal.style.display = "none";
          await this._loadFields();
          this._renderFieldAssignments();
          this._renderChart();
        } else {
          document.getElementById("editFieldMessage").textContent =
            response.error || "Error updating field.";
        }
      } catch (e) {
        document.getElementById("editFieldMessage").textContent =
          "Error updating field.";
      }
    };
  }

  // --- Edit Staff Modal Logic ---
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
    // Make modals more compact by reducing padding
    modal.querySelector(".modal-content").style.padding =
      "1.2rem 1.2rem 1rem 1.2rem";
    // Fill form
    document.getElementById("editStaffName").value = staff.name;
    document.getElementById("editStaffSurname").value = staff.surname;
    document.getElementById("editStaffAge").value = staff.age;
    document.getElementById("editStaffNameError").textContent = "";
    document.getElementById("editStaffSurnameError").textContent = "";
    document.getElementById("editStaffAgeError").textContent = "";
    document.getElementById("editStaffMessage").textContent = "";
    modal.style.display = "flex";
    // Validation and submit
    const form = document.getElementById("editStaffForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("editStaffName").value.trim();
      const surname = document.getElementById("editStaffSurname").value.trim();
      const age = parseInt(document.getElementById("editStaffAge").value);
      let valid = true;
      if (!name) {
        document.getElementById("editStaffNameError").textContent =
          "Name is required.";
        valid = false;
      } else if (name.length < 2) {
        document.getElementById("editStaffNameError").textContent =
          "Name must be at least 2 characters.";
        valid = false;
      } else if (name.length > 32) {
        document.getElementById("editStaffNameError").textContent =
          "Name must be at most 32 characters.";
        valid = false;
      } else {
        document.getElementById("editStaffNameError").textContent = "";
      }
      if (!surname) {
        document.getElementById("editStaffSurnameError").textContent =
          "Surname is required.";
        valid = false;
      } else if (surname.length < 2) {
        document.getElementById("editStaffSurnameError").textContent =
          "Surname must be at least 2 characters.";
        valid = false;
      } else if (surname.length > 32) {
        document.getElementById("editStaffSurnameError").textContent =
          "Surname must be at most 32 characters.";
        valid = false;
      } else {
        document.getElementById("editStaffSurnameError").textContent = "";
      }
      if (!age || isNaN(age) || age < 1 || age > 120) {
        document.getElementById("editStaffAgeError").textContent =
          "Age must be between 1 and 120.";
        valid = false;
      } else {
        document.getElementById("editStaffAgeError").textContent = "";
      }
      if (!valid) return;
      try {
        const response = await this.apiService.put(
          `staff/${staff.id}`,
          { name, surname, age },
          { requiresAuth: true },
        );
        if (response.success) {
          document.getElementById("editStaffMessage").textContent =
            "Staff updated!";
          modal.style.display = "none";
          await this._loadStaff();
          this._renderFieldAssignments();
          this._renderChart();
        } else {
          document.getElementById("editStaffMessage").textContent =
            response.error || "Error updating staff.";
        }
      } catch (e) {
        document.getElementById("editStaffMessage").textContent =
          "Error updating staff.";
      }
    };
  }

  async _loadAnimals() {
    const animalsList = document.getElementById("animalsList");
    animalsList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.getAnimals({ requiresAuth: true });
      const animalsArray =
        response.success && response.data && Array.isArray(response.data.data)
          ? response.data.data
          : [];
      if (response.success && Array.isArray(animalsArray)) {
        this.animals = animalsArray;
        this.animalsPage = 1;
        this._renderAnimalsPage();
        this._renderAnimalsStats();
        this._renderAnimalsChart(); // Update animals chart
        this._renderAnimalTypesChart(); // Update animal types chart
      } else {
        animalsList.innerHTML = `<li>${
          response.error || "Error loading animals."
        }</li>`;
      }
    } catch (e) {
      animalsList.innerHTML = "<li>Error loading animals.</li>";
    }
  }

  _renderAnimalsStats() {
    const animalsStats = document.getElementById("animalsStats");
    if (animalsStats) {
      const totalAnimals = this.animals.reduce(
        (sum, a) => sum + (parseInt(a.amount) || 0),
        0,
      );
      animalsStats.innerHTML = `<strong>Total Animals:</strong> ${totalAnimals}`;
    }
  }

  _setupTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");

        // Remove active class from all buttons and contents
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        tabContents.forEach((content) => content.classList.remove("active"));

        // Add active class to clicked button and corresponding content
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
      const field = this.fields.find(
        (f) => String(f.id) === String(animal.fieldId),
      );
      const fieldName = field ? (field.name || "").toLowerCase() : "";
      return type.includes(term) || fieldName.includes(term);
    });
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
      this._hideAllModals();
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

  async _renderAnimalsPage() {
    const animalsList = document.getElementById("animalsList");
    if (!animalsList) return;
    const filteredAnimals = this._getFilteredAnimals();
    const start = (this.animalsPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    const pageAnimals = filteredAnimals.slice(start, end);
    animalsList.innerHTML =
      pageAnimals.length === 0 ? "<li>No animals found.</li>" : "";

    // Load animal types from API
    const animalTypes = {};
    try {
      const resp = await this.apiService.get("animals/types", {
        requiresAuth: true,
      });
      if (resp.success && Array.isArray(resp.data.data)) {
        resp.data.data.forEach((type) => {
          animalTypes[type.key] = type;
        });
      }
    } catch (e) {
      console.error("Error loading animal types:", e);
    }
    pageAnimals.forEach((animal) => {
      const field = this.fields.find(
        (f) => String(f.id) === String(animal.fieldId),
      );
      const animalType = animalTypes[animal.type];
      const emoji = animalType ? animalType.icon : "🐾";
      const assigned = !!animal.fieldId;
      const li = document.createElement("li");
      li.className = `list-card glass mb-1 compact-list-card animal-card animal-card-${animal.id}`;
      // Assignment info (like staff card)
      let assignmentInfo = `<span class='assignment-info' style='color:#888;font-size:0.97em;'>Unassigned</span>`;
      if (field) {
        assignmentInfo = `<span class='assignment-info badge field-badge' style='color:#2a7a2a;font-size:0.97em;display:flex;align-items:center;justify-content:space-between;gap:0.5em;'><span style='flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;'><i class="fas fa-leaf"></i>: ${field.name}</span><button class='btn btn-xs btn-danger btn-unassign btn-unassign-animal-card' data-animal-id='${animal.id}' title='Unassign from field' style='flex-shrink:0;margin-left:0.5em;'>&times;</button></span>`;
      }
      li.innerHTML = `
        <div class="list-card-header" style="display:flex;align-items:center;gap:0.5em;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:0.5em;">
            <span class="drag-handle${assigned ? " drag-disabled" : ""}" title="${assigned ? "Already assigned" : "Drag to assign to field"}"><i class='fas fa-grip-lines'></i></span>
            <span class="list-card-icon animal-icon" title="Animal">${emoji}</span>
            <span class="list-card-title"><strong>${animal.type}</strong></span>
            <span class="list-card-amount" style="display:inline-block;width:60px;text-align:right;">(${animal.amount})</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.3em;">
            <button class="btn btn-xs btn-secondary btn-edit-animal" title="Edit Animal"><i class="fas fa-edit"></i></button>
            <button class="btn btn-xs btn-danger btn-delete-animal" title="Delete Animal"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="list-card-meta mt-1">${assignmentInfo}
          ${
            field &&
            !(
              this.assignments[field.id] &&
              this.assignments[field.id].length > 0
            )
              ? `<span class='field-warning-badge'><i class="fa-solid fa-triangle-exclamation" style="color:orange;"></i> No staff on the field</span>`
              : ""
          }
        </div>
      `;
      li.dataset.animalId = animal.id;
      // Edit button
      li.querySelector(".btn-edit-animal").addEventListener("click", () => {
        this._openEditAnimalModal(animal);
      });
      // Delete button
      li.querySelector(".btn-delete-animal").addEventListener(
        "click",
        async () => {
          const confirmed = await this._showConfirmModal(
            "Are you sure you want to delete this animal?",
          );
          if (confirmed) {
            try {
              const response = await this.apiService.deleteAnimal(animal.id, {
                requiresAuth: true,
              });
              if (response.success) {
                await this._loadAnimals();
                this._renderFieldsPage(); // Update field display to show animal removal
                this._renderFieldAssignments(); // Ensure staff assignments are preserved
                this._renderAnimalsChart(); // Update animals chart
                this._renderAnimalTypesChart(); // Update animal types chart
                this._setupDragAndDrop(); // Ensure drag handles are refreshed for new animals
              } else {
                alert(response.error || "Error deleting animal.");
              }
            } catch (e) {
              alert("Error deleting animal.");
            }
          }
        },
      );
      // Unassign button event (if assigned)
      const unassignBtn = li.querySelector(".btn-unassign-animal-card");
      if (unassignBtn) {
        unassignBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const animalId = unassignBtn.getAttribute("data-animal-id");
          await this._unassignAnimalFromField(animalId);
        });
      }
      // Add event listeners for unassign animal type buttons
      const unassignAnimalTypeBtns = li.querySelectorAll(
        ".btn-unassign-animal-type-field",
      );
      unassignAnimalTypeBtns.forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const animalIds = btn.getAttribute("data-animal-ids").split(",");
          for (const animalId of animalIds) {
            await this._unassignAnimalFromField(animalId);
          }
        });
      });
      animalsList.appendChild(li);
    });
    this._renderAnimalsPagination(filteredAnimals.length);
    this._setupDragAndDrop(); // Ensure drag handles are refreshed after rendering
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
    animalsStats.after(pagination);
    const totalPages = Math.ceil(
      (filteredCount !== undefined ? filteredCount : this.animals.length) /
        this.itemsPerPage,
    );
    let html = "";
    html += `<button class='pagination-btn' data-page='prev' ${
      this.animalsPage === 1 ? "disabled" : ""
    } title='Previous page' aria-label='Previous page'>&laquo;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="pagination-btn${
        i === this.animalsPage ? " active" : ""
      }" data-page="${i}">${i}</button>`;
    }
    html += `<button class='pagination-btn' data-page='next' ${
      this.animalsPage === totalPages ? "disabled" : ""
    } title='Next page' aria-label='Next page'>&raquo;</button>`;
    html += `<span class='pagination-info pagination-info-compact'>${this.animalsPage}/${totalPages}</span>`;
    pagination.innerHTML = html;
    Array.from(pagination.querySelectorAll(".pagination-btn")).forEach(
      (btn) => {
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
      },
    );
  }

  _hideAllModals() {
    document
      .querySelectorAll(".modal")
      .forEach((m) => (m.style.display = "none"));
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
    const typeError = document.getElementById("animalTypeError");
    const amountError = document.getElementById("animalAmountError");
    const fieldError = document.getElementById("animalFieldError");
    // Open modal
    if (openBtn)
      openBtn.onclick = () => {
        this._hideAllModals();
        modal.style.display = "flex";
        this._populateAnimalModalFields();
        typeError.textContent = "";
        amountError.textContent = "";
        fieldError.textContent = "";
        messageDiv.textContent = "";
      };
    if (closeBtn)
      closeBtn.onclick = () => {
        modal.style.display = "none";
        form.reset();
        typeError.textContent = "";
        amountError.textContent = "";
        fieldError.textContent = "";
        messageDiv.textContent = "";
        const searchInput = document.getElementById("animalsSearch");
        if (searchInput) searchInput.value = "";
        this.animalSearchTerm = "";
        this._renderAnimalsPage();
      };
    window.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        form.reset();
        typeError.textContent = "";
        amountError.textContent = "";
        fieldError.textContent = "";
        messageDiv.textContent = "";
      }
    });
    // Field-level validation on input
    typeSelect.addEventListener("input", () => {
      typeError.textContent = "";
    });
    amountInput.addEventListener("input", () => {
      amountError.textContent = "";
    });
    fieldSelect.addEventListener("input", () => {
      fieldError.textContent = "";
    });
    // Submit
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        typeError.textContent = "";
        amountError.textContent = "";
        fieldError.textContent = "";
        messageDiv.textContent = "";
        // Validate
        const type = typeSelect.value;
        const amount = amountInput.value;
        const fieldId = fieldSelect.value ? Number(fieldSelect.value) : null;
        let valid = true;
        if (!type) {
          typeError.textContent = "Type is required.";
          valid = false;
        }
        if (!amount || isNaN(amount) || Number(amount) <= 0) {
          amountError.textContent = "Amount must be a positive number.";
          valid = false;
        } else if (Number(amount) > 9999999) {
          amountError.textContent = "Amount cannot exceed 9,999,999.";
          valid = false;
        }
        // No required validation for fieldId (optional)
        if (!valid) return;
        // Submit
        try {
          const response = await this.apiService.addAnimal(
            { type, amount, fieldId },
            { requiresAuth: true },
          );
          if (response.success) {
            modal.style.display = "none";
            form.reset();
            const searchInput = document.getElementById("animalsSearch");
            if (searchInput) searchInput.value = "";
            this.animalSearchTerm = "";
            await this._loadAnimals();
            this._renderFieldsPage(); // Update field display to show new animal
            this._renderFieldAssignments(); // Ensure staff assignments are preserved
            this._renderAnimalsChart(); // Update animals chart
            this._renderAnimalTypesChart(); // Update animal types chart
            this._setupDragAndDrop(); // Ensure drag handles are refreshed for new animals
          } else {
            messageDiv.textContent = response.error || "Error adding animal.";
          }
        } catch (err) {
          messageDiv.textContent = err.message || "Error adding animal.";
        }
      };
    }
    if (amountInput) amountInput.max = 9999999;
  }

  async _populateAnimalModalFields() {
    // Populate type dropdown
    const typeSelect = document.getElementById("animalType");
    typeSelect.innerHTML = "<option value=''>Loading...</option>";
    try {
      const resp = await this.apiService.get("animals/types", {
        requiresAuth: true,
      });
      const typesObj =
        resp.success &&
        resp.data &&
        resp.data.data &&
        typeof resp.data.data === "object"
          ? resp.data.data
          : {};
      const types = Object.values(typesObj);
      typeSelect.innerHTML = types
        .map((t) => `<option value='${t.key}'>${t.icon} ${t.fullName}</option>`)
        .join("");
    } catch (e) {
      typeSelect.innerHTML = "<option value=''>Error loading types</option>";
    }
    // Populate field dropdown
    const fieldSelect = document.getElementById("animalField");
    fieldSelect.innerHTML = "<option value=''>None</option>";
    this.fields.forEach((f) => {
      fieldSelect.innerHTML += `<option value='${f.id}'>${f.name}</option>`;
    });
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
    this.apiService
      .get("animals/types", { requiresAuth: true })
      .then((resp) => {
        const typesObj =
          resp.success &&
          resp.data &&
          resp.data.data &&
          typeof resp.data.data === "object"
            ? resp.data.data
            : {};
        const types = Object.values(typesObj);
        typeSelect.innerHTML = types
          .map(
            (t) => `<option value='${t.key}'>${t.icon} ${t.fullName}</option>`,
          )
          .join("");
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
        const response = await this.apiService.put(
          `animals/${id}`,
          { type, amount, fieldId },
          { requiresAuth: true },
        );
        if (response.success) {
          modal.style.display = "none";
          form.reset();
          await this._loadAnimals();
          this._renderFieldsPage(); // Update field display to show animal changes
          this._renderFieldAssignments(); // Ensure staff assignments are preserved
          this._renderAnimalsChart(); // Update animals chart
          this._renderAnimalTypesChart(); // Update animal types chart
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

  async _unassignAnimalFromField(animalId) {
    const animal = this.animals.find((a) => String(a.id) === String(animalId));
    if (!animal || !animal.fieldId) return;

    try {
      const response = await this.apiService.put(
        `animals/${animalId}`,
        { fieldId: null },
        { requiresAuth: true },
      );
      if (response.success) {
        await this._loadAnimals();
        this._renderFieldsPage();
        this._renderFieldAssignments(); // Ensure staff assignments are preserved
        this._renderAnimalsPage();
        this._renderAnimalsChart(); // Update animals chart
        this._renderAnimalTypesChart(); // Update animal types chart
        this._setupDragAndDrop();
      } else {
        alert(response.error || "Error unassigning animal from field.");
      }
    } catch (error) {
      alert("Error unassigning animal from field.");
    }
  }

  async _unassignAllAnimalsFromField(fieldId) {
    const animalsToUnassign = this.animals.filter(
      (a) => String(a.fieldId) === String(fieldId),
    );
    for (const animal of animalsToUnassign) {
      try {
        await this.apiService.put(
          `animals/${animal.id}`,
          { fieldId: null },
          { requiresAuth: true },
        );
      } catch (e) {
        // Optionally handle error
      }
    }
    await this._loadAnimals();
    this._renderFieldsPage();
    this._renderFieldAssignments();
    this._renderAnimalsPage();
    this._renderAnimalsChart();
    this._renderAnimalTypesChart();
    this._setupDragAndDrop();
  }
}

// Initialize page logic
window.addEventListener("DOMContentLoaded", () => {
  const page = new StaffFieldsPage();
  page.init();
});
