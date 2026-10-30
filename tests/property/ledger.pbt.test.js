import { describe, test, expect, vi, afterEach } from "vitest";
import fc from "fast-check";

const financialService = require("../../services/financial.service");
const notificationCenter = require("../../modules/notification-center");
const { roundMoney } = require("../../helpers/ledger");

const OPENED_AT = "2026-01-01T00:00:00.000Z";
const cents = (min, max) => fc.integer({ min, max }).map((c) => c / 100);

function useInMemoryLedger(balances) {
  const data = {
    accounts: balances.map((balance, i) => ({
      id: i + 1,
      userId: i + 1,
      balance,
      transactions: balance > 0 ? [{ id: i + 1, type: "income", amount: balance, description: "Opening", timestamp: OPENED_AT }] : [],
    })),
    counters: { lastAccountId: balances.length, lastTransactionId: 1000 },
  };
  vi.spyOn(financialService.db, "getAll").mockImplementation(async () => data);
  vi.spyOn(financialService.db, "replaceAll").mockImplementation(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  vi.spyOn(notificationCenter, "publish").mockResolvedValue({ accepted: true });
  return data;
}

function sumOfTransactions(account) {
  return account.transactions.reduce((sum, tx) => roundMoney(tx.type === "income" ? sum + tx.amount : sum - tx.amount), 0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ledger property-based tests", () => {
  test("concurrent transfers conserve money and never overdraw an account", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(cents(0, 200000), { minLength: 2, maxLength: 5 }),
        fc.array(fc.record({ from: fc.nat(), to: fc.nat(), amount: cents(1, 99999) }), { minLength: 1, maxLength: 12 }),
        async (balances, rawTransfers) => {
          vi.restoreAllMocks();
          const data = useInMemoryLedger(balances);
          const totalBefore = roundMoney(balances.reduce((a, b) => a + b, 0));
          const transfers = rawTransfers.map((t) => ({
            from: (t.from % balances.length) + 1,
            to: (t.to % balances.length) + 1,
            amount: t.amount,
          }));

          const results = await Promise.allSettled(
            transfers.map((t) => financialService.transferFunds(t.from, t.to, t.amount, "property transfer")),
          );

          const totalAfter = roundMoney(data.accounts.reduce((sum, acc) => sum + acc.balance, 0));
          expect(totalAfter).toBe(totalBefore);
          for (const acc of data.accounts) {
            expect(acc.balance).toBeGreaterThanOrEqual(0);
            expect(acc.balance).toBe(sumOfTransactions(acc));
          }
          results.forEach((result, i) => {
            if (transfers[i].from === transfers[i].to) {
              expect(result.status).toBe("rejected");
            }
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  test("balances stay at whole cents after any sequence of deposits and spends", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ type: fc.constantFrom("income", "expense"), amount: cents(1, 100000) }), { minLength: 1, maxLength: 25 }),
        async (operations) => {
          vi.restoreAllMocks();
          const data = useInMemoryLedger([0]);

          for (const op of operations) {
            await financialService.addTransaction(1, { ...op, description: "property op" }).catch(() => undefined);
          }

          const { balance } = data.accounts[0];
          expect(balance).toBeGreaterThanOrEqual(0);
          expect(Math.round(balance * 100) / 100).toBe(balance);
          expect(balance).toBe(sumOfTransactions(data.accounts[0]));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("commodity pricing property-based tests", () => {
  const pricingService = require("../../services/commodities-pricing.service");
  const SYMBOLS = ["GOLD", "SILVER", "PLATINUM", "PALLADIUM", "ETHERIUM", "MARKER_FRAGMENT", "ISHIMURA_ALLOY"];

  test("selling a quantity never pays more than buying it cost in the same hour", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SYMBOLS),
        fc.integer({ min: 1, max: 50000 }).map((q) => q / 10000),
        fc.integer({ min: -2000, max: 2000 }),
        (symbol, quantity, hourOffset) => {
          const at = new Date(Date.UTC(2026, 9, 30, 12) + hourOffset * 3600 * 1000);
          const buy = pricingService.getExecutionQuote(symbol, "buy", quantity, at);
          const sell = pricingService.getExecutionQuote(symbol, "sell", quantity, at);
          // Same rounding the trading service applies to cost and proceeds.
          const cost = Number((buy.executionPrice * quantity).toFixed(2));
          const proceeds = Number((sell.executionPrice * quantity).toFixed(2));

          expect(sell.executionPrice).toBeLessThanOrEqual(buy.executionPrice);
          expect(proceeds).toBeLessThanOrEqual(cost);
        },
      ),
      { numRuns: 500 },
    );
  });
});
