// Staff & Fields Charts Page Logic

class StaffFieldsChartsPage {
  constructor() {
    this.apiService = window.ApiService ? new window.ApiService() : null;
    this.fields = [];
    this.staff = [];
    this.animals = [];
    this.assignments = {};
    this._fieldsChartType = "bar";
    this._staffChartType = "bar";
    this._animalsChartType = "bar";
    this._animalTypesChartType = "bar";
    // Caching for animal types to avoid repeated API calls
    this._animalTypes = null; // object map: { typeKey: { icon, fullName, ... } }
    this._animalTypesInFlight = null; // Promise for in-flight fetch
  }

  async init() {
    await this._loadFields();
    await this._loadStaff();
    await this._loadAssignments();
    await this._loadAnimals();
    this._renderChart();
    this._renderStaffChart();
    this._renderAnimalsChart();
    this._renderAnimalTypesChart();
  }

  async _loadFields() {
    try {
      const response = await this.apiService.get("fields", {
        requiresAuth: true,
      });
      const fieldsArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
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
      const staffArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
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

  async _loadAnimals() {
    try {
      const response = await this.apiService.get("animals", {
        requiresAuth: true,
      });
      const animalsArray = response.success && response.data && Array.isArray(response.data.data) ? response.data.data : [];
      if (response.success && Array.isArray(animalsArray)) {
        this.animals = animalsArray;
      } else {
        this.animals = [];
      }
    } catch (e) {
      this.animals = [];
    }
  }

  _renderChart() {
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
    // Bind once (replace handler each render to avoid duplicates)
    chartSwitcher.onclick = (e) => {
      if (e.target.classList.contains("chart-type-btn")) {
        this._fieldsChartType = e.target.getAttribute("data-type");
        this._renderChart();
      }
    };
    if (!this._fieldsChartType) this._fieldsChartType = "bar";
    Array.from(document.querySelectorAll(".chart-type-btn")).forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === this._fieldsChartType);
    });
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderChart();
      return;
    }
    const chartCanvas = document.getElementById("fieldsChart");
    if (!chartCanvas) return;
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
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

  async _renderStaffChart() {
    let chartSwitcher = document.getElementById("staffChartSwitcher");
    if (!chartSwitcher) {
      chartSwitcher = document.createElement("div");
      chartSwitcher.id = "staffChartSwitcher";
      chartSwitcher.style.display = "flex";
      chartSwitcher.style.gap = "0.5em";
      chartSwitcher.style.alignItems = "center";
      chartSwitcher.style.margin = "0.5em 0 0.5em 0";
      chartSwitcher.innerHTML = `
        <label style="font-weight:500;margin-right:0.5em;">Staff Chart:</label>
        <button class="chart-switch-btn staff-chart-type-btn" data-type="bar">Bar</button>
        <button class="chart-switch-btn staff-chart-type-btn" data-type="pie">Pie</button>
        <button class="chart-switch-btn staff-chart-type-btn" data-type="doughnut">Doughnut</button>
      `;
    }
    const chartContainer = document.getElementById("staffChartContainer");
    if (chartContainer) {
      chartContainer.innerHTML = "";
      chartContainer.appendChild(chartSwitcher);
      let canvas = document.getElementById("staffChart");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "staffChart";
        canvas.style.maxWidth = "100%";
        canvas.style.height = "220px";
        canvas.style.maxHeight = "220px";
      }
      chartContainer.appendChild(canvas);
    }
    chartSwitcher.onclick = (e) => {
      if (e.target.classList.contains("staff-chart-type-btn")) {
        this._staffChartType = e.target.getAttribute("data-type");
        this._renderStaffChart();
      }
    };
    if (!this._staffChartType) this._staffChartType = "bar";
    Array.from(document.querySelectorAll(".staff-chart-type-btn")).forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === this._staffChartType);
    });
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderStaffChart();
      return;
    }
    const chartCanvas = document.getElementById("staffChart");
    if (!chartCanvas) return;
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
    // Calculate which staff members are assigned to fields
    const assignedStaffIds = new Set();
    for (const fieldId in this.assignments) {
      const assignmentArr = this.assignments[fieldId] || [];
      assignmentArr.forEach((assignment) => {
        assignedStaffIds.add(assignment.staffId);
      });
    }

    // Count assigned and unassigned staff
    const assignedCount = assignedStaffIds.size;
    const unassignedCount = this.staff.length - assignedCount;

    // For pie/doughnut charts, show summary data
    if (this._staffChartType === "pie" || this._staffChartType === "doughnut") {
      const labels = ["Assigned Staff", "Unassigned Staff"];
      const data = [assignedCount, unassignedCount];
      const colors = ["rgba(34, 197, 94, 0.7)", "rgba(239, 68, 68, 0.7)"];

      if (this._staffChartInstance) this._staffChartInstance.destroy();
      this._staffChartInstance = new window.Chart(ctx, {
        type: this._staffChartType,
        data: {
          labels,
          datasets: [
            {
              label: "Staff Count",
              data,
              backgroundColor: colors,
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: true },
            title: { display: true, text: "Staff Assignment Summary" },
          },
        },
      });
      return;
    }

    // For bar charts, show individual staff members
    const labels = this.staff.map((s) => `${s.name} ${s.surname}`);
    const data = this.staff.map((s) => (assignedStaffIds.has(s.id) ? 1 : 0));

    // Create colors based on assignment status
    const colors = this.staff.map(
      (s) =>
        assignedStaffIds.has(s.id)
          ? "rgba(34, 197, 94, 0.7)" // Green for assigned
          : "rgba(239, 68, 68, 0.7)" // Red for unassigned
    );
    if (this._staffChartInstance) this._staffChartInstance.destroy();
    this._staffChartInstance = new window.Chart(ctx, {
      type: this._staffChartType,
      data: {
        labels,
        datasets: [
          {
            label: "Assignment Status",
            data,
            backgroundColor: colors,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false, // Hide legend for bar chart since colors are self-explanatory
          },
          title: {
            display: true,
            text: "Staff Assignment Status (1=Assigned, 0=Unassigned)",
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const value = context.parsed.y;
                return value === 1 ? "Assigned to Field" : "Not Assigned";
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            precision: 0,
            max: 1,
            ticks: {
              stepSize: 1,
              callback: function (value) {
                return value === 1 ? "Assigned" : "Unassigned";
              },
            },
          },
        },
      },
    });
  }

  async _renderAnimalsChart() {
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
    chartSwitcher.onclick = (e) => {
      if (e.target.classList.contains("animals-chart-type-btn")) {
        this._animalsChartType = e.target.getAttribute("data-type");
        this._renderAnimalsChart();
      }
    };
    if (!this._animalsChartType) this._animalsChartType = "bar";
    Array.from(document.querySelectorAll(".animals-chart-type-btn")).forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === this._animalsChartType);
    });
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderAnimalsChart();
      return;
    }
    const chartCanvas = document.getElementById("animalsChart");
    if (!chartCanvas) return;
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
    const labels = this.fields.map((f) => f.name);
    const animalData = this.fields.map((field) => {
      const assignedAnimals = this.animals.filter((animal) => String(animal.fieldId) === String(field.id));
      return assignedAnimals.reduce((sum, animal) => sum + (parseInt(animal.amount) || 0), 0);
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
    chartSwitcher.onclick = (e) => {
      if (e.target.classList.contains("animal-types-chart-type-btn")) {
        this._animalTypesChartType = e.target.getAttribute("data-type");
        this._renderAnimalTypesChart();
      }
    };
    if (!this._animalTypesChartType) this._animalTypesChartType = "bar";
    Array.from(document.querySelectorAll(".animal-types-chart-type-btn")).forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === this._animalTypesChartType);
    });
    if (!window.Chart) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      document.head.appendChild(script);
      script.onload = () => this._renderAnimalTypesChart();
      return;
    }
    const chartCanvas = document.getElementById("animalTypesChart");
    if (!chartCanvas) return;
    chartCanvas.height = 220;
    const ctx = chartCanvas.getContext("2d");
    // Load animal types (cached to prevent repeated requests)
    const animalTypes = await this._getAnimalTypes();
    const animalTypeCounts = {};
    const animals = this.animals;
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
    if (this._animalTypesChartInstance) this._animalTypesChartInstance.destroy();
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

  // Fetch animal types once and cache; dedupe concurrent calls.
  async _getAnimalTypes() {
    if (this._animalTypes) return this._animalTypes;
    if (this._animalTypesInFlight) return await this._animalTypesInFlight;

    this._animalTypesInFlight = (async () => {
      try {
        const resp = await this.apiService.get("animals/types", {
          requiresAuth: true,
        });
        if (resp && resp.success && resp.data && resp.data.data && typeof resp.data.data === "object") {
          this._animalTypes = resp.data.data;
        } else {
          this._animalTypes = {};
        }
      } catch (e) {
        console.error("Error loading animal types:", e);
        this._animalTypes = {};
      }
      return this._animalTypes;
    })();

    try {
      return await this._animalTypesInFlight;
    } finally {
      this._animalTypesInFlight = null;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const page = new StaffFieldsChartsPage();
  window.staffFieldsChartsPage = page; // Expose globally for header stats
  page.init();
});
