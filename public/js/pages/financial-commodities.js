class FinancialCommoditiesPage {
  constructor() {
    this.apiService = null;
    this.authService = null;
    this.featureFlagsService = null;
    this.sellableHoldings = new Map();
    this.availableSymbols = [];
    this.tradingEnabled = false;
  }

  async init(app) {
    this.apiService = app?.getModule?.("apiService");
    this.authService = app?.getModule?.("authService");
    this.featureFlagsService = app?.getModule?.("featureFlagsService");

    if (!this.authService || !this.apiService) {
      window.location.href = "/login.html";
      return;
    }

    const isAuthenticated = await this.authService.waitForAuth(3000);
    if (!isAuthenticated) {
      window.location.href = "/login.html";
      return;
    }

    if (!this.authService.requireAuth("/login.html")) {
      return;
    }

    const isEnabled = await this._ensureFeatureEnabled();
    if (!isEnabled) {
      return;
    }

    await this._syncTradingGate();

    this._bindEvents();
    await this.loadCurrentPrices();
    await Promise.all([this.loadPortfolio(), this.loadHistory()]);
  }

  async _ensureFeatureEnabled() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      window.location.replace("/404.html");
      return false;
    }

    try {
      const enabled = await this.featureFlagsService.isEnabled("financialCommoditiesEnabled", false);
      if (!enabled) {
        window.location.replace("/404.html");
        return false;
      }
      return true;
    } catch (error) {
      window.location.replace("/404.html");
      return false;
    }
  }

  async _syncTradingGate() {
    const buySection = document.getElementById("buyCommoditySection");
    const sellSection = document.getElementById("sellCommoditySection");

    const applyVisibility = (enabled) => {
      this.tradingEnabled = enabled === true;
      if (buySection) buySection.hidden = !this.tradingEnabled;
      if (sellSection) sellSection.hidden = !this.tradingEnabled;
    };

    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      applyVisibility(false);
      return;
    }

    try {
      const enabled = await this.featureFlagsService.isEnabled("financialCommoditiesTradingEnabled", false);
      applyVisibility(enabled);
    } catch (error) {
      applyVisibility(false);
    }
  }

  _bindEvents() {
    document.getElementById("refreshPricesBtn")?.addEventListener("click", () => this.loadCurrentPrices());
    document.getElementById("refreshPortfolioBtn")?.addEventListener("click", () => this.loadPortfolio());
    document.getElementById("buyCommodityForm")?.addEventListener("submit", (event) => this.handleBuy(event));
    document.getElementById("sellCommodityForm")?.addEventListener("submit", (event) => this.handleSell(event));
    document.getElementById("sellSymbol")?.addEventListener("change", () => this._applySelectedHoldingToSellQuantity());
    document.getElementById("historyForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.loadHistory();
    });
  }

  _syncSellForm(holdings) {
    if (!this.tradingEnabled) return;

    const sellSymbolSelect = document.getElementById("sellSymbol");
    const sellQuantityInput = document.getElementById("sellQuantity");
    const sellButton = document.getElementById("sellCommodityBtn");

    if (!sellSymbolSelect || !sellQuantityInput || !sellButton) return;

    this.sellableHoldings = new Map(
      (Array.isArray(holdings) ? holdings : [])
        .filter((item) => Number(item?.quantity || 0) > 0)
        .map((item) => [String(item.symbol || "").toUpperCase(), Number(item.quantity || 0)]),
    );

    const options = Array.from(this.sellableHoldings.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([symbol, quantity]) => ({ symbol, quantity }));

    if (options.length === 0) {
      sellSymbolSelect.innerHTML = '<option value="" selected>No holdings available</option>';
      sellSymbolSelect.disabled = true;
      sellQuantityInput.disabled = true;
      sellButton.disabled = true;
      sellQuantityInput.value = "";
      sellQuantityInput.removeAttribute("max");
      return;
    }

    const previousValue = String(sellSymbolSelect.value || "").toUpperCase();
    const selectedValue = this.sellableHoldings.has(previousValue) ? previousValue : options[0].symbol;

    sellSymbolSelect.innerHTML = options
      .map(
        ({ symbol, quantity }) =>
          `<option value="${this._escapeHtml(symbol)}" ${symbol === selectedValue ? "selected" : ""}>${this._escapeHtml(symbol)} (max ${quantity.toFixed(
            4,
          )})</option>`,
      )
      .join("");

    sellSymbolSelect.disabled = false;
    sellQuantityInput.disabled = false;
    sellButton.disabled = false;

    this._applySelectedHoldingToSellQuantity();
  }

  _applySelectedHoldingToSellQuantity() {
    const sellSymbolSelect = document.getElementById("sellSymbol");
    const sellQuantityInput = document.getElementById("sellQuantity");

    if (!sellSymbolSelect || !sellQuantityInput) return;

    const symbol = String(sellSymbolSelect.value || "").toUpperCase();
    const availableQty = Number(this.sellableHoldings.get(symbol) || 0);

    if (availableQty > 0) {
      sellQuantityInput.max = availableQty.toFixed(4);
      sellQuantityInput.placeholder = `max ${availableQty.toFixed(4)}`;
    } else {
      sellQuantityInput.removeAttribute("max");
      sellQuantityInput.placeholder = "e.g. 0.5000";
    }
  }

  _showInlineFeedback(message, type = "success", elementId = "buyFeedback") {
    const feedback = document.getElementById(elementId);
    if (!feedback) return;

    feedback.hidden = false;
    feedback.textContent = message;
    feedback.classList.remove("commodities-inline-feedback--success", "commodities-inline-feedback--error");
    feedback.classList.add(type === "error" ? "commodities-inline-feedback--error" : "commodities-inline-feedback--success");
  }

  _syncGeneralSymbolSelects(symbols) {
    const normalizedSymbols = (Array.isArray(symbols) ? symbols : [])
      .map((symbol) =>
        String(symbol || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

    this.availableSymbols = normalizedSymbols;

    const syncSelect = (selectId, emptyLabel) => {
      const select = document.getElementById(selectId);
      if (!select) return;

      const previousValue = String(select.value || "").toUpperCase();

      if (normalizedSymbols.length === 0) {
        select.innerHTML = `<option value="" selected>${emptyLabel}</option>`;
        select.disabled = true;
        return;
      }

      const selectedValue = normalizedSymbols.includes(previousValue) ? previousValue : normalizedSymbols[0];
      select.innerHTML = normalizedSymbols
        .map(
          (symbol) =>
            `<option value="${this._escapeHtml(symbol)}" ${symbol === selectedValue ? "selected" : ""}>${this._escapeHtml(symbol)}</option>`,
        )
        .join("");
      select.disabled = false;
    };

    syncSelect("historySymbol", "No symbols available");
    syncSelect("buySymbol", "No symbols available");
  }

  async loadCurrentPrices() {
    const loading = document.getElementById("pricesLoading");
    const error = document.getElementById("pricesError");
    const wrap = document.getElementById("pricesTableWrap");
    const tbody = document.querySelector("#pricesTable tbody");
    const stamp = document.getElementById("pricesHourStamp");

    if (!loading || !error || !wrap || !tbody || !stamp) return;

    loading.hidden = false;
    error.hidden = true;
    wrap.hidden = true;
    tbody.innerHTML = "";

    try {
      const response = await this.apiService.get("commodities/prices", { requiresAuth: true });
      if (!response.success) {
        throw new Error(response.error || "Failed to load prices");
      }

      const prices = Array.isArray(response?.data?.data?.prices) ? response.data.data.prices : [];
      this._syncGeneralSymbolSelects(prices.map((item) => item?.symbol));
      prices.forEach((item) => {
        const row = document.createElement("tr");
        const midPrice = Number(item.price || 0);
        const buyPrice = Number(item.buyPrice ?? item.price ?? 0);
        const sellPrice = Number(item.sellPrice ?? item.price ?? 0);
        row.innerHTML = `
          <td>${this._escapeHtml(item.symbol)}</td>
          <td>${midPrice.toFixed(2)}</td>
          <td>${buyPrice.toFixed(2)}</td>
          <td>${sellPrice.toFixed(2)}</td>
          <td>${this._escapeHtml(item.hourStartUtc || "-")}</td>
        `;
        tbody.appendChild(row);
      });

      if (prices.length > 0) {
        stamp.textContent = `Prices snapshot hour (UTC): ${prices[0].hourStartUtc}`;
      } else {
        stamp.textContent = "No prices available.";
      }

      wrap.hidden = prices.length === 0;
      loading.hidden = true;
    } catch (err) {
      this._syncGeneralSymbolSelects([]);
      loading.hidden = true;
      error.hidden = false;
      stamp.textContent = "";
    }
  }

  async loadPortfolio() {
    const loading = document.getElementById("portfolioLoading");
    const error = document.getElementById("portfolioError");
    const empty = document.getElementById("portfolioEmpty");
    const wrap = document.getElementById("portfolioTableWrap");
    const body = document.getElementById("portfolioTableBody");
    const summary = document.getElementById("portfolioSummary");

    if (!loading || !error || !empty || !wrap || !body || !summary) return;

    loading.hidden = false;
    error.hidden = true;
    empty.hidden = true;
    wrap.hidden = true;
    body.innerHTML = "";
    summary.textContent = "";

    try {
      const response = await this.apiService.get("commodities/portfolio", { requiresAuth: true });
      if (!response.success) {
        throw new Error(response.error || "Failed to load portfolio");
      }

      const holdings = Array.isArray(response?.data?.data?.holdings) ? response.data.data.holdings : [];
      const portfolioSummary = response?.data?.data?.summary || { totalInvested: 0, currentValue: 0, profitLoss: 0 };

      this._syncSellForm(holdings);

      if (holdings.length === 0) {
        empty.hidden = false;
        loading.hidden = true;
        return;
      }

      holdings.forEach((item) => {
        const plClass = Number(item.profitLoss) >= 0 ? "commodities-pl-positive" : "commodities-pl-negative";
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${this._escapeHtml(item.symbol)}</td>
          <td>${Number(item.quantity || 0).toFixed(4)}</td>
          <td>${Number(item.avgBuyPrice || 0).toFixed(2)}</td>
          <td>${Number(item.currentPrice || 0).toFixed(2)}</td>
          <td class="${plClass}">${Number(item.profitLoss || 0).toFixed(2)}</td>
        `;
        body.appendChild(row);
      });

      summary.innerHTML = `
        <strong>Summary:</strong>
        Invested ${Number(portfolioSummary.totalInvested || 0).toFixed(2)} ROL ·
        Current ${Number(portfolioSummary.currentValue || 0).toFixed(2)} ROL ·
        P/L ${Number(portfolioSummary.profitLoss || 0).toFixed(2)} ROL
      `;

      wrap.hidden = false;
      loading.hidden = true;
    } catch (err) {
      this._syncSellForm([]);
      loading.hidden = true;
      error.hidden = false;
    }
  }

  async loadHistory() {
    const historySymbolSelect = document.getElementById("historySymbol");
    const selectedSymbol = String(historySymbolSelect?.value || "").trim();
    const symbol = selectedSymbol || this.availableSymbols[0] || "";
    const selectedHours = document.getElementById("historyHours")?.value || "168";
    const allowedHours = new Set(["12", "24", "168", "336", "720"]);
    const hours = allowedHours.has(selectedHours) ? selectedHours : "168";

    const loading = document.getElementById("historyLoading");
    const error = document.getElementById("historyError");
    const meta = document.getElementById("historyMeta");
    const wrap = document.getElementById("historyChartWrap");
    const chart = document.getElementById("historyChart");
    const stats = document.getElementById("historyStats");

    if (!loading || !error || !meta || !wrap || !chart || !stats) return;

    if (!symbol) {
      loading.hidden = true;
      error.hidden = false;
      error.textContent = "No commodity symbols available yet.";
      return;
    }

    error.textContent = "Failed to load history.";

    loading.hidden = false;
    error.hidden = true;
    meta.hidden = true;
    wrap.hidden = true;
    chart.innerHTML = "";
    stats.innerHTML = "";

    try {
      const response = await this.apiService.get(
        `commodities/prices/${encodeURIComponent(symbol)}/history?hours=${encodeURIComponent(hours)}`,
        {
          requiresAuth: true,
        },
      );

      if (!response.success) {
        throw new Error(response.error || "Failed to load history");
      }

      const data = response?.data?.data || {};
      const points = Array.isArray(data.points) ? data.points : [];

      if (points.length > 0) {
        this._renderHistoryChart(chart, points, data.symbol || symbol);
        this._renderHistoryStats(stats, points);
      }

      meta.hidden = false;
      meta.textContent = `${data.symbol || symbol} · ${data.hours || hours} hourly points`;
      wrap.hidden = points.length === 0;
      loading.hidden = true;
    } catch (err) {
      loading.hidden = true;
      error.hidden = false;
    }
  }

  async handleBuy(event) {
    event.preventDefault();

    if (!this.tradingEnabled) return;

    const buyButton = document.getElementById("buyCommodityBtn");
    const symbol = document.getElementById("buySymbol")?.value;
    const quantity = document.getElementById("buyQuantity")?.value;

    if (!symbol || !quantity) {
      this._showInlineFeedback("Please provide both symbol and quantity.", "error");
      return;
    }

    if (buyButton) buyButton.disabled = true;

    try {
      const response = await this.apiService.post(
        "commodities/buy",
        {
          symbol,
          quantity: Number(quantity),
        },
        { requiresAuth: true },
      );

      if (!response.success) {
        throw new Error(response.error || "Failed to buy commodity");
      }

      const executed = response?.data?.data;
      this._showInlineFeedback(
        `Purchased ${executed?.quantity ?? quantity} ${executed?.symbol ?? symbol} at ${Number(executed?.unitPrice || 0).toFixed(2)} ROL.`,
        "success",
        "buyFeedback",
      );

      await Promise.all([this.loadCurrentPrices(), this.loadPortfolio(), this.loadHistory()]);
    } catch (error) {
      this._showInlineFeedback(error.message || "Failed to buy commodity.", "error", "buyFeedback");
    } finally {
      if (buyButton) buyButton.disabled = false;
    }
  }

  async handleSell(event) {
    event.preventDefault();

    if (!this.tradingEnabled) return;

    const sellButton = document.getElementById("sellCommodityBtn");
    const symbol = document.getElementById("sellSymbol")?.value;
    const quantity = document.getElementById("sellQuantity")?.value;
    const normalizedSymbol = String(symbol || "").toUpperCase();
    const requestedQty = Number(quantity || 0);

    if (!symbol || !quantity) {
      this._showInlineFeedback("Please provide both symbol and quantity.", "error", "sellFeedback");
      return;
    }

    const availableQty = Number(this.sellableHoldings.get(normalizedSymbol) || 0);
    if (availableQty <= 0) {
      this._showInlineFeedback(
        "You can only sell commodities you currently hold. Refresh portfolio and choose an owned symbol.",
        "error",
        "sellFeedback",
      );
      return;
    }

    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      this._showInlineFeedback("Sell quantity must be a positive number.", "error", "sellFeedback");
      return;
    }

    if (requestedQty > availableQty) {
      this._showInlineFeedback(
        `You tried to sell ${requestedQty.toFixed(4)}, but you only hold ${availableQty.toFixed(4)} ${normalizedSymbol}.`,
        "error",
        "sellFeedback",
      );
      return;
    }

    if (sellButton) sellButton.disabled = true;

    try {
      const response = await this.apiService.post(
        "commodities/sell",
        {
          symbol,
          quantity: Number(quantity),
        },
        { requiresAuth: true },
      );

      if (!response.success) {
        throw new Error(response.error || "Failed to sell commodity");
      }

      const executed = response?.data?.data;
      const proceeds = Number(executed?.totalProceeds || 0).toFixed(2);

      this._showInlineFeedback(
        `Sold ${executed?.quantity ?? quantity} ${executed?.symbol ?? symbol} at ${Number(executed?.unitPrice || 0).toFixed(2)} ROL (received ${proceeds} ROL).`,
        "success",
        "sellFeedback",
      );

      await Promise.all([this.loadCurrentPrices(), this.loadPortfolio(), this.loadHistory()]);
    } catch (error) {
      const fallbackMessage = error.message || "Failed to sell commodity.";
      const ownedSymbols = Array.from(this.sellableHoldings.keys());
      if (/no\s+[A-Z_]+\s+holdings\s+found/i.test(fallbackMessage) && ownedSymbols.length > 0) {
        this._showInlineFeedback(
          `Selected symbol is not in your portfolio. You currently hold: ${ownedSymbols.join(", ")}.`,
          "error",
          "sellFeedback",
        );
      } else {
        this._showInlineFeedback(fallbackMessage, "error", "sellFeedback");
      }
    } finally {
      if (sellButton) sellButton.disabled = false;
    }
  }

  _escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }

  _renderHistoryChart(svgElement, points, symbol) {
    const width = 900;
    const height = 260;
    const padding = { top: 20, right: 22, bottom: 30, left: 54 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const prices = points.map((point) => Number(point.price || 0));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = Math.max(maxPrice - minPrice, 0.0001);
    const floor = minPrice - range * 0.08;
    const ceiling = maxPrice + range * 0.08;

    const toX = (index) => padding.left + (index / Math.max(points.length - 1, 1)) * innerWidth;
    const toY = (price) => padding.top + ((ceiling - price) / Math.max(ceiling - floor, 0.0001)) * innerHeight;

    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(2)},${toY(Number(point.price || 0)).toFixed(2)}`)
      .join(" ");

    const areaPath = `${linePath} L${toX(points.length - 1).toFixed(2)},${(padding.top + innerHeight).toFixed(2)} L${toX(0).toFixed(2)},${(
      padding.top + innerHeight
    ).toFixed(2)} Z`;

    const lastPoint = points[points.length - 1];
    const lastX = toX(points.length - 1);
    const lastY = toY(Number(lastPoint?.price || 0));
    const latestTextY = Math.max(lastY - 10, 16);

    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);

    svgElement.innerHTML = `
      <defs>
        <linearGradient id="commoditiesAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2f8f5b" stop-opacity="0.45"></stop>
          <stop offset="100%" stop-color="#2f8f5b" stop-opacity="0.05"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding.left}" y1="${padding.top + innerHeight}" x2="${width - padding.right}" y2="${padding.top + innerHeight}" stroke="rgba(47,61,43,0.35)" stroke-width="1"></line>
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}" stroke="rgba(47,61,43,0.35)" stroke-width="1"></line>
      <path d="${areaPath}" fill="url(#commoditiesAreaFill)"></path>
      <path d="${linePath}" fill="none" stroke="#2f8f5b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
      <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="4" fill="#2f8f5b" stroke="#ffffff" stroke-width="2"></circle>
      <text x="${padding.left}" y="${height - 8}" fill="#5d6459" font-size="12">${this._escapeHtml(points[0]?.hourStartUtc || "")}</text>
      <text x="${(width - padding.right).toFixed(2)}" y="${height - 8}" text-anchor="end" fill="#5d6459" font-size="12">${this._escapeHtml(points[points.length - 1]?.hourStartUtc || "")}</text>
      <text x="${(padding.left - 8).toFixed(2)}" y="${(padding.top + 10).toFixed(2)}" text-anchor="end" fill="#5d6459" font-size="12">${ceiling.toFixed(2)}</text>
      <text x="${(padding.left - 8).toFixed(2)}" y="${(padding.top + innerHeight).toFixed(2)}" text-anchor="end" dominant-baseline="ideographic" fill="#5d6459" font-size="12">${floor.toFixed(2)}</text>
      <text x="${Math.min(lastX + 8, width - 6).toFixed(2)}" y="${latestTextY.toFixed(2)}" fill="#2f3d2b" font-size="12" text-anchor="${lastX > width * 0.82 ? "end" : "start"}">
        ${this._escapeHtml(symbol)} ${Number(lastPoint?.price || 0).toFixed(2)} ROL
      </text>
    `;
  }

  _renderHistoryStats(container, points) {
    const prices = points.map((point) => Number(point.price || 0));
    const first = prices[0] || 0;
    const last = prices[prices.length - 1] || 0;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const delta = last - first;
    const deltaLabel = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} ROL`;

    container.innerHTML = `
      <div class="commodities-history__stat">
        <span class="commodities-history__stat-label">Lowest</span>
        <span class="commodities-history__stat-value">${min.toFixed(2)} ROL</span>
      </div>
      <div class="commodities-history__stat">
        <span class="commodities-history__stat-label">Highest</span>
        <span class="commodities-history__stat-value">${max.toFixed(2)} ROL</span>
      </div>
      <div class="commodities-history__stat">
        <span class="commodities-history__stat-label">Change</span>
        <span class="commodities-history__stat-value">${deltaLabel}</span>
      </div>
    `;
  }
}

window.FinancialCommoditiesPage = FinancialCommoditiesPage;
