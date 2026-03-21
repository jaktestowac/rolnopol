import { describe, test, expect, vi } from "vitest";
import fc from "fast-check";
const financial = require("../../services/financial.service");

describe("FinancialService property-based tests", () => {
  test("_getMaxTransactionId handles empty and mixed transaction collections", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            transactions: fc.array(fc.oneof(fc.record({ id: fc.nat() }), fc.record({ id: fc.constant(null) }), fc.record({}))),
          }),
        ),
        (accounts) => {
          const id = financial._getMaxTransactionId(accounts);
          expect(Number.isInteger(id)).toBe(true);
          expect(id).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  test("recalculateAllBalances and verifyBalanceCalculation maintain consistency", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timestamp: fc.date({ min: new Date(2000, 0, 1), max: new Date(2030, 11, 31) }),
            type: fc.constantFrom("income", "expense"),
            amount: fc.integer({ min: 1, max: 1000 }),
          }),
        ),
        (rawTxs) => {
          const account = {
            userId: 1,
            balance: 0,
            transactions: rawTxs.map((tx, index) => ({
              id: index + 1,
              ...tx,
              balanceBefore: 0,
              balanceAfter: 0,
            })),
          };

          financial.recalculateAllBalances(account);

          let running = 0;
          account.transactions
            .slice()
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .forEach((tx) => {
              expect(tx.balanceBefore).toBeCloseTo(running, 2);
              const expected = tx.type === "income" ? running + tx.amount : running - tx.amount;
              expect(tx.balanceAfter).toBeCloseTo(expected, 2);
              running = expected;
            });

          expect(account.balance).toBeCloseTo(running, 2);

          const verified = financial.verifyBalanceCalculation(account);
          expect(verified).toBe(true);
        },
      ),
    );
  });

  test("_ensureCounters updates counters correctly against accounts data", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.nat(),
            transactions: fc.array(fc.record({ id: fc.nat(), amount: fc.integer({ min: 0, max: 1000 }) })),
          }),
        ),
        fc.oneof(fc.constant(undefined), fc.record({ lastAccountId: fc.nat(), lastTransactionId: fc.nat() })),
        (accounts, counters) => {
          const data = { accounts, counters: counters || undefined };
          const before = data.counters ? { ...data.counters } : undefined;
          const changed = financial._ensureCounters(data);
          if (!before) {
            expect(data.counters).toEqual({ lastAccountId: expect.any(Number), lastTransactionId: expect.any(Number) });
            expect(changed).toBe(true);
          } else {
            expect(data.counters.lastAccountId).toBeGreaterThanOrEqual(0);
            expect(data.counters.lastTransactionId).toBeGreaterThanOrEqual(0);
            // changed may be true/false depending on input ordering
            expect(typeof changed).toBe("boolean");
          }
        },
      ),
    );
  });

  test("_getNextAccountId increments counter and returns next ID", async () => {
    const dataSnapshot = { accounts: [], counters: { lastAccountId: 7, lastTransactionId: 42 } };
    vi.spyOn(financial, "_getData").mockResolvedValue({ ...dataSnapshot });
    const saveSpy = vi.spyOn(financial, "_saveData").mockResolvedValue();
    const nextId = await financial._getNextAccountId();
    expect(nextId).toBe(8);
    expect(saveSpy).toHaveBeenCalled();
    saveSpy.mockRestore();
    financial._getData.mockRestore();
  });

  test("_getNextTransactionId increments counter and returns next ID", async () => {
    const dataSnapshot = { accounts: [], counters: { lastAccountId: 7, lastTransactionId: 42 } };
    vi.spyOn(financial, "_getData").mockResolvedValue({ ...dataSnapshot });
    const saveSpy = vi.spyOn(financial, "_saveData").mockResolvedValue();
    const nextId = await financial._getNextTransactionId();
    expect(nextId).toBe(43);
    expect(saveSpy).toHaveBeenCalled();
    saveSpy.mockRestore();
    financial._getData.mockRestore();
  });

  test("addTransaction adjusts balances correctly for income and expense", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("income", "expense"),
        fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(5000), noNaN: true }),
        async (type, amount, initialBalance) => {
          const userAccount = { userId: 1, balance: initialBalance, transactions: [] };

          vi.spyOn(financial, "_getAccounts").mockResolvedValue([userAccount]);
          vi.spyOn(financial, "_getNextTransactionId").mockResolvedValue(9001);
          vi.spyOn(financial, "_saveAccounts").mockResolvedValue();

          if (type === "expense" && amount > initialBalance) {
            await expect(financial.addTransaction(1, { type, amount, description: "test", category: "general" })).rejects.toThrow(
              "Insufficient funds",
            );
          } else {
            const tx = await financial.addTransaction(1, { type, amount, description: "test", category: "general" });
            expect(tx).toMatchObject({ id: 9001, type, amount });
          }

          financial._getAccounts.mockRestore();
          financial._getNextTransactionId.mockRestore();
          financial._saveAccounts.mockRestore();
        },
      ),
    );
  });

  test("transferFunds calls addTransaction twice and returns success", async () => {
    vi.spyOn(financial, "getAccount").mockResolvedValue({ userId: 1, balance: 1000 });
    vi.spyOn(financial, "findAccount").mockResolvedValue({ userId: 2, balance: 100 });
    const addSpy = vi.spyOn(financial, "addTransaction").mockResolvedValue({});

    const result = await financial.transferFunds(1, 2, 100, "payment");

    expect(result).toEqual({ success: true, amount: 100 });
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith(1, expect.objectContaining({ type: "expense", amount: 100 }));
    expect(addSpy).toHaveBeenCalledWith(2, expect.objectContaining({ type: "income", amount: 100 }));

    financial.getAccount.mockRestore();
    financial.findAccount.mockRestore();
    financial.addTransaction.mockRestore();
  });
});
