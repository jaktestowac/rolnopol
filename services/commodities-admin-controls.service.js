const pricingService = require("./commodities-pricing.service");

class CommoditiesAdminControlsService {
  constructor() {
    this.controls = new Map();
    this._initialize();
  }

  _initialize() {
    if (this.controls.size > 0) {
      return;
    }

    const symbols = pricingService.getSupportedSymbols();
    for (const symbol of symbols) {
      this.controls.set(symbol, {
        symbol,
        enabled: true,
        maxOrderQuantity: 1000000,
        updatedAt: null,
        updatedBy: "system",
        note: "",
      });
    }
  }

  getAllControls() {
    this._initialize();
    return [...this.controls.values()];
  }

  getControl(symbol) {
    this._initialize();
    const normalized = pricingService.normalizeSymbol(symbol);
    return this.controls.get(normalized) || null;
  }

  updateControl(symbol, payload = {}) {
    this._initialize();
    const normalized = pricingService.normalizeSymbol(symbol);
    const current = this.controls.get(normalized);

    if (!current) {
      throw new Error("Validation failed: symbol is not supported");
    }

    const hasEnabled = Object.prototype.hasOwnProperty.call(payload, "enabled");
    const hasMaxQty = Object.prototype.hasOwnProperty.call(payload, "maxOrderQuantity");

    if (!hasEnabled && !hasMaxQty && !Object.prototype.hasOwnProperty.call(payload, "note")) {
      throw new Error("Validation failed: at least one control field is required");
    }

    const next = { ...current };

    if (hasEnabled) {
      next.enabled = Boolean(payload.enabled);
    }

    if (hasMaxQty) {
      const maxOrderQuantity = Number(payload.maxOrderQuantity);
      if (!Number.isFinite(maxOrderQuantity) || maxOrderQuantity <= 0) {
        throw new Error("Validation failed: maxOrderQuantity must be a positive number");
      }
      next.maxOrderQuantity = Number(maxOrderQuantity.toFixed(4));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "note")) {
      next.note = String(payload.note || "")
        .trim()
        .slice(0, 300);
    }

    next.updatedAt = new Date().toISOString();
    next.updatedBy = "admin";

    this.controls.set(normalized, next);
    return next;
  }

  validateTrade(symbol, quantity) {
    const control = this.getControl(symbol);
    if (!control) {
      throw new Error("Validation failed: symbol is not supported");
    }

    if (!control.enabled) {
      throw new Error(`Trading is halted for symbol ${control.symbol}`);
    }

    const numericQty = Number(quantity);
    if (Number.isFinite(control.maxOrderQuantity) && numericQty > control.maxOrderQuantity) {
      throw new Error(`Validation failed: quantity exceeds max order limit (${control.maxOrderQuantity}) for ${control.symbol}`);
    }
  }
}

module.exports = new CommoditiesAdminControlsService();
