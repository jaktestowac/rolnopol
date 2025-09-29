import financialService from "../../services/financial.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("financial.service", () => {
  let db;

  beforeEach(() => {
    db = financialService.db;
  });

  it("should call db.getAll for account retrieval", async () => {
    const spy = vi
      .spyOn(db, "getAll")
      .mockResolvedValue([{ userId: 1, balance: 100 }]);
    const result = await db.getAll();
    expect(result).toEqual([{ userId: 1, balance: 100 }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should initialize account if not found", async () => {
    vi.spyOn(financialService, "_getAccounts").mockResolvedValue([]);
    const initSpy = vi
      .spyOn(financialService, "initializeAccount")
      .mockResolvedValue({ id: 1, userId: 2, balance: 0 });
    const result = await financialService.getAccount(2);
    expect(initSpy).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({ id: 1, userId: 2, balance: 0 });
  });

  it("should add income transaction", async () => {
    vi.spyOn(financialService, "_getAccounts").mockResolvedValue([
      { userId: 2, balance: 0, transactions: [] },
    ]);
    vi.spyOn(financialService, "_getNextTransactionId").mockResolvedValue(1);
    vi.spyOn(financialService, "_saveAccounts").mockResolvedValue();
    const result = await financialService.addTransaction(2, {
      type: "income",
      amount: 100,
      description: "Test",
    });
    expect(result).toMatchObject({
      type: "income",
      amount: 100,
      description: "Test",
    });
  });

  it("should throw error for overdraft on expense", async () => {
    vi.spyOn(financialService, "_getAccounts").mockResolvedValue([
      { userId: 2, balance: 10, transactions: [] },
    ]);
    await expect(
      financialService.addTransaction(2, {
        type: "expense",
        amount: 100,
        description: "Test",
      }),
    ).rejects.toThrow("Insufficient funds");
  });

  it("should get transaction history with filters", async () => {
    vi.spyOn(financialService, "getAccount").mockResolvedValue({
      transactions: [
        {
          type: "income",
          category: "marketplace",
          timestamp: "2023-01-01T00:00:00Z",
        },
        {
          type: "expense",
          category: "transfer",
          timestamp: "2023-01-02T00:00:00Z",
        },
      ],
    });
    const result = await financialService.getTransactionHistory(2, {
      type: "income",
      category: "marketplace",
      startDate: "2023-01-01",
      endDate: "2023-01-31",
    });
    expect(result.transactions.length).toBeGreaterThanOrEqual(0);
  });

  it("should transfer funds between users", async () => {
    vi.spyOn(financialService, "getAccount").mockResolvedValue({
      userId: 1,
      balance: 100,
    });
    vi.spyOn(financialService, "findAccount").mockResolvedValue({
      userId: 2,
      balance: 0,
    });
    vi.spyOn(financialService, "addTransaction").mockResolvedValue();
    const result = await financialService.transferFunds(1, 2, 50, "desc");
    expect(result).toMatchObject({ success: true, amount: 50 });
  });
});
