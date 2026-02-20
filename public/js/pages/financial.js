/**
 * Financial Tracking Page
 * Handles all financial operations including account management, transactions, and statistics
 */

class FinancialPage {
  constructor() {
    this.currentPage = 1;
    this.pageSize = 20;
    this.currentFilters = {};
    this.fieldErrors = {};
    this.validationTimeout = null;
    this.init();
  }

  async init() {
    try {
      // Check authentication
      if (!window.App || !window.App.getModule("authService")) {
        window.location.href = "/login.html";
        return;
      }

      const authService = window.App.getModule("authService");
      if (!authService.isAuthenticated()) {
        window.location.href = "/login.html";
        return;
      }

      // Initialize page
      this.setupEventListeners();
      this.setupTransferForm();
      await this.setupReportDownload();
      await this.setupCsvExportDownload();
      await this.loadFinancialData();
      await this.loadTransactions();
    } catch (error) {
      console.error("Error initializing financial page:", error);
      this.showError("Failed to initialize financial page");
    }
  }

  setupEventListeners() {
    // Transaction form
    const transactionForm = document.getElementById("transaction-form");
    if (transactionForm) {
      transactionForm.addEventListener("submit", (e) => this.handleTransactionSubmit(e));

      // Setup type selector
      this.setupTypeSelector();

      // Initially disable additional fields until a type is selected
      this.setAdditionalFieldsEnabled(false);

      // Setup amount input
      const amountInput = document.getElementById("transaction-amount");
      if (amountInput) {
        amountInput.addEventListener("input", () => this.debounceValidation("amount"));
        amountInput.addEventListener("blur", (e) => {
          this.formatAmountInput(e);
          this.validateField("amount");
        });
        amountInput.addEventListener("focus", (e) => this.unformatAmountInput(e));
      }

      // Setup category select
      const categorySelect = document.getElementById("transaction-category");
      if (categorySelect) {
        categorySelect.addEventListener("change", () => this.validateField("category"));
        categorySelect.addEventListener("blur", () => this.validateField("category"));
      }

      // Setup description textarea
      const descriptionInput = document.getElementById("transaction-description");
      if (descriptionInput) {
        descriptionInput.addEventListener("input", () => {
          this.debounceValidation("description");
          this.updateCharacterCounter();
        });
        descriptionInput.addEventListener("blur", () => this.validateField("description"));
      }

      // Setup payment inputs
      const cardInput = document.getElementById("transaction-card-number");
      const cvvInput = document.getElementById("transaction-cvv");
      if (cardInput) {
        cardInput.addEventListener("input", () => {
          const digits = cardInput.value.replace(/\D/g, "");
          const parts = digits.match(/.{1,4}/g) || [];
          cardInput.value = parts.join(" ");
          this.validateField("card-number");
        });
        cardInput.addEventListener("blur", () => this.validateField("card-number"));
      }
      if (cvvInput) {
        cvvInput.addEventListener("input", () => this.validateField("cvv"));
        cvvInput.addEventListener("blur", () => this.validateField("cvv"));
      }
    }

    // Setup collapsible form
    this.setupCollapsibleForm();

    // Filters
    const filterType = document.getElementById("filter-type");
    const filterCategory = document.getElementById("filter-category");
    const filterStartDate = document.getElementById("filter-start-date");
    const filterEndDate = document.getElementById("filter-end-date");

    if (filterType) filterType.addEventListener("change", () => this.applyFilters());
    if (filterCategory) filterCategory.addEventListener("change", () => this.applyFilters());
    if (filterStartDate) filterStartDate.addEventListener("change", () => this.applyFilters());
    if (filterEndDate) filterEndDate.addEventListener("change", () => this.applyFilters());

    // Pagination
    const prevPage = document.getElementById("prev-page");
    const nextPage = document.getElementById("next-page");

    if (prevPage) prevPage.addEventListener("click", () => this.changePage(-1));
    if (nextPage) nextPage.addEventListener("click", () => this.changePage(1));
  }

  async setupReportDownload() {
    const reportButton = document.getElementById("download-financial-report");
    if (!reportButton) return;

    const featureFlagsService = window.App?.getModule("featureFlagsService");
    if (!featureFlagsService) {
      reportButton.style.display = "none";
      return;
    }

    let enabled = false;
    try {
      enabled = await featureFlagsService.isEnabled("financialReportsEnabled", false);
    } catch (error) {
      enabled = false;
    }

    if (!enabled) {
      reportButton.style.display = "none";
      return;
    }

    reportButton.style.display = "inline-flex";
    reportButton.addEventListener("click", () => this.downloadFinancialReport());
  }

  async setupCsvExportDownload() {
    const csvButton = document.getElementById("download-financial-csv");
    if (!csvButton) return;

    const featureFlagsService = window.App?.getModule("featureFlagsService");
    if (!featureFlagsService) {
      csvButton.style.display = "none";
      return;
    }

    let enabled = false;
    try {
      enabled = await featureFlagsService.isEnabled("financialCsvExportEnabled", false);
    } catch (error) {
      enabled = false;
    }

    if (!enabled) {
      csvButton.style.display = "none";
      return;
    }

    csvButton.style.display = "inline-flex";
    csvButton.addEventListener("click", () => this.downloadFinancialCsv());
  }

  _getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }

  async downloadFinancialCsv() {
    const csvButton = document.getElementById("download-financial-csv");
    if (!csvButton) return;

    const originalText = csvButton.querySelector(".btn-text")?.textContent || "CSV Export";
    csvButton.disabled = true;
    csvButton.classList.add("loading");
    if (csvButton.querySelector(".btn-text")) {
      csvButton.querySelector(".btn-text").textContent = "Preparing CSV...";
    }

    try {
      const token = this._getCookie("rolnopolToken");
      const params = new URLSearchParams();
      if (this.currentFilters?.type) params.append("type", this.currentFilters.type);
      if (this.currentFilters?.category) params.append("category", this.currentFilters.category);
      if (this.currentFilters?.startDate) params.append("startDate", this.currentFilters.startDate);
      if (this.currentFilters?.endDate) params.append("endDate", this.currentFilters.endDate);

      const endpoint = `/api/v1/financial/export/csv${params.toString() ? `?${params}` : ""}`;
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          ...(token ? { token } : {}),
        },
        credentials: "include",
      });

      if (!response.ok) {
        let message = "Failed to export CSV";
        try {
          const payload = await response.json();
          message = payload?.error || message;
        } catch (error) {
          // ignore parse error
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || "financial-transactions.csv";

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      this.showSuccess("Financial CSV exported");
    } catch (error) {
      console.error("Error exporting financial CSV:", error);
      this.showError(error.message || "Failed to export CSV");
    } finally {
      csvButton.disabled = false;
      csvButton.classList.remove("loading");
      if (csvButton.querySelector(".btn-text")) {
        csvButton.querySelector(".btn-text").textContent = originalText;
      }
    }
  }

  async downloadFinancialReport() {
    const reportButton = document.getElementById("download-financial-report");
    if (!reportButton) return;

    const apiService = window.App?.getModule("apiService");
    if (!apiService) {
      this.showError("API service not available");
      return;
    }

    const originalText = reportButton.querySelector(".btn-text")?.textContent || "Download PDF Report";
    reportButton.disabled = true;
    reportButton.classList.add("loading");
    if (reportButton.querySelector(".btn-text")) {
      reportButton.querySelector(".btn-text").textContent = "Preparing report...";
    }

    try {
      const response = await apiService.request("GET", "financial/report", {
        requiresAuth: true,
      });

      if (!response.success) {
        this.showError(response.error || "Failed to download report");
        return;
      }

      const payload = response.data?.data || response.data;
      const encodedReport = payload?.encodedReport;
      if (!encodedReport) {
        this.showError("Report data is missing");
        return;
      }

      let report;
      try {
        const reportJson = this.decodeBase64Utf8(encodedReport);
        report = JSON.parse(reportJson);
      } catch (error) {
        this.showError("Invalid report data");
        return;
      }

      const filename = payload?.filename || "financial-report.pdf";
      const generated = this.generatePdfFromReport(report, filename);
      if (generated) {
        this.showSuccess("Financial report downloaded");
      }
    } catch (error) {
      console.error("Error downloading financial report:", error);
      this.showError("Failed to download financial report");
    } finally {
      reportButton.disabled = false;
      reportButton.classList.remove("loading");
      if (reportButton.querySelector(".btn-text")) {
        reportButton.querySelector(".btn-text").textContent = originalText;
      }
    }
  }

  decodeBase64Utf8(base64) {
    try {
      const binary = atob(base64);
      const bytes = Array.from(binary).map((char) => char.charCodeAt(0));
      const encoded = bytes.map((byte) => `%${`00${byte.toString(16)}`.slice(-2)}`).join("");
      return decodeURIComponent(encoded);
    } catch (error) {
      return atob(base64);
    }
  }

  generatePdfFromReport(report, filename) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) {
      this.showError("PDF generator is not available");
      return false;
    }

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = margin;

    // Colors
    const primaryColor = [106, 123, 94]; // Rolnopol green
    const accentDark = [90, 107, 78]; // Dark green
    const incomeColor = [76, 175, 80]; // Green
    const expenseColor = [244, 67, 54]; // Red
    const neutralColor = [108, 117, 125]; // Gray
    const lightBg = [245, 245, 245]; // Light gray background

    const drawHeader = () => {
      // Header background
      doc.setFillColor(...primaryColor);
      doc.rect(0, 0, pageWidth, 45, "F");

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(28);
      doc.setFont(undefined, "bold");
      doc.text("Financial Report", margin, 20);

      // Subtitle with date
      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.text(`Generated: ${report?.generatedAtLabel || "-"}`, margin, 32);

      y = 50;
    };

    const addSectionTitle = (title) => {
      if (y + 15 > pageHeight - 10) {
        doc.addPage();
        y = margin;
      }

      doc.setDrawColor(...primaryColor);
      doc.setLineWidth(0.5);
      doc.line(margin, y + 3, pageWidth - margin, y + 3);

      doc.setTextColor(...primaryColor);
      doc.setFontSize(14);
      doc.setFont(undefined, "bold");
      doc.text(title, margin, y + 10);

      y += 16;
    };

    const drawSummaryCards = () => {
      const cardWidth = (pageWidth - margin * 2 - 6) / 4;
      const cardHeight = 28;
      const cardY = y;

      const cards = [
        {
          label: "Current Balance",
          value: `${Number(report?.balance || 0).toFixed(2)}`,
          color: primaryColor,
          unit: " ROL",
        },
        {
          label: "Total Income",
          value: `${Number(report?.summary?.totalIncome || 0).toFixed(2)}`,
          color: incomeColor,
          unit: " ROL",
        },
        {
          label: "Total Expenses",
          value: `${Number(report?.summary?.totalExpenses || 0).toFixed(2)}`,
          color: expenseColor,
          unit: " ROL",
        },
        {
          label: "Net Result",
          value: `${Number(report?.summary?.net || 0).toFixed(2)}`,
          color: report?.summary?.net >= 0 ? incomeColor : expenseColor,
          unit: " ROL",
        },
      ];

      let xPos = margin;
      cards.forEach((card) => {
        // Card background
        doc.setFillColor(...card.color);
        doc.rect(xPos, cardY, cardWidth, cardHeight, "F");

        // Label
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont(undefined, "normal");
        doc.text(card.label, xPos + 3, cardY + 7);

        // Value
        doc.setFontSize(14);
        doc.setFont(undefined, "bold");
        const valueText = card.value + card.unit;
        doc.text(valueText, xPos + 3, cardY + 20);

        xPos += cardWidth + 2;
      });

      y = cardY + cardHeight + 8;
    };

    const drawPieChart = () => {
      if (y + 80 > pageHeight - 20) {
        doc.addPage();
        y = margin;
      }

      addSectionTitle("Overview");

      const income = Number(report?.summary?.totalIncome || 0);
      const expenses = Number(report?.summary?.totalExpenses || 0);
      const total = income + expenses;

      if (total === 0) {
        doc.setTextColor(...neutralColor);
        doc.setFontSize(10);
        doc.text("No transactions to visualize", margin, y + 10);
        y += 20;
        return;
      }

      // Prepare canvas-based pie chart and embed as image to avoid using pdf API arc
      const chartSizeMm = 30; // size in mm to render on PDF
      const chartSizePx = 240; // canvas pixel size (high DPI)
      const canvas = document.createElement("canvas");
      canvas.width = chartSizePx;
      canvas.height = chartSizePx;
      const ctx = canvas.getContext("2d");
      const center = chartSizePx / 2;
      const radius = chartSizePx / 2 - 6;
      ctx.clearRect(0, 0, chartSizePx, chartSizePx);

      let start = -Math.PI / 2;
      const incomeAngle = (income / total) * Math.PI * 2;

      // Income slice
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, start + incomeAngle);
      ctx.closePath();
      ctx.fillStyle = `rgb(${incomeColor.join(",")})`;
      ctx.fill();

      // Expense slice
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start + incomeAngle, start + Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = `rgb(${expenseColor.join(",")})`;
      ctx.fill();

      // Add subtle inner circle to make it a donut
      ctx.beginPath();
      ctx.arc(center, center, radius * 0.55, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fill();

      // Convert to data URL and embed
      const dataUrl = canvas.toDataURL("image/png");
      const chartX = margin + 10;
      const chartY = y;
      doc.addImage(dataUrl, "PNG", chartX, chartY, chartSizeMm, chartSizeMm);

      // Legend (to the right of the chart)
      const legendX = chartX + chartSizeMm + 6;
      const legendY = chartY + 2;

      doc.setFillColor(...incomeColor);
      doc.rect(legendX, legendY, 3, 3, "F");
      doc.setTextColor(...neutralColor);
      doc.setFontSize(10);
      doc.text(`Income: ${income.toFixed(2)} ROL (${((income / total) * 100).toFixed(1)}%)`, legendX + 6, legendY + 2.5);

      doc.setFillColor(...expenseColor);
      doc.rect(legendX, legendY + 8, 3, 3, "F");
      doc.text(`Expenses: ${expenses.toFixed(2)} ROL (${((expenses / total) * 100).toFixed(1)}%)`, legendX + 6, legendY + 10.5);

      // Statistics
      const statsX = legendX;
      const statsY = legendY + 22;

      doc.setTextColor(...neutralColor);
      doc.setFontSize(9);
      doc.text(`Transactions: ${Number(report?.summary?.transactionCount || 0)}`, statsX, statsY);
      doc.text(`User ID: ${report?.userId ?? "-"}`, statsX, statsY + 6);
      doc.text(`Currency: ${report?.currency || "ROL"}`, statsX, statsY + 12);

      y = chartY + chartSizeMm + 6;
    };

    const drawTransactionsTable = () => {
      const transactions = Array.isArray(report?.transactions) ? report.transactions : [];

      if (transactions.length === 0) {
        if (y + 10 > pageHeight - 10) {
          doc.addPage();
          y = margin;
        }
        addSectionTitle("Transaction History");
        doc.setTextColor(...neutralColor);
        doc.setFontSize(10);
        doc.text("No transactions recorded.", margin, y);
        y += 10;
        return;
      }

      if (y + 40 > pageHeight - 10) {
        doc.addPage();
        y = margin;
      }

      addSectionTitle("Transaction History");

      const headers = ["Date", "Type", "Category", "Amount", "Balance"];
      const colWidths = [35, 15, 20, 20, 25];
      const headerHeight = 7;
      const rowHeight = 6;
      let tableX = margin;
      let tableY = y;

      // Draw header
      doc.setFillColor(...accentDark);
      doc.rect(tableX, tableY, pageWidth - margin * 2, headerHeight, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont(undefined, "bold");
      doc.setFontSize(9);

      let headerX = tableX + 2;
      headers.forEach((header, idx) => {
        doc.text(header, headerX, tableY + 5);
        headerX += colWidths[idx];
      });

      tableY += headerHeight;

      // Draw rows
      doc.setFont(undefined, "normal");
      doc.setFontSize(8);

      transactions.forEach((tx, index) => {
        // Check if we need a new page
        if (tableY + rowHeight > pageHeight - 10) {
          doc.addPage();
          tableY = margin;

          // Redraw header on new page
          doc.setFillColor(...accentDark);
          doc.rect(tableX, tableY, pageWidth - margin * 2, headerHeight, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont(undefined, "bold");
          doc.setFontSize(9);

          let newHeaderX = tableX + 2;
          headers.forEach((header) => {
            doc.text(header, newHeaderX, tableY + 5);
            newHeaderX += colWidths[0];
          });

          doc.setFont(undefined, "normal");
          doc.setFontSize(8);
          tableY += headerHeight;
        }

        // Alternate row background
        if (index % 2 === 0) {
          doc.setFillColor(...lightBg);
          doc.rect(tableX, tableY, pageWidth - margin * 2, rowHeight, "F");
        }

        // Row text
        doc.setTextColor(33, 33, 33);
        const date = tx.timestamp ? new Date(tx.timestamp).toLocaleDateString("pl-PL") : "-";
        const type = tx.type === "income" ? "+" : "-";
        const category = (tx.category || "general").substring(0, 10);
        const amount = `${type}${Number(tx.amount || 0).toFixed(2)}`;
        const balance = Number(tx.balanceAfter || 0).toFixed(2);

        let rowX = tableX + 2;
        doc.text(date, rowX, tableY + 4.5);
        rowX += colWidths[0];
        doc.text(type, rowX, tableY + 4.5);
        rowX += colWidths[1];
        doc.text(category, rowX, tableY + 4.5);
        rowX += colWidths[2];

        // Color amount based on type
        doc.setTextColor(
          tx.type === "income" ? incomeColor[0] : incomeColor[0],
          tx.type === "income" ? incomeColor[1] : expenseColor[1],
          tx.type === "income" ? incomeColor[2] : expenseColor[2],
        );
        doc.setFont(undefined, "bold");
        doc.text(amount, rowX, tableY + 4.5);
        doc.setFont(undefined, "normal");
        doc.setTextColor(33, 33, 33);

        rowX += colWidths[3];
        doc.text(balance, rowX, tableY + 4.5);

        tableY += rowHeight;
      });

      const totalTransactions = Number(report?.totalTransactions || transactions.length);
      const maxRows = Number(report?.maxRows || transactions.length);
      if (totalTransactions > maxRows) {
        doc.setTextColor(...neutralColor);
        doc.setFontSize(8);
        doc.setFont(undefined, "italic");
        tableY += 3;
        doc.text(`Showing ${maxRows} of ${totalTransactions} transactions`, margin, tableY);
      }

      y = tableY + 10;
    };

    const drawFooter = () => {
      const footerY = pageHeight - 10;
      doc.setDrawColor(...primaryColor);
      doc.setLineWidth(0.3);
      doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);

      doc.setTextColor(...neutralColor);
      doc.setFontSize(8);
      const totalPages = doc.internal.pages.length - 1;
      doc.text(`Page ${totalPages}`, pageWidth - margin - 10, footerY);
      doc.text("© Rolnopol Financial Report", margin, footerY);
    };

    // Helper to draw pie slice
    this.drawPieSlice = (doc, x, y, radius, startAngle, endAngle) => {
      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;
      const x1 = x + radius * Math.cos(startRad);
      const y1 = y + radius * Math.sin(startRad);
      const x2 = x + radius * Math.cos(endRad);
      const y2 = y + radius * Math.sin(endRad);

      doc.moveTo(x, y);
      doc.lineTo(x1, y1);
      doc.arc(x, y, radius, startAngle, endAngle, "F");
      doc.lineTo(x, y);
      doc.fill();
    };

    // Generate report
    drawHeader();
    drawSummaryCards();
    drawPieChart();
    drawTransactionsTable();

    // Add footer to all pages
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawFooter();
    }

    doc.save(filename || "financial-report.pdf");
    return true;
  }

  setupTypeSelector() {
    const typeOptions = document.querySelectorAll(".type-option");
    const typeInput = document.getElementById("transaction-type");
    const cardFields = document.getElementById("card-fields");
    const cvvField = document.getElementById("cvv-field");

    typeOptions.forEach((option) => {
      option.addEventListener("click", () => {
        // Remove selected class from all options
        typeOptions.forEach((opt) => opt.classList.remove("selected"));

        // Add selected class to clicked option
        option.classList.add("selected");

        // Update hidden input value
        const selectedType = option.getAttribute("data-type");
        typeInput.value = selectedType;

        // Show/hide payment fields based on type (only for income)
        if (cardFields && cvvField) {
          const isIncome = selectedType === "income";
          cardFields.style.display = isIncome ? "block" : "none";
          cvvField.style.display = isIncome ? "block" : "none";
        }

        // Enable additional fields now that type is selected
        this.setAdditionalFieldsEnabled(true);

        // Trigger validation
        this.validateField("type");
      });
    });
  }

  setAdditionalFieldsEnabled(enabled) {
    const container = document.getElementById("additional-fields");
    const submitButton = document.getElementById("submit-transaction");
    if (!container) return;

    // Toggle visual disabled state
    container.classList.toggle("fields-disabled", !enabled);

    // Enable/disable all inputs inside
    const controls = container.querySelectorAll("input, select, textarea");
    controls.forEach((el) => {
      el.disabled = !enabled;
    });

    // Manage submit button availability
    if (submitButton) submitButton.disabled = !enabled;

    // Focus amount when enabling
    if (enabled) {
      const amount = document.getElementById("transaction-amount");
      amount?.focus();
    }
  }

  updateCharacterCounter() {
    const descriptionInput = document.getElementById("transaction-description");
    const counterElement = document.getElementById("description-counter");

    if (descriptionInput && counterElement) {
      const currentLength = descriptionInput.value.length;
      const maxLength = 100;

      counterElement.textContent = currentLength;
      counterElement.className = "current";

      if (currentLength >= maxLength * 0.9) {
        counterElement.classList.add("near-limit");
      }
      if (currentLength >= maxLength) {
        counterElement.classList.add("at-limit");
      }
    }
  }

  setupCollapsibleForm() {
    const header = document.getElementById("transaction-form-header");
    const content = document.getElementById("transaction-form-content");
    const icon = document.getElementById("collapse-icon");

    if (!header || !content || !icon) return;

    // Check if form was previously expanded (default to collapsed)
    const isExpanded = localStorage.getItem("transactionFormExpanded") === "true";

    // Set initial state
    if (isExpanded) {
      content.classList.add("expanded");
      icon.style.transform = "rotate(180deg)";
    } else {
      content.classList.add("collapsed");
      icon.style.transform = "rotate(0deg)";
    }

    // Toggle functionality
    const toggleForm = () => {
      const isCurrentlyExpanded = content.classList.contains("expanded");

      if (isCurrentlyExpanded) {
        // Collapse
        content.classList.remove("expanded");
        content.classList.add("collapsed");
        icon.style.transform = "rotate(0deg)";
        localStorage.setItem("transactionFormExpanded", "false");
      } else {
        // Expand
        content.classList.remove("collapsed");
        content.classList.add("expanded");
        icon.style.transform = "rotate(180deg)";
        localStorage.setItem("transactionFormExpanded", "true");
      }
    };

    // Add click event to header
    header.addEventListener("click", (e) => {
      // Don't toggle if clicking on form elements inside the header
      if (e.target.closest("input, select, textarea, button")) {
        return;
      }
      toggleForm();
    });

    // Add keyboard support
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleForm();
      }
    });

    // Make header focusable for accessibility
    header.setAttribute("tabindex", "0");
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", isExpanded);
    header.setAttribute("aria-controls", "transaction-form-content");
  }

  setupTransferForm() {
    // Collapsible logic
    const header = document.getElementById("transfer-form-header");
    const content = document.getElementById("transfer-form-content");
    const icon = document.getElementById("transfer-collapse-icon");
    if (!header || !content || !icon) return;
    let isExpanded = false;
    content.classList.add("collapsed");
    icon.style.transform = "rotate(0deg)";
    const toggleForm = () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        content.classList.remove("collapsed");
        content.classList.add("expanded");
        icon.style.transform = "rotate(180deg)";
      } else {
        content.classList.remove("expanded");
        content.classList.add("collapsed");
        icon.style.transform = "rotate(0deg)";
      }
    };
    header.addEventListener("click", (e) => {
      if (e.target.closest("input, select, textarea, button")) return;
      toggleForm();
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleForm();
      }
    });
    header.setAttribute("tabindex", "0");
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", isExpanded);
    header.setAttribute("aria-controls", "transfer-form-content");

    // Form logic
    const form = document.getElementById("transfer-form");
    if (!form) return;
    form.addEventListener("submit", (e) => this.handleTransferSubmit(e));

    // Per-field validation on blur and input
    const toUserIdInput = document.getElementById("transfer-toUserId");
    const amountInput = document.getElementById("transfer-amount");
    const descriptionInput = document.getElementById("transfer-description");
    toUserIdInput.addEventListener("blur", () => this.validateTransferField("toUserId"));
    toUserIdInput.addEventListener("input", () => this.clearTransferFieldError("toUserId"));
    amountInput.addEventListener("blur", () => this.validateTransferField("amount"));
    amountInput.addEventListener("input", () => this.clearTransferFieldError("amount"));
    descriptionInput.addEventListener("blur", () => this.validateTransferField("description"));
    descriptionInput.addEventListener("input", () => this.clearTransferFieldError("description"));
  }

  formatAmountInput(event) {
    const input = event.target;
    let value = input.value.trim();

    // If empty, don't format
    if (!value) {
      input.removeAttribute("data-raw-value");
      input.classList.remove("error");
      return;
    }

    // Remove all non-numeric characters except digits, dots, and commas
    value = value.replace(/[^\d.,]/g, "");

    // If no valid digits, mark as error but don't clear
    if (!value) {
      input.classList.add("error");
      input.removeAttribute("data-raw-value");
      return;
    }

    // Handle multiple decimal separators
    const decimalSeparators = value.match(/[.,]/g);
    if (decimalSeparators && decimalSeparators.length > 1) {
      // Keep only the last decimal separator
      const lastDecimalIndex = Math.max(value.lastIndexOf("."), value.lastIndexOf(","));
      value = value.substring(0, lastDecimalIndex) + value.substring(lastDecimalIndex).replace(/[.,]/g, "");
    }

    // In Polish format, comma is the decimal separator, so we keep it
    // Convert dot to comma for consistency with Polish format
    value = value.replace(".", ",");

    // Ensure only 2 decimal places
    if (value.includes(",")) {
      const parts = value.split(",");
      if (parts[1].length > 2) {
        parts[1] = parts[1].substring(0, 2);
        value = parts.join(",");
      }
    }

    // Convert to number (replace comma with dot for parseFloat)
    const numValue = parseFloat(value.replace(",", "."));

    // Check if it's a valid positive number
    if (isNaN(numValue) || numValue <= 0) {
      // Mark as error but don't clear the input
      input.classList.add("error");
      input.removeAttribute("data-raw-value");
      return;
    }

    // Check if amount exceeds maximum
    if (numValue > 9999) {
      // Mark as error but don't clear the input
      input.classList.add("error");
      input.removeAttribute("data-raw-value");
      return;
    }

    // If valid, remove error styling and format
    input.classList.remove("error");

    // Format with thousand separators and 2 decimal places
    const formattedValue = this.formatCurrency(numValue);

    // Update input value
    input.value = formattedValue;

    // Store raw numeric value for form submission
    input.setAttribute("data-raw-value", numValue.toString());
  }

  unformatAmountInput(event) {
    const input = event.target;
    const rawValue = input.getAttribute("data-raw-value");

    if (rawValue) {
      // Show raw numeric value when focused for editing
      input.value = rawValue;
    }
    // Don't clear the field if no raw value - let user see what they typed
  }

  formatCurrency(amount) {
    // Format with Polish locale (spaces as thousand separators, comma as decimal)
    return new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  formatNumber(number, decimals = 2) {
    // Format numbers with Polish locale
    return new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(number);
  }

  async loadFinancialData() {
    try {
      // Load account data
      const accountResponse = await this.apiCall("GET", "financial/account");
      if (accountResponse.success) {
        // Always pass the actual account object to updateAccountDisplay
        let accountData = accountResponse.data.data || accountResponse.data;
        if (accountData && accountData.account) {
          accountData = accountData.account;
        }
        this.updateAccountDisplay(accountData);
      } else {
        console.error("Account API error:", accountResponse.error);
        this.showError(`Failed to load account: ${accountResponse.error}`);
      }

      // Load financial statistics
      const statsResponse = await this.apiCall("GET", "financial/stats");
      if (statsResponse.success) {
        // Always pass the statistics object directly
        const statsData = statsResponse.data.data && statsResponse.data.data.statistics ? statsResponse.data.data.statistics : {};
        this.updateStatsDisplay(statsData);
      } else {
        console.error("Stats API error:", statsResponse.error);
        this.showError(`Failed to load statistics: ${statsResponse.error}`);
      }
    } catch (error) {
      console.error("Error loading financial data:", error);
      this.showError("Failed to load financial data");
    }
  }

  async loadTransactions() {
    try {
      const container = document.getElementById("transactions-container");
      if (!container) return;

      container.innerHTML = '<div class="loading">Loading transactions...</div>';

      const params = new URLSearchParams({
        limit: this.pageSize,
        offset: (this.currentPage - 1) * this.pageSize,
        ...this.currentFilters,
      });

      const response = await this.apiCall("GET", `financial/transactions?${params}`);

      if (response.success) {
        // Handle nested data structure - the actual transactions are in response.data.data
        const transactionsData = response.data.data || response.data;
        this.displayTransactions(transactionsData);
      } else {
        console.error("Transactions API error:", response.error);
        container.innerHTML = `<div class="error">Failed to load transactions: ${response.error}</div>`;
      }
    } catch (error) {
      console.error("Error loading transactions:", error);
      const container = document.getElementById("transactions-container");
      if (container) {
        container.innerHTML = '<div class="error">Failed to load transactions</div>';
      }
    }
  }

  updateAccountDisplay(account) {
    const balanceElement = document.getElementById("current-balance") || document.getElementById("userBalance");
    if (balanceElement) {
      let balance = 0;
      if (account) {
        if (typeof account.balance === "number") {
          balance = account.balance;
        } else if (typeof account.balance === "string") {
          const parsed = parseFloat(account.balance.replace(",", "."));
          balance = isNaN(parsed) ? 0 : parsed;
        }
      }
      if (isNaN(balance)) {
        console.error("Invalid balance value:", account);
        balanceElement.textContent = "0.00 ROL";
        return;
      }
      const formattedBalance = this.formatNumber(balance, 2);
      balanceElement.textContent = `${formattedBalance} ROL`;
    } else {
      const isFinancialPage =
        document.getElementById("current-balance") !== null ||
        document.getElementById("userBalance") !== null ||
        window.location.pathname.includes("financial") ||
        window.location.pathname.includes("marketplace");
      if (isFinancialPage) {
        console.error("Balance element not found in DOM");
      }
    }
  }

  updateStatsDisplay(stats) {
    const totalIncome = document.getElementById("total-income");
    const totalExpenses = document.getElementById("total-expenses");
    const transactionCount = document.getElementById("transaction-count");
    const netIncome = document.getElementById("net-income");

    // Handle cases where stats might be undefined or missing properties
    const safeStats = stats || {};
    const income = typeof safeStats.totalIncome === "number" ? safeStats.totalIncome : 0;
    const expenses = typeof safeStats.totalExpenses === "number" ? safeStats.totalExpenses : 0;
    const count = typeof safeStats.transactionCount === "number" ? safeStats.transactionCount : 0;

    if (totalIncome) totalIncome.textContent = this.formatNumber(income, 2);
    if (totalExpenses) totalExpenses.textContent = this.formatNumber(expenses, 2);
    if (transactionCount) transactionCount.textContent = count;
    if (netIncome) {
      const net = income - expenses;
      netIncome.textContent = this.formatNumber(net, 2);
      netIncome.className = net >= 0 ? "stat-value" : "stat-value negative";
    }

    // Update user balance if on marketplace page and we have account data
    const userBalanceElement = document.getElementById("userBalance");
    if (userBalanceElement && safeStats.balance !== undefined) {
      userBalanceElement.textContent = `${this.formatNumber(safeStats.balance, 2)} ROL`;
    }
  }

  displayTransactions(data) {
    const container = document.getElementById("transactions-container");
    const pagination = document.getElementById("pagination");

    if (!container) {
      console.error("Transactions container not found");
      return;
    }

    if (!data.transactions || data.transactions.length === 0) {
      container.innerHTML = '<div class="loading">No transactions found</div>';
      if (pagination) pagination.style.display = "none";
      return;
    }

    // Create table
    const table = document.createElement("table");
    table.className = "transactions-table";

    // Table header
    const thead = document.createElement("thead");
    thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Balance</th>
            </tr>
        `;
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement("tbody");
    data.transactions.forEach((transaction, index) => {
      try {
        const row = document.createElement("tr");
        const date = new Date(transaction.timestamp).toLocaleDateString("pl-PL");
        const time = new Date(transaction.timestamp).toLocaleTimeString("pl-PL");

        // Safe property access with defaults
        const type = transaction.type || "unknown";
        const category = transaction.category || "general";
        const description = transaction.description || "No description";
        const amount = typeof transaction.amount === "number" ? transaction.amount : 0;
        const balanceAfter = typeof transaction.balanceAfter === "number" ? transaction.balanceAfter : 0;

        row.innerHTML = `
                    <td>
                        <div>${date}</div>
                        <small style="color: #666;">${time}</small>
                    </td>
                    <td>
                        <span class="transaction-type ${type}">${type}</span>
                    </td>
                    <td>${category}</td>
                    <td>${description}</td>
                    <td class="amount ${type === "income" ? "positive" : "negative"}">
                        ${type === "income" ? "+" : "-"}${this.formatNumber(amount, 2)} ROL
                    </td>
                    <td>${this.formatNumber(balanceAfter, 2)} ROL</td>
                `;
        tbody.appendChild(row);
      } catch (error) {
        console.error(`Error processing transaction ${index}:`, error, transaction);
      }
    });
    table.appendChild(tbody);

    container.innerHTML = "";
    container.appendChild(table);

    // Update pagination
    this.updatePagination(data);
  }

  updatePagination(data) {
    const pagination = document.getElementById("pagination");
    const prevPage = document.getElementById("prev-page");
    const nextPage = document.getElementById("next-page");
    const pageInfo = document.getElementById("page-info");

    if (!pagination) return;

    const totalPages = Math.ceil(data.total / this.pageSize);

    if (totalPages <= 1) {
      pagination.style.display = "none";
      return;
    }

    pagination.style.display = "flex";

    if (prevPage) {
      prevPage.disabled = this.currentPage <= 1;
    }

    if (nextPage) {
      nextPage.disabled = this.currentPage >= totalPages;
    }

    if (pageInfo) {
      pageInfo.textContent = `Page ${this.currentPage} of ${totalPages} (${data.total} total)`;
    }
  }

  async handleTransactionSubmit(event) {
    event.preventDefault();

    // Validate all fields before submission
    const isValid = this.validateAllFields();
    if (!isValid) {
      this.showError("Please fix the errors before submitting");
      return;
    }

    const form = event.target;
    const submitButton = document.getElementById("submit-transaction");
    const btnText = submitButton.querySelector(".btn-text");
    const originalText = btnText.textContent;

    try {
      // Disable form and show loading state
      submitButton.disabled = true;
      btnText.textContent = "Adding Transaction...";
      submitButton.classList.add("loading");

      const formData = new FormData(form);
      const amountInput = document.getElementById("transaction-amount");
      const rawAmount = amountInput.getAttribute("data-raw-value") || formData.get("transaction-amount");

      const transactionData = {
        type: formData.get("transaction-type"),
        amount: parseFloat(rawAmount),
        category: formData.get("transaction-category"),
        description: formData.get("transaction-description"),
      };

      // Additional validation for income: card and CVV required (sent to API for validation, never stored/returned)
      if (transactionData.type === "income") {
        const cardNumberRaw = (document.getElementById("transaction-card-number")?.value || "").replace(/\s+/g, "");
        const cvvRaw = (document.getElementById("transaction-cvv")?.value || "").trim();

        const paymentOk = this.validatePaymentFields(cardNumberRaw, cvvRaw);
        if (!paymentOk) {
          this.showError("Please correct card details");
          throw new Error("Invalid card details");
        }
        // attach to request for server-side validation only
        transactionData.cardNumber = cardNumberRaw;
        transactionData.cvv = cvvRaw;
      }

      const response = await this.apiCall("POST", "financial/transactions", transactionData);

      if (response.success) {
        this.showSuccess("Transaction added successfully");
        this.resetForm();

        // Immediately update balance based on the transaction
        this.updateBalanceAfterTransaction(transactionData);

        // Reload all data to ensure consistency
        await this.loadFinancialData();
        await this.loadTransactions();
      } else {
        this.showError(response.error || "Failed to add transaction");
      }
    } catch (error) {
      console.error("Error adding transaction:", error);
      this.showError("Failed to add transaction");
    } finally {
      // Re-enable form
      submitButton.disabled = false;
      btnText.textContent = originalText;
      submitButton.classList.remove("loading");
    }
  }

  luhnCheck(number) {
    return true; // Placeholder for Luhn algorithm implementation
  }

  validatePaymentFields(cardNumber, cvv) {
    const cardError = document.getElementById("card-number-error");
    const cvvError = document.getElementById("cvv-error");
    const cardInput = document.getElementById("transaction-card-number");
    const cvvInput = document.getElementById("transaction-cvv");

    // reset
    if (cardError) cardError.textContent = "";
    if (cvvError) cvvError.textContent = "";
    if (cardInput) cardInput.classList.remove("error");
    if (cvvInput) cvvInput.classList.remove("error");

    let ok = true;
    if (!cardNumber) {
      if (cardError) cardError.textContent = "Card number is required";
      if (cardInput) cardInput.classList.add("error");
      ok = false;
    } else if (!/^\d{13,20}$/.test(cardNumber) || !this.luhnCheck(cardNumber)) {
      if (cardError) cardError.textContent = "Enter a valid card number";
      if (cardInput) cardInput.classList.add("error");
      ok = false;
    }

    if (!cvv) {
      if (cvvError) cvvError.textContent = "CVV is required";
      if (cvvInput) cvvInput.classList.add("error");
      ok = false;
    } else if (!/^\d{3,4}$/.test(cvv)) {
      if (cvvError) cvvError.textContent = "CVV must be 3-4 digits";
      if (cvvInput) cvvInput.classList.add("error");
      ok = false;
    }

    return ok;
  }

  async handleTransferSubmit(event) {
    event.preventDefault();
    // Validate fields
    const toUserIdInput = document.getElementById("transfer-toUserId");
    const amountInput = document.getElementById("transfer-amount");
    const descriptionInput = document.getElementById("transfer-description");
    const errors = {};
    // Validate recipient
    const toUserId = toUserIdInput.value.trim();
    if (!toUserId || isNaN(toUserId) || parseInt(toUserId) < 1) {
      errors.toUserId = "Enter a valid recipient user ID";
    }
    // Validate amount
    const amount = parseFloat(amountInput.value);
    if (!amountInput.value || isNaN(amount) || amount <= 0) {
      errors.amount = "Enter a valid amount";
    } else if (amount > 999.99) {
      errors.amount = "Cannot transfer more than 999.99 ROL";
    }
    // Validate description
    const description = descriptionInput.value.trim();
    if (!description) {
      errors.description = "Enter a description";
    } else if (description.length > 100) {
      errors.description = "Description too long";
    } else if (/[^\w\s.,;:!()\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(description)) {
      errors.description = "Description contains invalid characters";
    }
    // Show errors
    document.getElementById("transfer-toUserId-error").textContent = errors.toUserId || "";
    document.getElementById("transfer-amount-error").textContent = errors.amount || "";
    document.getElementById("transfer-description-error").textContent = errors.description || "";
    const formErrors = document.getElementById("transfer-form-errors");
    formErrors.innerHTML = "";
    if (Object.keys(errors).length > 0) {
      formErrors.innerHTML = Object.values(errors)
        .map((e) => `<div class='error-item'><i class='fas fa-exclamation-circle'></i> <span>${e}</span></div>`)
        .join("");
      return;
    }
    // Submit
    const submitButton = document.getElementById("submit-transfer");
    const btnText = submitButton.querySelector(".btn-text");
    const originalText = btnText.textContent;
    submitButton.disabled = true;
    btnText.textContent = "Sending...";
    submitButton.classList.add("loading");
    formErrors.innerHTML = "";
    document.getElementById("transfer-form-success").style.display = "none";
    try {
      const response = await this.apiCall("POST", "financial/transfer", {
        toUserId: toUserId,
        amount: amount,
        description: description,
      });
      if (response.success) {
        document.getElementById("transfer-form-success").textContent = "Transfer completed successfully!";
        document.getElementById("transfer-form-success").style.display = "block";
        form.reset();
        // Reload data
        await this.loadFinancialData();
        await this.loadTransactions();
      } else {
        formErrors.innerHTML = `<div class='error-item'><i class='fas fa-exclamation-circle'></i> <span>${
          response.error || "Transfer failed"
        }</span></div>`;
      }
    } catch (error) {
      formErrors.innerHTML = `<div class='error-item'><i class='fas fa-exclamation-circle'></i> <span>Transfer failed</span></div>`;
    } finally {
      submitButton.disabled = false;
      btnText.textContent = originalText;
      submitButton.classList.remove("loading");
    }
  }

  resetForm() {
    const form = document.getElementById("transaction-form");
    if (!form) return;

    // Reset form fields
    form.reset();

    // Clear type selector
    const typeOptions = document.querySelectorAll(".type-option");
    typeOptions.forEach((option) => option.classList.remove("selected"));
    const typeInput = document.getElementById("transaction-type");
    if (typeInput) typeInput.value = "";

    // Disable additional fields until type is selected again
    this.setAdditionalFieldsEnabled(false);

    // Clear character counter
    const counterElement = document.getElementById("description-counter");
    if (counterElement) {
      counterElement.textContent = "0";
      counterElement.className = "current";
    }

    // Clear all errors
    this.clearAllErrors();

    // Remove error classes from inputs
    const inputs = form.querySelectorAll(".form-input-modern");
    inputs.forEach((input) => {
      input.classList.remove("error");
      input.removeAttribute("data-raw-value");
    });

    // Hide/clear card fields
    const cardFields = document.getElementById("card-fields");
    const cvvField = document.getElementById("cvv-field");
    if (cardFields) cardFields.style.display = "none";
    if (cvvField) cvvField.style.display = "none";
    const cardInput = document.getElementById("transaction-card-number");
    const cvvInput = document.getElementById("transaction-cvv");
    if (cardInput) cardInput.value = "";
    if (cvvInput) cvvInput.value = "";

    // Collapse the form after successful submission
    const content = document.getElementById("transaction-form-content");
    const icon = document.getElementById("collapse-icon");
    if (content && icon) {
      content.classList.remove("expanded");
      content.classList.add("collapsed");
      icon.style.transform = "rotate(0deg)";
      localStorage.setItem("transactionFormExpanded", "false");
    }
  }

  // Debounce validation for input fields
  debounceValidation(fieldName) {
    if (this.validationTimeout) {
      clearTimeout(this.validationTimeout);
    }
    this.validationTimeout = setTimeout(() => {
      this.validateField(fieldName);
    }, 300);
  }

  validateField(fieldName) {
    const field = document.getElementById(`transaction-${fieldName}`);

    if (!field) return true;

    let isValid = true;
    let errorMessage = "";

    switch (fieldName) {
      case "type":
        if (!field.value) {
          errorMessage = "Please select a transaction type";
          isValid = false;
        }
        break;

      case "amount":
        const rawAmount = field.getAttribute("data-raw-value") || field.value;
        const amount = parseFloat(rawAmount);
        const amountStr = rawAmount.toString();

        if (!rawAmount || amount === 0) {
          errorMessage = "Please enter an amount";
          isValid = false;
        } else if (isNaN(amount) || amount <= 0) {
          errorMessage = "Please enter a valid amount greater than 0";
          isValid = false;
        } else if (amount > 9999) {
          errorMessage = "Amount cannot exceed 9 999 ROL";
          isValid = false;
        } else if (
          (amountStr.includes(".") || amountStr.includes(",")) &&
          (amountStr.split(".")[1]?.length > 2 || amountStr.split(",")[1]?.length > 2)
        ) {
          errorMessage = "Amount can have maximum 2 decimal places";
          isValid = false;
        }
        break;

      case "category":
        if (!field.value) {
          errorMessage = "Please select a category";
          isValid = false;
        }
        break;

      case "description":
        const description = field.value.trim();
        if (!description) {
          errorMessage = "Please enter a description";
          isValid = false;
        } else if (description.length < 3) {
          errorMessage = "Description must be at least 3 characters long";
          isValid = false;
        } else if (description.length > 100) {
          errorMessage = "Description cannot exceed 100 characters";
          isValid = false;
        } else if (/[^\w\s.,;:!()\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(description)) {
          errorMessage = "Description contains invalid characters";
          isValid = false;
        }
        break;

      case "card-number": {
        // Required for income only
        const type = document.getElementById("transaction-type")?.value;
        console.log("Validating card number field", field.value, type);
        if (type === "income") {
          const val = (field.value || "").replace(/\s+/g, "");
          if (!val) {
            errorMessage = "Card number is required";
            isValid = false;
          } else if (!/^\d{13,20}$/.test(val) || !this.luhnCheck(val)) {
            errorMessage = "Enter a valid card number";
            isValid = false;
          }
        }
        break;
      }

      case "cvv": {
        const type = document.getElementById("transaction-type")?.value;
        if (type === "income") {
          const val = (field.value || "").trim();
          if (!val) {
            errorMessage = "CVV is required";
            isValid = false;
          } else if (!/^\d{3,4}$/.test(val)) {
            errorMessage = "CVV must be 3-4 digits";
            isValid = false;
          }
        }
        break;
      }
    }

    // Update field appearance
    if (isValid) {
      field.classList.remove("error");
    } else {
      field.classList.add("error");
    }

    // Update individual error display
    const errorElement = document.getElementById(`${fieldName}-error`);
    if (errorElement) {
      if (isValid) {
        errorElement.textContent = "";
        errorElement.style.display = "none";
      } else {
        errorElement.textContent = errorMessage;
        errorElement.style.display = "block";
      }
    }

    // Store validation result for centralized display
    this.fieldErrors[fieldName] = isValid ? null : errorMessage;
    this.updateFormErrors();

    return isValid;
  }

  updateFormErrors() {
    const errorsContainer = document.getElementById("form-errors");
    if (!errorsContainer) return;

    const errors = Object.values(this.fieldErrors).filter((error) => error !== null);

    if (errors.length === 0) {
      errorsContainer.innerHTML = "";
      return;
    }

    const errorsHTML = errors
      .map(
        (error) =>
          `<div class="error-item">
                <i class="fas fa-exclamation-circle"></i>
                <span>${error}</span>
            </div>`,
      )
      .join("");

    errorsContainer.innerHTML = errorsHTML;
  }

  validateAllFields() {
    const fields = ["type", "amount", "category", "description"];
    let allValid = true;

    fields.forEach((fieldName) => {
      if (!this.validateField(fieldName)) {
        allValid = false;
      }
    });

    return allValid;
  }

  clearAllErrors() {
    const fields = ["type", "amount", "category", "description"];

    fields.forEach((fieldName) => {
      const field = document.getElementById(`transaction-${fieldName}`);
      if (field) field.classList.remove("error");
      this.fieldErrors[fieldName] = null;
    });

    // Clear individual error displays
    const errorElements = ["type-error", "amount-error", "category-error", "description-error"];
    errorElements.forEach((errorId) => {
      const errorElement = document.getElementById(errorId);
      if (errorElement) {
        errorElement.textContent = "";
        errorElement.style.display = "none";
      }
    });

    this.updateFormErrors();
  }

  updateBalanceAfterTransaction(transactionData) {
    const balanceElement = document.getElementById("current-balance") || document.getElementById("userBalance");
    if (!balanceElement) return;

    // Get current balance from display
    const currentBalanceText = balanceElement.textContent;
    const currentBalance = parseFloat(currentBalanceText.replace(" ROL", "")) || 0;

    // Calculate new balance based on transaction type
    let newBalance = currentBalance;
    const amount = transactionData.amount || 0;

    if (transactionData.type === "income") {
      newBalance += amount;
    } else if (transactionData.type === "expense") {
      newBalance -= amount;
    }

    // Update the display immediately
    balanceElement.textContent = `${this.formatNumber(newBalance, 2)} ROL`;

    // Add a subtle animation to highlight the change
    balanceElement.style.transition = "all 0.3s ease";
    balanceElement.style.transform = "scale(1.05)";
    balanceElement.style.color = transactionData.type === "income" ? "#4caf50" : "#f44336";

    setTimeout(() => {
      balanceElement.style.transform = "scale(1)";
      balanceElement.style.color = "white";
    }, 300);

    // Also update statistics immediately
    this.updateStatsAfterTransaction(transactionData);
  }

  updateStatsAfterTransaction(transactionData) {
    const amount = transactionData.amount || 0;

    // Update total income
    const totalIncomeElement = document.getElementById("total-income");
    if (totalIncomeElement && transactionData.type === "income") {
      const currentIncome = parseFloat(totalIncomeElement.textContent) || 0;
      const newIncome = currentIncome + amount;
      totalIncomeElement.textContent = this.formatNumber(newIncome, 2);
    }

    // Update total expenses
    const totalExpensesElement = document.getElementById("total-expenses");
    if (totalExpensesElement && transactionData.type === "expense") {
      const currentExpenses = parseFloat(totalExpensesElement.textContent) || 0;
      const newExpenses = currentExpenses + amount;
      totalExpensesElement.textContent = this.formatNumber(newExpenses, 2);
    }

    // Update transaction count
    const transactionCountElement = document.getElementById("transaction-count");
    if (transactionCountElement) {
      const currentCount = parseInt(transactionCountElement.textContent) || 0;
      transactionCountElement.textContent = currentCount + 1;
    }

    // Update net income
    const netIncomeElement = document.getElementById("net-income");
    if (netIncomeElement) {
      const income = parseFloat(totalIncomeElement?.textContent || 0);
      const expenses = parseFloat(totalExpensesElement?.textContent || 0);
      const net = income - expenses;
      netIncomeElement.textContent = this.formatNumber(net, 2);
      netIncomeElement.className = net >= 0 ? "stat-value" : "stat-value negative";
    }

    // Update user balance if on marketplace page
    const userBalanceElement = document.getElementById("userBalance");
    if (userBalanceElement) {
      const currentBalance = parseFloat(userBalanceElement.textContent.replace(" ROL", "")) || 0;
      let newBalance = currentBalance;

      if (transactionData.type === "income") {
        newBalance += amount;
      } else if (transactionData.type === "expense") {
        newBalance -= amount;
      }

      userBalanceElement.textContent = `${this.formatNumber(newBalance, 2)} ROL`;
    }
  }

  applyFilters() {
    const filterType = document.getElementById("filter-type");
    const filterCategory = document.getElementById("filter-category");
    const filterStartDate = document.getElementById("filter-start-date");
    const filterEndDate = document.getElementById("filter-end-date");

    this.currentFilters = {};

    if (filterType && filterType.value) {
      this.currentFilters.type = filterType.value;
    }
    if (filterCategory && filterCategory.value) {
      this.currentFilters.category = filterCategory.value;
    }
    if (filterStartDate && filterStartDate.value) {
      this.currentFilters.startDate = filterStartDate.value;
    }
    if (filterEndDate && filterEndDate.value) {
      this.currentFilters.endDate = filterEndDate.value;
    }

    this.currentPage = 1;
    this.loadTransactions();
  }

  async changePage(delta) {
    const newPage = this.currentPage + delta;
    if (newPage < 1) return;

    this.currentPage = newPage;
    await this.loadTransactions();
  }

  async apiCall(method, endpoint, data = null) {
    try {
      const apiService = window.App.getModule("apiService");
      if (!apiService) {
        throw new Error("API service not available");
      }

      const options = {
        requiresAuth: true,
      };

      if (data && method !== "GET") {
        options.body = data;
      }

      const response = await apiService.request(method, endpoint, options);
      return response;
    } catch (error) {
      console.error("API call failed:", error);
      throw error;
    }
  }

  showSuccess(message) {
    if (window.App && window.App.getModule("notification")) {
      window.App.getModule("notification").success(message, 4000);
    } else if (window.showNotification) {
      window.showNotification(message, "success", 4000);
    } else {
      // Fallback notification
      const notification = document.createElement("div");
      notification.className = "success";
      notification.textContent = message;
      notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px; 
                background: #4caf50;
                color: white;
                padding: 1rem;
                border-radius: 0.5rem;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                animation: slideIn 0.3s ease-out;
            `;
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = "slideOut 0.3s ease-in";
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }, 4000);
    }
  }

  showError(message) {
    if (window.App && window.App.getModule("notification")) {
      window.App.getModule("notification").error(message, 5000);
    } else if (window.showNotification) {
      window.showNotification(message, "error", 5000);
    } else {
      // Fallback notification
      const notification = document.createElement("div");
      notification.className = "error";
      notification.textContent = message;
      notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #f44336;
                color: white;
                padding: 1rem;
                border-radius: 0.5rem;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                animation: slideIn 0.3s ease-out;
            `;
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = "slideOut 0.3s ease-in";
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }, 5000);
    }
  }

  validateTransferField(fieldName) {
    let error = "";
    if (fieldName === "toUserId") {
      const input = document.getElementById("transfer-toUserId");
      const value = input.value.trim();
      if (!value || isNaN(value) || parseInt(value) < 1) {
        error = "Enter a valid recipient user ID";
      }
      document.getElementById("transfer-toUserId-error").textContent = error;
      input.classList.toggle("error", !!error);
    } else if (fieldName === "amount") {
      const input = document.getElementById("transfer-amount");
      const value = parseFloat(input.value);
      let balance = 0;
      const balanceElement = document.getElementById("current-balance");
      if (balanceElement) {
        const balanceText = balanceElement.textContent.replace(" ROL", "").replace(/\s/g, "");
        balance = parseFloat(balanceText.replace(",", ".")) || 0;
      }
      if (!input.value || isNaN(value) || value <= 0) {
        error = "Enter a valid amount";
      } else if (value > 999.99) {
        error = "Cannot transfer more than 999.99 ROL";
      } else if (value > balance) {
        error = "Insufficient funds: overdraft is not allowed";
      }
      document.getElementById("transfer-amount-error").textContent = error;
      input.classList.toggle("error", !!error);
    } else if (fieldName === "description") {
      const input = document.getElementById("transfer-description");
      const value = input.value.trim();
      if (!value) {
        error = "Enter a description";
      } else if (value.length > 100) {
        error = "Description too long";
      } else if (/[^\w\s.,;:!()\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(value)) {
        error = "Description contains invalid characters";
      }
      document.getElementById("transfer-description-error").textContent = error;
      input.classList.toggle("error", !!error);
    }
  }

  clearTransferFieldError(fieldName) {
    if (fieldName === "toUserId") {
      document.getElementById("transfer-toUserId-error").textContent = "";
      document.getElementById("transfer-toUserId").classList.remove("error");
    } else if (fieldName === "amount") {
      document.getElementById("transfer-amount-error").textContent = "";
      document.getElementById("transfer-amount").classList.remove("error");
    } else if (fieldName === "description") {
      document.getElementById("transfer-description-error").textContent = "";
      document.getElementById("transfer-description").classList.remove("error");
    }
  }
}

// Initialize financial page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new FinancialPage();
});
