// Staff & Fields Assign Page Logic (self-contained)
class StaffFieldsAssignPage {
  constructor() {
    this.apiService = window.ApiService ? new window.ApiService() : null;
    this.fields = [];
    this.staff = [];
    this.assignments = {};
    this.animals = [];
    this.currentVisualization = "grid";
  }

  async init() {
    await this._loadFields();
    await this._loadStaff();
    await this._loadAssignments();
    await this._loadAnimals();
    this._setupModals();
    this._setupVisualizationControls();

    // Ensure the default grid view is properly displayed
    const gridContainer = document.getElementById("assignmentsGrid");
    if (gridContainer) {
      gridContainer.style.display = "grid";
    }

    // Update staff assignment summary
    this._updateStaffAssignmentSummary();

    // Update animal and field warnings
    this._updateAnimalAndFieldWarnings();

    // Set the grid tab as active by default
    this._switchVisualization("grid");
  }

  async _loadFields() {
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
      } else {
        this.fields = [];
      }
    } catch (e) {
      this.fields = [];
    }
  }

  async _loadStaff() {
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
      } else {
        this.staff = [];
      }
    } catch (e) {
      this.staff = [];
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

  async _loadAnimals() {
    try {
      const response = await this.apiService.get("animals", {
        requiresAuth: true,
      });
      const animalsArray =
        response.success && response.data && Array.isArray(response.data.data)
          ? response.data.data
          : [];
      if (response.success && Array.isArray(animalsArray)) {
        this.animals = animalsArray;
      } else {
        this.animals = [];
      }
    } catch (e) {
      this.animals = [];
    }
  }

  _setupVisualizationControls() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        // Find the closest button element with data-viz attribute
        const button = e.target.closest(".tab-btn");
        if (!button) return;

        const vizType = button.getAttribute("data-viz");
        if (!vizType) {
          console.warn("Tab button missing data-viz attribute:", button);
          return;
        }

        this._switchVisualization(vizType);
      });
    });
  }

  _switchVisualization(vizType) {
    // Validate vizType parameter
    if (!vizType || typeof vizType !== "string") {
      console.error("Invalid vizType:", vizType);
      return;
    }

    // Update active button
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-viz") === vizType);
    });

    // Hide all visualization containers
    const containers = [
      "assignmentsList",
      "assignmentsCards",
      "assignmentsTable",
      "assignmentsTimeline",
      "assignmentsGrid",
      "assignmentsTree",
      "assignmentsChart",
    ];

    containers.forEach((containerId) => {
      const container = document.getElementById(containerId);
      if (container) {
        container.style.display = "none";
      }
    });

    // Show selected visualization with appropriate display type
    this.currentVisualization = vizType;
    const targetContainer = document.getElementById(
      `assignments${vizType.charAt(0).toUpperCase() + vizType.slice(1)}`,
    );
    if (targetContainer) {
      // Set appropriate display type based on visualization
      switch (vizType) {
        case "cards":
          targetContainer.style.display = "grid";
          break;
        case "grid":
          targetContainer.style.display = "grid";
          break;
        case "table":
          targetContainer.style.display = "block";
          break;
        case "timeline":
          targetContainer.style.display = "block";
          break;
        case "tree":
          targetContainer.style.display = "block";
          break;
        case "chart":
          targetContainer.style.display = "block";
          break;
        case "list":
        default:
          targetContainer.style.display = "block";
          break;
      }
    }

    // Render the selected visualization
    this._renderAssignments();
  }

  _setupModals() {
    // Assign Modal
    const assignModal = document.getElementById("assignModal");
    const openAssignModal = document.getElementById("openAssignModal");
    const closeAssignModal = document.getElementById("closeAssignModal");
    const cancelAssignModal = document.getElementById("cancelAssignModal");

    // Fields Warning Modal
    const fieldsWarningModal = document.getElementById("fieldsWarningModal");
    const closeFieldsWarningModal = document.getElementById(
      "closeFieldsWarningModal",
    );
    const closeFieldsWarningModalBtn = document.getElementById(
      "closeFieldsWarningModalBtn",
    );
    const fieldsWarningSummary = document.getElementById(
      "fieldsWarningSummary",
    );

    if (openAssignModal)
      openAssignModal.addEventListener("click", () => {
        this._populateAssignModal();
        assignModal.style.display = "flex";
        document.getElementById("assignField").focus();
      });

    if (closeAssignModal)
      closeAssignModal.addEventListener("click", () => {
        assignModal.style.display = "none";
      });

    if (cancelAssignModal)
      cancelAssignModal.addEventListener("click", () => {
        assignModal.style.display = "none";
      });

    if (assignModal)
      assignModal.addEventListener("click", (e) => {
        if (e.target === assignModal) assignModal.style.display = "none";
      });

    // Fields Warning Modal Event Listeners
    if (fieldsWarningSummary) {
      fieldsWarningSummary.addEventListener("click", () => {
        this._showFieldsWarningModal();
      });
    }

    if (closeFieldsWarningModal)
      closeFieldsWarningModal.addEventListener("click", () => {
        fieldsWarningModal.style.display = "none";
      });

    if (closeFieldsWarningModalBtn)
      closeFieldsWarningModalBtn.addEventListener("click", () => {
        fieldsWarningModal.style.display = "none";
      });

    if (fieldsWarningModal)
      fieldsWarningModal.addEventListener("click", (e) => {
        if (e.target === fieldsWarningModal)
          fieldsWarningModal.style.display = "none";
      });

    // Escape closes modals
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        assignModal.style.display = "none";
        fieldsWarningModal.style.display = "none";
      }
    });
    // Assign Staff (modal)
    const assignStaffForm = document.getElementById("assignStaffForm");
    if (assignStaffForm) {
      const assignField = document.getElementById("assignField");
      const assignStaff = document.getElementById("assignStaff");
      const assignFieldError = document.getElementById("assignFieldError");
      const assignStaffError = document.getElementById("assignStaffError");
      function validateAssignForm() {
        let valid = true;
        assignFieldError.textContent = "";
        assignStaffError.textContent = "";
        if (!assignField.value) {
          assignFieldError.textContent = "Please select a field.";
          valid = false;
        }
        if (!assignStaff.value) {
          assignStaffError.textContent = "Please select a staff member.";
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

        const success = await this._assignStaffToField(
          assignField.value,
          assignStaff.value,
        );
        if (success) {
          // Clear form and close modal
          assignStaffForm.reset();
          assignFieldError.textContent = "";
          assignStaffError.textContent = "";
          document.getElementById("assignModal").style.display = "none";

          // Refresh data and render
          await this._loadAssignments();
          this._updateStaffAssignmentSummary();
          this._updateAnimalAndFieldWarnings();
          this._renderAssignments();

          // Repopulate the assign modal with updated staff list
          this._populateAssignModal();
        }
      });
    }
  }

  _populateAssignModal() {
    const assignField = document.getElementById("assignField");
    const assignStaff = document.getElementById("assignStaff");
    if (!assignField || !assignStaff) return;
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

  async _assignStaffToField(fieldId, staffId) {
    // Prevent assigning a staff member to more than one field
    for (const fid in this.assignments) {
      if (
        this.assignments[fid].some((a) => String(a.staffId) === String(staffId))
      ) {
        // Show toast notification
        if (window.showNotification) {
          window.showNotification(
            "This staff member is already assigned to a field.",
            "error",
          );
        }
        return false;
      }
    }

    try {
      const response = await this.apiService.post(
        "fields/assign",
        { fieldId, staffId },
        { requiresAuth: true },
      );

      if (response.success) {
        // Show success toast notification
        if (window.showNotification) {
          window.showNotification("Staff assigned successfully!", "success");
        }
        return true;
      } else {
        // Show error toast notification
        if (window.showNotification) {
          window.showNotification(
            response.error || "Failed to assign staff.",
            "error",
          );
        }
        return false;
      }
    } catch (error) {
      // Show error toast notification
      if (window.showNotification) {
        window.showNotification(
          "An error occurred while assigning staff.",
          "error",
        );
      }
      return false;
    }
  }

  async _removeAssignment(fieldId, staffId) {
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
        // Show success notification
        if (window.showNotification) {
          window.showNotification("Staff unassigned successfully!", "success");
        }

        // Refresh all data and update display
        await this._loadAssignments();
        this._updateStaffAssignmentSummary();
        this._updateAnimalAndFieldWarnings();
        this._renderAssignments();

        // Repopulate the assign modal with updated staff list
        this._populateAssignModal();
      }
    } catch (error) {
      // Show error notification
      if (window.showNotification) {
        window.showNotification("Failed to unassign staff.", "error");
      }
    }
  }

  async _removeAssignmentById(assignmentId) {
    try {
      const response = await this.apiService.delete(
        `fields/assign/${assignmentId}`,
        { requiresAuth: true },
      );
      if (response.success) {
        // Show success notification
        if (window.showNotification) {
          window.showNotification("Staff unassigned successfully!", "success");
        }

        // Refresh all data and update display
        await this._loadFields();
        await this._loadStaff();
        await this._loadAssignments();
        await this._loadAnimals();
        this._updateStaffAssignmentSummary();
        this._updateAnimalAndFieldWarnings();
        this._renderAssignments();

        // Repopulate the assign modal with updated staff list
        this._populateAssignModal();
      }
    } catch (error) {
      // Show error notification
      if (window.showNotification) {
        window.showNotification("Failed to unassign staff.", "error");
      }
    }
  }

  _renderAssignments() {
    switch (this.currentVisualization) {
      case "list":
        this._renderList();
        break;
      case "cards":
        this._renderCards();
        break;
      case "table":
        this._renderTable();
        break;
      case "timeline":
        this._renderTimeline();
        break;
      case "grid":
        this._renderGrid();
        break;
      case "tree":
        this._renderTree();
        break;
      case "chart":
        this._renderChart();
        break;
      default:
        this._renderList();
    }
  }

  _renderList() {
    const assignmentsList = document.getElementById("assignmentsList");
    if (!assignmentsList) return;

    assignmentsList.innerHTML = "";
    for (const fieldId in this.assignments) {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];
      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (s) => String(s.id) === String(assignment.staffId),
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

  _renderCards() {
    const assignmentsCards = document.getElementById("assignmentsCards");
    if (!assignmentsCards) return;

    assignmentsCards.innerHTML = "";
    for (const fieldId in this.assignments) {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];

      // Calculate stats for this field
      const staffCount = assignmentArr.length;
      const totalArea = field.area;
      const avgAreaPerStaff =
        staffCount > 0
          ? (totalArea / staffCount).toLocaleString("pl-PL", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })
          : "0,0";

      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (s) => String(s.id) === String(assignment.staffId),
        );
        if (staff) {
          const card = document.createElement("div");
          card.className = "assignment-card";
          card.innerHTML = `
            <div class="assignment-card-header">
              <h4 class="assignment-card-title">Assignment</h4>
              <div class="assignment-card-actions">
                <button class="btn btn-xs btn-danger btn-unassign" data-unassign="${assignment.id}" title="Unassign">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
            <div class="assignment-card-content">
              <div class="assignment-info-row">
                <span class="assignment-info-label">Staff:</span>
                <span class="assignment-badge staff">
                  <i class="fas fa-user"></i>
                  ${staff.name} ${staff.surname}
                </span>
              </div>
              <div class="assignment-info-row">
                <span class="assignment-info-label">Field:</span>
                <span class="assignment-badge field">
                  <i class="fas fa-leaf"></i>
                  ${field.name}
                </span>
              </div>
              <div class="assignment-info-row">
                <span class="assignment-info-label">Field Stats:</span>
                <div class="assignment-stats">
                  <span class="stat-item">🌾 ${field.area} ha</span>
                  <span class="stat-item">👥 ${staffCount} staff</span>
                  <span class="stat-item">📊 ~${avgAreaPerStaff} ha/staff</span>
                </div>
              </div>
              <div class="assignment-info-row">
                <span class="assignment-info-label">ID:</span>
                <span class="assignment-info-value">${assignment.id}</span>
              </div>
              <div class="assignment-info-row">
                <span class="assignment-info-label">Created:</span>
                <span class="assignment-info-value">${assignment.createdAt ? new Date(assignment.createdAt).toLocaleDateString("pl-PL") : "N/A"}</span>
              </div>
            </div>
          `;
          card.querySelector("button").addEventListener("click", () => {
            this._removeAssignment(fieldId, staff.id);
          });
          assignmentsCards.appendChild(card);
        }
      });
    }
  }

  _renderTable() {
    const assignmentsTable = document.getElementById("assignmentsTable");
    if (!assignmentsTable) return;

    assignmentsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Staff Member</th>
            <th>Field</th>
            <th>Field Stats</th>
            <th>Assignment ID</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
        </tbody>
      </table>
    `;

    const tbody = assignmentsTable.querySelector("tbody");
    for (const fieldId in this.assignments) {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];

      // Calculate stats for this field
      const staffCount = assignmentArr.length;
      const totalArea = field.area;
      const avgAreaPerStaff =
        staffCount > 0
          ? (totalArea / staffCount).toLocaleString("pl-PL", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })
          : "0,0";

      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (s) => String(s.id) === String(assignment.staffId),
        );
        if (staff) {
          const row = document.createElement("tr");
          row.innerHTML = `
            <td>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <i class="fas fa-user" style="color:var(--agri-green);"></i>
                ${staff.name} ${staff.surname}
              </div>
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <i class="fas fa-leaf" style="color:var(--primary-color);"></i>
                ${field.name}
              </div>
            </td>
            <td>
              <div class="table-stats">
                <div class="stat-item">🌾 ${field.area} ha</div>
                <div class="stat-item">👥 ${staffCount} staff</div>
                <div class="stat-item">📊 ~${avgAreaPerStaff} ha/staff</div>
              </div>
            </td>
            <td>${assignment.id}</td>
            <td>${assignment.createdAt ? new Date(assignment.createdAt).toLocaleDateString("pl-PL") : "N/A"}</td>
            <td class="actions-cell">
              <button class="btn btn-xs btn-danger btn-unassign" data-unassign="${assignment.id}" title="Unassign">
                <i class="fas fa-times"></i>
              </button>
            </td>
          `;
          row.querySelector("button").addEventListener("click", () => {
            this._removeAssignment(fieldId, staff.id);
          });
          tbody.appendChild(row);
        }
      });
    }
  }

  _renderTimeline() {
    const assignmentsTimeline = document.getElementById("assignmentsTimeline");
    if (!assignmentsTimeline) return;

    assignmentsTimeline.innerHTML = "";

    // Create a flat array of assignments with metadata
    const timelineData = [];
    for (const fieldId in this.assignments) {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];

      // Calculate stats for this field
      const staffCount = assignmentArr.length;
      const totalArea = field.area;
      const avgAreaPerStaff =
        staffCount > 0
          ? (totalArea / staffCount).toLocaleString("pl-PL", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })
          : "0,0";

      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (s) => String(s.id) === String(assignment.staffId),
        );
        if (staff) {
          timelineData.push({
            assignment,
            field,
            staff,
            staffCount,
            totalArea,
            avgAreaPerStaff,
            timestamp: new Date(assignment.createdAt || Date.now()),
          });
        }
      });
    }

    // Sort by timestamp (newest first)
    timelineData.sort((a, b) => b.timestamp - a.timestamp);

    timelineData.forEach((item, index) => {
      const timelineItem = document.createElement("div");
      timelineItem.className = "timeline-item";
      timelineItem.innerHTML = `
        <div class="timeline-header">
          <h4 class="timeline-title">Assignment #${item.assignment.id}</h4>
          <span class="timeline-time">${item.timestamp.toLocaleDateString("pl-PL")}</span>
        </div>
        <div class="timeline-content">
          <div style="display:flex;align-items:center;gap:1rem;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <i class="fas fa-user" style="color:var(--agri-green);"></i>
              <span>${item.staff.name} ${item.staff.surname}</span>
            </div>
            <i class="fas fa-arrow-right" style="color:var(--text-secondary);"></i>
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <i class="fas fa-leaf" style="color:var(--primary-color);"></i>
              <span>${item.field.name}</span>
            </div>
          </div>
          <div class="timeline-stats">
            <span class="stat-item">🌾 ${item.totalArea} ha</span>
            <span class="stat-item">👥 ${item.staffCount} staff</span>
            <span class="stat-item">📊 ~${item.avgAreaPerStaff} ha/staff</span>
          </div>
          <button class="btn btn-xs btn-danger btn-unassign" data-unassign="${item.assignment.id}" title="Unassign">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      timelineItem.querySelector("button").addEventListener("click", () => {
        this._removeAssignment(item.field.id, item.staff.id);
      });
      assignmentsTimeline.appendChild(timelineItem);
    });
  }

  _renderGrid() {
    const assignmentsGrid = document.getElementById("assignmentsGrid");
    if (!assignmentsGrid) return;

    assignmentsGrid.innerHTML = "";
    for (const fieldId in this.assignments) {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];

      // Calculate stats for this field
      const staffCount = assignmentArr.length;
      const totalArea = field.area;
      const avgAreaPerStaff =
        staffCount > 0
          ? (totalArea / staffCount).toLocaleString("pl-PL", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })
          : "0,0";

      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (s) => String(s.id) === String(assignment.staffId),
        );
        if (staff) {
          const gridItem = document.createElement("div");
          gridItem.className = "grid-item";
          gridItem.innerHTML = `
            <div class="grid-icon">
              <i class="fas fa-link"></i>
            </div>
            <div class="grid-title">${staff.name} ${staff.surname}</div>
            <div class="grid-subtitle">${field.name}</div>
            <div class="grid-stats">
              <div class="stat-item">🌾 ${field.area} ha</div>
              <div class="stat-item">👥 ${staffCount} staff</div>
              <div class="stat-item">📊 ~${avgAreaPerStaff} ha/staff</div>
              <div class="stat-item">📅 ${assignment.createdAt ? new Date(assignment.createdAt).toLocaleDateString("pl-PL") : "N/A"}</div>
            </div>
            <div class="grid-actions">
              <button class="btn btn-xs btn-danger btn-unassign" data-unassign="${assignment.id}" title="Unassign">
                <i class="fas fa-times"></i>
              </button>
            </div>
          `;
          gridItem.querySelector("button").addEventListener("click", () => {
            this._removeAssignment(fieldId, staff.id);
          });
          assignmentsGrid.appendChild(gridItem);
        }
      });
    }
  }

  _renderTree() {
    const assignmentsTree = document.getElementById("assignmentsTree");
    if (!assignmentsTree) return;

    assignmentsTree.innerHTML = "";

    // Group assignments by field
    for (const fieldId in this.assignments) {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) continue;
      const assignmentArr = this.assignments[fieldId];

      const treeNode = document.createElement("div");
      treeNode.className = "tree-node";

      // Calculate additional info for the field
      const staffCount = assignmentArr.length;
      const totalArea = field.area;
      const avgAreaPerStaff =
        staffCount > 0
          ? (totalArea / staffCount).toLocaleString("pl-PL", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })
          : "0,0";

      treeNode.innerHTML = `
        <div class="tree-node-header">
          <div class="tree-node-info">
            <i class="fas fa-leaf tree-node-icon"></i>
            <div class="tree-node-details">
              <span class="tree-node-title">${field.name}</span>
              <div class="tree-node-meta">
                <span class="tree-node-area">${field.area} ha</span>
                <span class="tree-node-staff-count">${staffCount} staff</span>
                <span class="tree-node-avg-area">~${avgAreaPerStaff} ha/staff</span>
              </div>
            </div>
          </div>
          <i class="fas fa-chevron-right tree-node-toggle"></i>
        </div>
        <div class="tree-node-content">
        </div>
      `;

      const treeNodeContent = treeNode.querySelector(".tree-node-content");
      const toggle = treeNode.querySelector(".tree-node-toggle");

      // Add staff assignments as children
      assignmentArr.forEach((assignment) => {
        const staff = this.staff.find(
          (s) => String(s.id) === String(assignment.staffId),
        );
        if (staff) {
          const treeChild = document.createElement("div");
          treeChild.className = "tree-child";
          treeChild.innerHTML = `
            <div class="tree-child-info">
              <i class="fas fa-user tree-child-icon"></i>
              <span class="tree-child-name">${staff.name} ${staff.surname}</span>
              <span class="tree-child-date">${assignment.createdAt ? new Date(assignment.createdAt).toLocaleDateString("pl-PL") : "N/A"}</span>
            </div>
            <div class="tree-child-actions">
              <button class="btn btn-xs btn-danger btn-unassign" data-unassign="${assignment.id}" title="Unassign">
                <i class="fas fa-times"></i>
              </button>
            </div>
          `;
          treeChild.querySelector("button").addEventListener("click", () => {
            this._removeAssignment(fieldId, staff.id);
          });
          treeNodeContent.appendChild(treeChild);
        }
      });

      // Toggle functionality
      const header = treeNode.querySelector(".tree-node-header");
      header.addEventListener("click", () => {
        const isExpanded = toggle.classList.contains("expanded");
        if (isExpanded) {
          toggle.classList.remove("expanded");
          treeNodeContent.style.display = "none";
        } else {
          toggle.classList.add("expanded");
          treeNodeContent.style.display = "block";
        }
      });

      // Initially show content
      toggle.classList.add("expanded");

      assignmentsTree.appendChild(treeNode);
    }
  }

  _renderChart() {
    const assignmentsChart = document.getElementById("assignmentsChart");
    if (!assignmentsChart) return;

    // Clear previous chart
    assignmentsChart.innerHTML = `
      <div class="chart-container">
        <canvas id="fieldsSizeChart" width="400" height="200"></canvas>
      </div>
    `;

    // Prepare data for the chart
    const chartData = [];
    const chartLabels = [];
    const chartColors = [];
    const chartStaffCounts = [];
    const chartAnimalCounts = [];
    const chartHasAnimals = [];

    // Sort fields by area (largest first)
    const sortedFields = [...this.fields].sort((a, b) => b.area - a.area);

    sortedFields.forEach((field, index) => {
      const assignmentsForField = this.assignments[field.id] || [];
      const staffCount = assignmentsForField.length;

      // Calculate animals in this field
      const animalsInField = this.animals.filter(
        (animal) => String(animal.fieldId) === String(field.id),
      );
      const totalAnimals = animalsInField.reduce(
        (sum, animal) => sum + animal.amount,
        0,
      );
      const hasAnimals = totalAnimals > 0;

      chartLabels.push(field.name);
      chartData.push(field.area);
      chartStaffCounts.push(staffCount);
      chartAnimalCounts.push(totalAnimals);
      chartHasAnimals.push(hasAnimals);

      // Generate colors based on staff assignment status and animal presence
      let baseColor;
      if (staffCount === 0) {
        baseColor = "rgba(239, 68, 68, 0.7)"; // Red for no staff
      } else if (staffCount === 1) {
        baseColor = "rgba(245, 158, 11, 0.7)"; // Orange for 1 staff
      } else {
        baseColor = "rgba(34, 197, 94, 0.7)"; // Green for multiple staff
      }

      // Add animal indicator to color (darker border for fields with animals)
      chartColors.push(baseColor);
    });

    // Create the chart
    const ctx = document.getElementById("fieldsSizeChart").getContext("2d");

    // Destroy existing chart if it exists
    if (this.fieldsSizeChartInstance) {
      this.fieldsSizeChartInstance.destroy();
    }

    this.fieldsSizeChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: "Field Area (ha)",
            data: chartData,
            backgroundColor: chartColors,
            borderColor: chartColors.map((color, index) => {
              // Use blue border for fields with animals, normal border for others
              return chartHasAnimals[index]
                ? "rgba(59, 130, 246, 1)"
                : color.replace("0.7", "0.3");
            }),
            borderWidth: 4,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: "Field Sizes, Staff Assignment Status, and Animal Presence",
            font: {
              size: 16,
              weight: "bold",
            },
            color: "var(--text-primary)",
          },
          legend: {
            display: true,
            labels: {
              color: "var(--text-primary)",
              usePointStyle: true,
              padding: 20,
              generateLabels: function (chart) {
                return [
                  {
                    text: "No Staff Assigned",
                    fillStyle: "rgba(239, 68, 68, 0.7)",
                    strokeStyle: "rgba(239, 68, 68, 0.3)",
                    pointStyle: "rect",
                    hidden: false,
                  },
                  {
                    text: "1 Staff Member",
                    fillStyle: "rgba(245, 158, 11, 0.7)",
                    strokeStyle: "rgba(245, 158, 11, 0.3)",
                    pointStyle: "rect",
                    hidden: false,
                  },
                  {
                    text: "Multiple Staff",
                    fillStyle: "rgba(34, 197, 94, 0.7)",
                    strokeStyle: "rgba(34, 197, 94, 0.3)",
                    pointStyle: "rect",
                    hidden: false,
                  },
                  {
                    text: "Has Animals (blue border)",
                    fillStyle: "rgba(59, 130, 246, 0.7)",
                    strokeStyle: "rgba(59, 130, 246, 1)",
                    pointStyle: "rect",
                    hidden: false,
                  },
                ];
              },
            },
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const fieldIndex = context.dataIndex;
                const fieldName = chartLabels[fieldIndex];
                const area = chartData[fieldIndex];
                const staffCount = chartStaffCounts[fieldIndex];
                const animalCount = chartAnimalCounts[fieldIndex];
                const hasAnimals = chartHasAnimals[fieldIndex];

                const tooltipLines = [
                  `Field: ${fieldName}`,
                  `Area: ${area} ha`,
                  `Staff: ${staffCount} assigned`,
                ];

                if (hasAnimals) {
                  tooltipLines.push(`Animals: ${animalCount} 🐄`);
                } else {
                  tooltipLines.push(`Animals: None`);
                }

                return tooltipLines;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: "Area (hectares)",
              color: "var(--text-primary)",
            },
            ticks: {
              color: "var(--text-secondary)",
            },
            grid: {
              color: "rgba(0, 0, 0, 0.1)",
            },
          },
          x: {
            title: {
              display: true,
              text: "Fields",
              color: "var(--text-primary)",
            },
            ticks: {
              color: "var(--text-secondary)",
              maxRotation: 45,
              minRotation: 0,
            },
            grid: {
              color: "rgba(0, 0, 0, 0.1)",
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
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

  _updateResultsSummary(filteredCount, totalCount) {
    const resultsSummary = document.getElementById("resultsSummary");
    if (!resultsSummary) return;

    if (filteredCount === totalCount) {
      resultsSummary.textContent = `Showing all ${totalCount} assignments`;
      resultsSummary.className = "results-summary";
    } else {
      resultsSummary.textContent = `Showing ${filteredCount} of ${totalCount} assignments`;
      resultsSummary.className = "results-summary filter-active";
    }
  }

  _updateStaffAssignmentSummary() {
    const unassignedCountElement = document.getElementById(
      "unassignedStaffCount",
    );
    const totalCountElement = document.getElementById("totalStaffCount");

    if (!unassignedCountElement || !totalCountElement) return;

    // Calculate assigned staff
    const assignedStaffIds = new Set();
    for (const fieldId in this.assignments) {
      const assignmentArr = this.assignments[fieldId] || [];
      assignmentArr.forEach((assignment) => {
        assignedStaffIds.add(assignment.staffId);
      });
    }

    const totalStaff = this.staff.length;
    const assignedStaff = assignedStaffIds.size;
    const unassignedStaff = totalStaff - assignedStaff;

    // Update display
    unassignedCountElement.textContent = unassignedStaff;
    totalCountElement.textContent = totalStaff;

    // Update styling based on availability
    const summaryElement = document.getElementById("staffAssignmentSummary");
    if (summaryElement) {
      if (unassignedStaff === 0) {
        summaryElement.style.background = "rgba(239, 68, 68, 0.05)";
        summaryElement.style.borderColor = "rgba(239, 68, 68, 0.1)";
        summaryElement.querySelector("i").style.color = "var(--danger-color)";
      } else if (unassignedStaff <= 2) {
        summaryElement.style.background = "rgba(245, 158, 11, 0.05)";
        summaryElement.style.borderColor = "rgba(245, 158, 11, 0.1)";
        summaryElement.querySelector("i").style.color = "var(--warning-color)";
      } else {
        summaryElement.style.background = "rgba(34, 197, 94, 0.05)";
        summaryElement.style.borderColor = "rgba(34, 197, 94, 0.1)";
        summaryElement.querySelector("i").style.color = "var(--agri-green)";
      }
    }
  }

  _updateAnimalAndFieldWarnings() {
    // Calculate animals without fields
    const unassignedAnimals = this.animals.filter((animal) => !animal.fieldId);
    const unassignedAnimalsCount = unassignedAnimals.length;

    // Calculate fields with animals but no staff
    const fieldsWithAnimalsButNoStaff = new Set();
    this.animals.forEach((animal) => {
      if (animal.fieldId) {
        const fieldAssignments = this.assignments[animal.fieldId] || [];
        if (fieldAssignments.length === 0) {
          fieldsWithAnimalsButNoStaff.add(animal.fieldId);
        }
      }
    });
    const fieldsWithoutStaffCount = fieldsWithAnimalsButNoStaff.size;

    // Store the fields data for the modal
    this.fieldsWithAnimalsButNoStaff = Array.from(fieldsWithAnimalsButNoStaff);

    // // Update animals warning
    // const animalsWarningElement = document.getElementById('animalsWarningSummary');
    // const unassignedAnimalsCountElement = document.getElementById('unassignedAnimalsCount');

    // if (animalsWarningElement && unassignedAnimalsCountElement) {
    //   if (unassignedAnimalsCount > 0) {
    //     unassignedAnimalsCountElement.textContent = unassignedAnimalsCount;
    //     animalsWarningElement.style.display = 'flex';
    //   } else {
    //     animalsWarningElement.style.display = 'none';
    //   }
    // }

    // Update fields warning
    const fieldsWarningElement = document.getElementById(
      "fieldsWarningSummary",
    );
    const fieldsWithoutStaffCountElement = document.getElementById(
      "fieldsWithoutStaffCount",
    );

    if (fieldsWarningElement && fieldsWithoutStaffCountElement) {
      if (fieldsWithoutStaffCount > 0) {
        fieldsWithoutStaffCountElement.textContent = fieldsWithoutStaffCount;
        fieldsWarningElement.style.display = "flex";
      } else {
        fieldsWarningElement.style.display = "none";
      }
    }
  }

  _showFieldsWarningModal() {
    const fieldsWarningList = document.getElementById("fieldsWarningList");
    if (!fieldsWarningList || !this.fieldsWithAnimalsButNoStaff) return;

    fieldsWarningList.innerHTML = "";

    this.fieldsWithAnimalsButNoStaff.forEach((fieldId) => {
      const field = this.fields.find((f) => String(f.id) === String(fieldId));
      if (!field) return;

      // Get animals in this field
      const animalsInField = this.animals.filter(
        (animal) => String(animal.fieldId) === String(fieldId),
      );
      const totalAnimals = animalsInField.reduce(
        (sum, animal) => sum + animal.amount,
        0,
      );

      const fieldItem = document.createElement("div");
      fieldItem.className = "field-warning-item";
      fieldItem.innerHTML = `
        <div class="field-warning-info">
          <i class="fas fa-leaf field-warning-icon"></i>
          <div class="field-warning-details">
            <h4>${field.name}</h4>
            <p>${field.area} ha • ${totalAnimals} animals<br>No staff assigned</p>
          </div>
        </div>
        <div class="field-warning-actions">
          <button class="btn btn-xs btn-primary" onclick="window.staffFieldsAssignPage._assignStaffToFieldFromModal('${fieldId}')" title="Assign Staff">
            <i class="fas fa-user-plus"></i>
          </button>
        </div>
      `;

      fieldsWarningList.appendChild(fieldItem);
    });

    // Show the modal
    const fieldsWarningModal = document.getElementById("fieldsWarningModal");
    if (fieldsWarningModal) {
      fieldsWarningModal.style.display = "flex";
    }
  }

  _assignStaffToFieldFromModal(fieldId) {
    // Close the warning modal
    const fieldsWarningModal = document.getElementById("fieldsWarningModal");
    if (fieldsWarningModal) {
      fieldsWarningModal.style.display = "none";
    }

    // Open the assign modal with the field pre-selected
    const assignModal = document.getElementById("assignModal");
    const assignField = document.getElementById("assignField");

    if (assignModal && assignField) {
      // Populate the modal first
      this._populateAssignModal();

      // Set the field value and show modal
      assignField.value = fieldId;
      assignModal.style.display = "flex";
      document.getElementById("assignStaff").focus();
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const page = new StaffFieldsAssignPage();
  page.init();
  window.staffFieldsAssignPage = page;
});
