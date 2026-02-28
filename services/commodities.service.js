const dbManager = require("../data/database-manager");
const financialService = require("./financial.service");
const pricingService = require("./commodities-pricing.service");

class CommoditiesService {
  constructor() {
    this.db = dbManager.getCommoditiesDatabase();
    this.storeMutationQueue = Promise.resolve();
  }

  _withStoreLock(operation) {
    const run = this.storeMutationQueue.then(() => operation());
    this.storeMutationQueue = run.catch(() => undefined);
    return run;
  }

  _ensureStore(store) {
    if (!store || typeof store !== "object" || Array.isArray(store)) {
      return {
        holdings: [],
        metadata: {
          version: 1,
          updatedAt: null,
        },
      };
    }

    const holdings = Array.isArray(store.holdings) ? store.holdings : [];
    const metadata =
      store.metadata && typeof store.metadata === "object" && !Array.isArray(store.metadata)
        ? {
            version: Number.isInteger(store.metadata.version) ? store.metadata.version : 1,
            updatedAt: typeof store.metadata.updatedAt === "string" ? store.metadata.updatedAt : null,
          }
        : { version: 1, updatedAt: null };

    return {
      ...store,
      holdings,
      metadata,
    };
  }

  async _readStore() {
    const store = await this.db.getAll();
    return this._ensureStore(store);
  }

  async _writeStore(store) {
    const normalizedStore = this._ensureStore(store);
    normalizedStore.metadata = {
      ...(normalizedStore.metadata || {}),
      version: Number.isInteger(normalizedStore?.metadata?.version) ? normalizedStore.metadata.version : 1,
      updatedAt: new Date().toISOString(),
    };

    await this.db.replaceAll(normalizedStore);
  }

  _validateQuantity(value) {
    const text = String(value ?? "").trim();
    const amount = Number(text);

    if (!text || Number.isNaN(amount) || amount <= 0) {
      throw new Error("Validation failed: quantity must be a positive number");
    }

    if (!/^\d+(\.\d{1,4})?$/.test(text)) {
      throw new Error("Validation failed: quantity supports up to 4 decimal places");
    }

    return Number(amount.toFixed(4));
  }

  _normalizeSymbolsFromQuery(rawSymbols) {
    if (!rawSymbols) {
      return pricingService.getSupportedSymbols();
    }

    const symbols = String(rawSymbols)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (symbols.length === 0) {
      return pricingService.getSupportedSymbols();
    }

    return symbols.map((symbol) => pricingService.normalizeSymbol(symbol));
  }

  async getCurrentPrices(rawSymbols) {
    const symbols = this._normalizeSymbolsFromQuery(rawSymbols);
    const prices = pricingService.getCurrentPrices(symbols);
    return { prices };
  }

  async getPriceHistory(symbol, hours) {
    const normalizedHours = hours === undefined ? 168 : Number(hours);
    const history = pricingService.getPriceHistory(symbol, normalizedHours);
    return history;
  }

  async buyCommodity(userId, payload = {}) {
    const userNumericId = Number(userId);
    if (!Number.isInteger(userNumericId) || userNumericId <= 0) {
      throw new Error("Validation failed: userId must be a positive integer");
    }

    const symbol = pricingService.normalizeSymbol(payload.symbol);
    const quantity = this._validateQuantity(payload.quantity);

    const quote = pricingService.getExecutionQuote(symbol, "buy", quantity);
    const totalCost = Number((quote.executionPrice * quantity).toFixed(2));

    const account = await financialService.getAccount(userNumericId);
    if (!account || Number(account.balance) < totalCost) {
      throw new Error("Insufficient funds for commodity purchase");
    }

    await financialService.addTransaction(userNumericId, {
      type: "expense",
      amount: totalCost,
      description: `Buy ${symbol} x ${quantity}`,
      category: "commodities",
      referenceId: symbol,
    });

    const updatedHolding = await this._withStoreLock(async () => {
      const store = await this._readStore();
      const holdings = Array.isArray(store.holdings) ? store.holdings : [];

      const existingIndex = holdings.findIndex(
        (item) => Number(item.userId) === userNumericId && String(item.symbol || "").toUpperCase() === symbol,
      );

      let entry;
      if (existingIndex >= 0) {
        const current = holdings[existingIndex];
        const previousQuantity = Number(current.quantity || 0);
        const previousInvested = Number(current.totalInvested || 0);
        const nextQuantity = Number((previousQuantity + quantity).toFixed(4));
        const nextInvested = Number((previousInvested + totalCost).toFixed(2));

        entry = {
          ...current,
          userId: userNumericId,
          symbol,
          quantity: nextQuantity,
          totalInvested: nextInvested,
          avgBuyPrice: Number((nextInvested / nextQuantity).toFixed(2)),
          updatedAt: new Date().toISOString(),
        };

        holdings[existingIndex] = entry;
      } else {
        entry = {
          userId: userNumericId,
          symbol,
          quantity,
          totalInvested: totalCost,
          avgBuyPrice: Number((totalCost / quantity).toFixed(2)),
          updatedAt: new Date().toISOString(),
        };

        holdings.push(entry);
      }

      await this._writeStore({ ...store, holdings });
      return entry;
    });

    return {
      symbol,
      quantity,
      unitPrice: quote.executionPrice,
      midPrice: quote.midPrice,
      spreadPct: quote.spreadPct,
      liquidityImpactPct: quote.liquidityImpactPct,
      totalCost,
      executedAtHour: quote.hourStartUtc,
      holding: updatedHolding,
    };
  }

  async sellCommodity(userId, payload = {}) {
    const userNumericId = Number(userId);
    if (!Number.isInteger(userNumericId) || userNumericId <= 0) {
      throw new Error("Validation failed: userId must be a positive integer");
    }

    const symbol = pricingService.normalizeSymbol(payload.symbol);
    const quantity = this._validateQuantity(payload.quantity);

    const result = await this._withStoreLock(async () => {
      const store = await this._readStore();
      const holdings = Array.isArray(store.holdings) ? store.holdings : [];

      const existingIndex = holdings.findIndex(
        (item) => Number(item.userId) === userNumericId && String(item.symbol || "").toUpperCase() === symbol,
      );

      if (existingIndex < 0) {
        throw new Error(`Insufficient quantity for commodity sale: no ${symbol} holdings found`);
      }

      const currentHolding = holdings[existingIndex];
      const holdingQuantity = Number(currentHolding.quantity || 0);
      const totalInvested = Number(currentHolding.totalInvested || 0);

      if (quantity > holdingQuantity) {
        throw new Error(`Insufficient quantity for commodity sale: available ${holdingQuantity.toFixed(4)} ${symbol}`);
      }

      const quote = pricingService.getExecutionQuote(symbol, "sell", quantity);
      const totalProceeds = Number((quote.executionPrice * quantity).toFixed(2));
      const soldCostBasis = Number(((totalInvested * quantity) / Math.max(holdingQuantity, 0.0001)).toFixed(2));
      const realizedProfitLoss = Number((totalProceeds - soldCostBasis).toFixed(2));

      const remainingQuantity = Number((holdingQuantity - quantity).toFixed(4));
      const remainingInvested = Number((totalInvested - soldCostBasis).toFixed(2));

      let updatedHolding = null;
      if (remainingQuantity <= 0) {
        holdings.splice(existingIndex, 1);
      } else {
        updatedHolding = {
          ...currentHolding,
          userId: userNumericId,
          symbol,
          quantity: remainingQuantity,
          totalInvested: Math.max(0, remainingInvested),
          avgBuyPrice: Number((Math.max(0, remainingInvested) / remainingQuantity).toFixed(2)),
          updatedAt: new Date().toISOString(),
        };

        holdings[existingIndex] = updatedHolding;
      }

      await this._writeStore({ ...store, holdings });

      return {
        symbol,
        quantity,
        unitPrice: quote.executionPrice,
        midPrice: quote.midPrice,
        spreadPct: quote.spreadPct,
        liquidityImpactPct: quote.liquidityImpactPct,
        totalProceeds,
        soldCostBasis,
        realizedProfitLoss,
        executedAtHour: quote.hourStartUtc,
        holding: updatedHolding,
      };
    });

    await financialService.addTransaction(userNumericId, {
      type: "income",
      amount: result.totalProceeds,
      description: `Sell ${symbol} x ${quantity}`,
      category: "commodities",
      referenceId: symbol,
    });

    return result;
  }

  async getPortfolio(userId) {
    const userNumericId = Number(userId);
    if (!Number.isInteger(userNumericId) || userNumericId <= 0) {
      throw new Error("Validation failed: userId must be a positive integer");
    }

    const store = await this._readStore();
    const holdings = (Array.isArray(store.holdings) ? store.holdings : [])
      .filter((item) => Number(item.userId) === userNumericId)
      .map((item) => {
        const symbol = pricingService.normalizeSymbol(item.symbol);
        const quantity = Number(item.quantity || 0);
        const invested = Number(item.totalInvested || 0);
        const avgBuyPrice = Number(item.avgBuyPrice || 0);
        const priceSnapshot = pricingService.getCurrentPrice(symbol);
        const currentValue = Number((priceSnapshot.price * quantity).toFixed(2));
        const profitLoss = Number((currentValue - invested).toFixed(2));

        return {
          symbol,
          quantity,
          avgBuyPrice,
          totalInvested: invested,
          currentPrice: priceSnapshot.price,
          currentValue,
          profitLoss,
          hourStartUtc: priceSnapshot.hourStartUtc,
          updatedAt: item.updatedAt || null,
        };
      });

    const summary = holdings.reduce(
      (acc, item) => {
        acc.totalInvested = Number((acc.totalInvested + item.totalInvested).toFixed(2));
        acc.currentValue = Number((acc.currentValue + item.currentValue).toFixed(2));
        acc.profitLoss = Number((acc.profitLoss + item.profitLoss).toFixed(2));
        return acc;
      },
      {
        totalInvested: 0,
        currentValue: 0,
        profitLoss: 0,
      },
    );

    return {
      holdings,
      summary,
    };
  }
}

module.exports = new CommoditiesService();
