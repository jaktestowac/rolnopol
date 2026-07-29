import commoditiesService from "../../services/commodities.service.js";
import { describe, it, expect, vi, afterEach } from "vitest";

const pricingService = require("../../services/commodities-pricing.service.js");
const financialService = require("../../services/financial.service.js");
const adminControls = require("../../services/commodities-admin-controls.service.js");

describe("commodities.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("_validateQuantity", () => {
    it("accepts positive numbers with up to 4 decimals", () => {
      expect(commoditiesService._validateQuantity("5")).toBe(5);
      expect(commoditiesService._validateQuantity("1.2345")).toBe(1.2345);
    });

    it("rejects non-positive, non-numeric or over-precise quantities", () => {
      expect(() => commoditiesService._validateQuantity("0")).toThrow("positive number");
      expect(() => commoditiesService._validateQuantity("-3")).toThrow("positive number");
      expect(() => commoditiesService._validateQuantity("abc")).toThrow("positive number");
      expect(() => commoditiesService._validateQuantity("1.23456")).toThrow("4 decimal places");
    });
  });

  describe("_ensureStore", () => {
    it("returns a default store for invalid input", () => {
      expect(commoditiesService._ensureStore(null)).toEqual({ holdings: [], metadata: { version: 1, updatedAt: null } });
      expect(commoditiesService._ensureStore([])).toEqual({ holdings: [], metadata: { version: 1, updatedAt: null } });
    });

    it("normalizes holdings and metadata on a partial store", () => {
      const result = commoditiesService._ensureStore({ holdings: [{ symbol: "GOLD" }], metadata: { version: "x" } });
      expect(result.holdings).toHaveLength(1);
      expect(result.metadata).toEqual({ version: 1, updatedAt: null });
    });
  });

  describe("_normalizeSymbolsFromQuery", () => {
    it("returns all supported symbols when the query is empty", () => {
      expect(commoditiesService._normalizeSymbolsFromQuery("")).toEqual(pricingService.getSupportedSymbols());
    });

    it("normalizes a comma-separated list", () => {
      const result = commoditiesService._normalizeSymbolsFromQuery("gold, silver");
      expect(result).toEqual(["GOLD", "SILVER"]);
    });
  });

  describe("buyCommodity", () => {
    it("rejects an invalid userId", async () => {
      await expect(commoditiesService.buyCommodity(0, { symbol: "gold", quantity: 1 })).rejects.toThrow("userId must be a positive integer");
    });

    it("rejects when the account has insufficient funds", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({ executionPrice: 100, midPrice: 100, spreadPct: 1, liquidityImpactPct: 0, hourStartUtc: "h" });
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ balance: 50 });

      await expect(commoditiesService.buyCommodity(1, { symbol: "gold", quantity: 2 })).rejects.toThrow("Insufficient funds");
    });

    it("debits the account and records a new holding", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({ executionPrice: 100, midPrice: 99, spreadPct: 1, liquidityImpactPct: 0.02, hourStartUtc: "2026-01-01T00:00:00.000Z" });
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ balance: 1000 });
      const txSpy = vi.spyOn(financialService, "addTransaction").mockResolvedValue();
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({ holdings: [], metadata: {} });
      vi.spyOn(commoditiesService.db, "replaceAll").mockResolvedValue();

      const result = await commoditiesService.buyCommodity(1, { symbol: "gold", quantity: "2" });

      expect(result.totalCost).toBe(200);
      expect(result.holding).toMatchObject({ userId: 1, symbol: "GOLD", quantity: 2, totalInvested: 200, avgBuyPrice: 100 });
      expect(txSpy).toHaveBeenCalledWith(1, expect.objectContaining({ type: "expense", amount: 200, category: "commodities" }));
    });

    it("averages into an existing holding", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({ executionPrice: 200, midPrice: 200, spreadPct: 1, liquidityImpactPct: 0, hourStartUtc: "h" });
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ balance: 10000 });
      vi.spyOn(financialService, "addTransaction").mockResolvedValue();
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({
        holdings: [{ userId: 1, symbol: "GOLD", quantity: 2, totalInvested: 200, avgBuyPrice: 100 }],
        metadata: {},
      });
      vi.spyOn(commoditiesService.db, "replaceAll").mockResolvedValue();

      const result = await commoditiesService.buyCommodity(1, { symbol: "gold", quantity: "2" });
      // 2 @100 (200) + 2 @200 (400) => 4 units, 600 invested, avg 150
      expect(result.holding).toMatchObject({ quantity: 4, totalInvested: 600, avgBuyPrice: 150 });
    });
  });

  describe("sellCommodity", () => {
    it("rejects when there is no holding to sell", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({ holdings: [], metadata: {} });
      vi.spyOn(commoditiesService.db, "replaceAll").mockResolvedValue();

      await expect(commoditiesService.sellCommodity(1, { symbol: "gold", quantity: 1 })).rejects.toThrow("no GOLD holdings found");
    });

    it("rejects when selling more than is held", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({
        holdings: [{ userId: 1, symbol: "GOLD", quantity: 1, totalInvested: 100 }],
        metadata: {},
      });
      vi.spyOn(commoditiesService.db, "replaceAll").mockResolvedValue();

      await expect(commoditiesService.sellCommodity(1, { symbol: "gold", quantity: 5 })).rejects.toThrow("Insufficient quantity");
    });

    it("computes proceeds and realized P/L on a partial sale", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({ executionPrice: 120, midPrice: 120, spreadPct: 1, liquidityImpactPct: 0, hourStartUtc: "h" });
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({
        holdings: [{ userId: 1, symbol: "GOLD", quantity: 5, totalInvested: 500, avgBuyPrice: 100 }],
        metadata: {},
      });
      vi.spyOn(commoditiesService.db, "replaceAll").mockResolvedValue();
      const txSpy = vi.spyOn(financialService, "addTransaction").mockResolvedValue();

      const result = await commoditiesService.sellCommodity(1, { symbol: "gold", quantity: "2" });
      // proceeds 240, cost basis (500*2/5)=200, realized P/L 40, remaining 3 units
      expect(result).toMatchObject({ totalProceeds: 240, soldCostBasis: 200, realizedProfitLoss: 40 });
      expect(result.holding).toMatchObject({ quantity: 3, totalInvested: 300 });
      expect(txSpy).toHaveBeenCalledWith(1, expect.objectContaining({ type: "income", amount: 240, category: "commodities" }));
    });

    it("removes the holding entirely on a full sale", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
      vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
      vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({ executionPrice: 120, midPrice: 120, spreadPct: 1, liquidityImpactPct: 0, hourStartUtc: "h" });
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({
        holdings: [{ userId: 1, symbol: "GOLD", quantity: 2, totalInvested: 200 }],
        metadata: {},
      });
      vi.spyOn(commoditiesService.db, "replaceAll").mockResolvedValue();
      vi.spyOn(financialService, "addTransaction").mockResolvedValue();

      const result = await commoditiesService.sellCommodity(1, { symbol: "gold", quantity: "2" });
      expect(result.holding).toBeNull();
    });
  });

  describe("getPortfolio", () => {
    it("rejects an invalid userId", async () => {
      await expect(commoditiesService.getPortfolio(-1)).rejects.toThrow("userId must be a positive integer");
    });

    it("marks holdings to market and summarizes P/L", async () => {
      vi.spyOn(pricingService, "normalizeSymbol").mockImplementation((s) => String(s).toUpperCase());
      vi.spyOn(pricingService, "getCurrentPrice").mockReturnValue({ price: 150, hourStartUtc: "h" });
      vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({
        holdings: [
          { userId: 1, symbol: "GOLD", quantity: 2, totalInvested: 200, avgBuyPrice: 100 },
          { userId: 2, symbol: "SILVER", quantity: 10, totalInvested: 50 }, // different user, filtered out
        ],
        metadata: {},
      });

      const portfolio = await commoditiesService.getPortfolio(1);
      expect(portfolio.holdings).toHaveLength(1);
      expect(portfolio.holdings[0]).toMatchObject({ symbol: "GOLD", currentValue: 300, profitLoss: 100 });
      expect(portfolio.summary).toEqual({ totalInvested: 200, currentValue: 300, profitLoss: 100 });
    });
  });
});
