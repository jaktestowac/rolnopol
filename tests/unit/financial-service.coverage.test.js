import financialService from "../../services/financial.service.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const notificationCenter = require("../../modules/notification-center");
const dbManager = require("../../data/database-manager");

describe("financial.service (coverage)", () => {
  beforeEach(() => {
    vi.spyOn(notificationCenter, "publish").mockResolvedValue({ accepted: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("_getData migration", () => {
    it("migrates a legacy array payload into the account/counters shape", async () => {
      const legacy = [
        { id: 1, userId: 1, transactions: [{ id: 3 }, { id: 7 }] },
        { id: 2, userId: 2, transactions: [{ id: 5 }] },
      ];
      vi.spyOn(financialService.db, "getAll").mockResolvedValue(legacy);

      const data = await financialService._getData();
      expect(data.accounts).toBe(legacy);
      expect(data.counters).toEqual({ lastAccountId: 2, lastTransactionId: 7 });
    });

    it("returns an object payload unchanged", async () => {
      const stored = { accounts: [], counters: { lastAccountId: 4, lastTransactionId: 9 } };
      vi.spyOn(financialService.db, "getAll").mockResolvedValue(stored);
      expect(await financialService._getData()).toBe(stored);
    });
  });

  describe("_getMaxTransactionId", () => {
    it("finds the largest transaction id across accounts", () => {
      const accounts = [
        { transactions: [{ id: 1 }, { id: 8 }] },
        { transactions: [{ id: 4 }] },
        { transactions: [] },
        {},
      ];
      expect(financialService._getMaxTransactionId(accounts)).toBe(8);
    });
  });

  describe("recalculateAllBalances", () => {
    it("sorts by timestamp and computes running balances", () => {
      const account = {
        balance: 0,
        transactions: [
          { type: "expense", amount: 30, timestamp: "2023-01-03T00:00:00Z" },
          { type: "income", amount: 100, timestamp: "2023-01-01T00:00:00Z" },
          { type: "income", amount: 50, timestamp: "2023-01-02T00:00:00Z" },
        ],
      };

      financialService.recalculateAllBalances(account);

      expect(account.balance).toBe(120);
      expect(account.transactions[0]).toMatchObject({ amount: 100, balanceBefore: 0, balanceAfter: 100 });
      expect(account.transactions[1]).toMatchObject({ amount: 50, balanceBefore: 100, balanceAfter: 150 });
      expect(account.transactions[2]).toMatchObject({ amount: 30, balanceBefore: 150, balanceAfter: 120 });
    });
  });

  describe("verifyBalanceCalculation", () => {
    it("returns true when the stored balance matches the transactions", () => {
      const account = {
        userId: 1,
        balance: 70,
        transactions: [
          { type: "income", amount: 100, timestamp: "2023-01-01T00:00:00Z" },
          { type: "expense", amount: 30, timestamp: "2023-01-02T00:00:00Z" },
        ],
      };
      expect(financialService.verifyBalanceCalculation(account)).toBe(true);
    });

    it("returns false when the stored balance is wrong", () => {
      const account = {
        userId: 1,
        balance: 999,
        transactions: [{ type: "income", amount: 100, timestamp: "2023-01-01T00:00:00Z" }],
      };
      expect(financialService.verifyBalanceCalculation(account)).toBe(false);
    });
  });

  describe("_ensureCounters", () => {
    it("creates counters when absent", () => {
      const data = {};
      const changed = financialService._ensureCounters(data);
      expect(changed).toBe(true);
      expect(data.counters).toEqual({ lastAccountId: 0, lastTransactionId: 0 });
    });

    it("bumps counters to match the largest ids found", () => {
      const data = {
        accounts: [
          { id: 5, transactions: [{ id: 2 }, { id: 11 }] },
          { id: 9, transactions: [{ id: 3 }] },
        ],
        counters: { lastAccountId: 1, lastTransactionId: 1 },
      };
      const changed = financialService._ensureCounters(data);
      expect(changed).toBe(true);
      expect(data.counters).toEqual({ lastAccountId: 9, lastTransactionId: 11 });
    });
  });

  describe("initializeAccount", () => {
    it("returns the existing account without creating a new one", async () => {
      const existing = { id: 1, userId: 2, balance: 42, transactions: [] };
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([existing]);
      const nextIdSpy = vi.spyOn(financialService, "_getNextAccountId");

      const result = await financialService.initializeAccount(2);
      expect(result).toBe(existing);
      expect(nextIdSpy).not.toHaveBeenCalled();
    });

    it("creates a fresh zero-balance ROL account when none exists", async () => {
      const accounts = [];
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue(accounts);
      vi.spyOn(financialService, "_getNextAccountId").mockResolvedValue(10);
      const saveSpy = vi.spyOn(financialService, "_saveAccounts").mockResolvedValue();

      const result = await financialService.initializeAccount("7");
      expect(result).toMatchObject({ id: 10, userId: 7, balance: 0, currency: "ROL", transactions: [] });
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe("getAccount", () => {
    it("returns the found account with a numeric userId", async () => {
      const account = { id: 1, userId: 2, balance: 0, transactions: [] };
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([account]);
      vi.spyOn(financialService, "_saveAccounts").mockResolvedValue();

      const result = await financialService.getAccount("2");
      expect(result).toMatchObject({ id: 1, userId: 2, balance: 0 });
      expect(typeof result.userId).toBe("number");
    });
  });

  describe("addTransaction validation", () => {
    it("throws when required fields are missing", async () => {
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([{ userId: 2, balance: 0, transactions: [] }]);
      await expect(financialService.addTransaction(2, { type: "income" })).rejects.toThrow("Missing required transaction fields");
    });

    it("throws when the amount is not positive", async () => {
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([{ userId: 2, balance: 0, transactions: [] }]);
      await expect(
        financialService.addTransaction(2, { type: "income", amount: -5, description: "x" }),
      ).rejects.toThrow("Transaction amount must be positive");
    });

    it("throws when the account does not exist", async () => {
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([]);
      await expect(
        financialService.addTransaction(99, { type: "income", amount: 5, description: "x" }),
      ).rejects.toThrow("Account not found");
    });

    it("records an expense and reduces the balance", async () => {
      const account = {
        userId: 2,
        balance: 100,
        transactions: [{ id: 1, type: "income", amount: 100, timestamp: "2023-01-01T00:00:00Z" }],
      };
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([account]);
      vi.spyOn(financialService, "_getNextTransactionId").mockResolvedValue(2);
      vi.spyOn(financialService, "_saveAccounts").mockResolvedValue();

      const tx = await financialService.addTransaction(2, { type: "expense", amount: 30, description: "feed" });
      expect(tx).toMatchObject({ id: 2, type: "expense", amount: 30, category: "general" });
      expect(account.balance).toBe(70);
    });
  });

  describe("getFinancialStats", () => {
    it("aggregates totals, categories, transfers and monthly buckets", async () => {
      vi.spyOn(financialService, "getAccount").mockResolvedValue({
        balance: 120,
        transactions: [
          { type: "income", amount: 100, category: "salary", timestamp: "2023-01-10T00:00:00Z" },
          { type: "expense", amount: 30, category: "feed", timestamp: "2023-01-20T00:00:00Z" },
          { type: "expense", amount: 50, category: "marketplace", timestamp: "2023-02-05T00:00:00Z" },
          { type: "income", amount: 100, category: "transfer", timestamp: "2023-02-06T00:00:00Z" },
        ],
      });

      const stats = await financialService.getFinancialStats(2);
      expect(stats.currentBalance).toBe(120);
      expect(stats.totalIncome).toBe(200);
      expect(stats.totalExpenses).toBe(80);
      expect(stats.totalTransferred).toBe(150); // marketplace 50 + transfer 100
      expect(stats.transactionCount).toBe(4);
      expect(stats.categories.feed).toEqual({ count: 1, total: 30 });
      expect(stats.monthlyStats["2023-01"]).toEqual({ income: 100, expenses: 30, count: 2 });
      expect(stats.monthlyStats["2023-02"]).toEqual({ income: 100, expenses: 50, count: 2 });
    });
  });

  describe("getMarketplaceStats", () => {
    it("counts offers/transactions and halves the summed marketplace volume", async () => {
      vi.spyOn(dbManager, "getMarketplaceDatabase").mockReturnValue({
        getAll: async () => ({
          offers: [
            { status: "active", itemType: "field" },
            { status: "sold", itemType: "field" },
            { status: "active", itemType: "animal" },
          ],
          transactions: [{ id: 1 }, { id: 2 }],
        }),
      });
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([
        { transactions: [{ category: "marketplace", amount: 200 }, { category: "salary", amount: 999 }] },
        { transactions: [{ category: "marketplace", amount: 200 }] },
      ]);

      const stats = await financialService.getMarketplaceStats();
      expect(stats.totalOffers).toBe(3);
      expect(stats.totalActiveOffers).toBe(2);
      expect(stats.offersByType).toEqual({ field: 2, animal: 1 });
      expect(stats.activeOffersByType).toEqual({ field: 1, animal: 1 });
      expect(stats.totalTransactions).toBe(2);
      expect(stats.totalVolume).toBe(200); // (200 + 200) / 2
    });
  });

  describe("findAccount", () => {
    it("returns the matching account or null", async () => {
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue([{ userId: 2, balance: 5 }]);
      expect(await financialService.findAccount(2)).toMatchObject({ userId: 2 });
      expect(await financialService.findAccount(99)).toBeNull();
    });
  });

  describe("transferFunds error paths", () => {
    it("rejects a non-positive transfer amount", async () => {
      await expect(financialService.transferFunds(1, 2, 0, "x")).rejects.toThrow("Transfer amount must be positive");
    });

    it("rejects a transfer above the per-transfer cap", async () => {
      await expect(financialService.transferFunds(1, 2, 1000, "x")).rejects.toThrow("Cannot transfer more than 999.99");
    });

    it("rejects when the sender has insufficient funds", async () => {
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ userId: 1, balance: 10 });
      await expect(financialService.transferFunds(1, 2, 50, "x")).rejects.toThrow("Insufficient funds");
    });

    it("rejects when the recipient does not exist", async () => {
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ userId: 1, balance: 100 });
      vi.spyOn(financialService, "findAccount").mockResolvedValue(null);
      await expect(financialService.transferFunds(1, 2, 50, "x")).rejects.toThrow("Recipient user does not exist");
    });
  });

  describe("getAllAccounts", () => {
    it("returns every account", async () => {
      const accounts = [{ userId: 1 }, { userId: 2 }];
      vi.spyOn(financialService, "_getAccounts").mockResolvedValue(accounts);
      expect(await financialService.getAllAccounts()).toBe(accounts);
    });
  });

  describe("updateAccountBalance", () => {
    it("adds an income transaction for a positive adjustment", async () => {
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ userId: 2, balance: 0 });
      const addSpy = vi.spyOn(financialService, "addTransaction").mockResolvedValue();

      await financialService.updateAccountBalance(2, 25, "bonus");
      expect(addSpy).toHaveBeenCalledWith(2, expect.objectContaining({ type: "income", amount: 25, category: "system" }));
    });

    it("adds an expense transaction for a negative adjustment", async () => {
      vi.spyOn(financialService, "getAccount").mockResolvedValue({ userId: 2, balance: 100 });
      const addSpy = vi.spyOn(financialService, "addTransaction").mockResolvedValue();

      await financialService.updateAccountBalance(2, -40);
      expect(addSpy).toHaveBeenCalledWith(2, expect.objectContaining({ type: "expense", amount: 40, category: "system" }));
    });
  });

  describe("getAllTransactions", () => {
    it("flattens transactions across accounts, sorted newest first", async () => {
      vi.spyOn(financialService, "_getData").mockResolvedValue({
        accounts: [
          { userId: 1, transactions: [{ id: 1, type: "income", category: "a", timestamp: "2023-01-01T00:00:00Z" }] },
          { userId: 2, transactions: [{ id: 2, type: "expense", category: "b", timestamp: "2023-03-01T00:00:00Z" }] },
        ],
      });

      const all = await financialService.getAllTransactions();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ id: 2, userId: 2 });
      expect(all[1]).toMatchObject({ id: 1, userId: 1 });
    });

    it("applies type and category filters", async () => {
      vi.spyOn(financialService, "_getData").mockResolvedValue({
        accounts: [
          {
            userId: 1,
            transactions: [
              { id: 1, type: "income", category: "salary", timestamp: "2023-01-01T00:00:00Z" },
              { id: 2, type: "expense", category: "feed", timestamp: "2023-01-02T00:00:00Z" },
            ],
          },
        ],
      });

      const incomeOnly = await financialService.getAllTransactions({ type: "income" });
      expect(incomeOnly.map((t) => t.id)).toEqual([1]);

      const feedOnly = await financialService.getAllTransactions({ category: "feed" });
      expect(feedOnly.map((t) => t.id)).toEqual([2]);
    });
  });
});
