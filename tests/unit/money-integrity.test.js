import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { withLedgerLock, roundMoney, sameUserId } = require("../../helpers/ledger");
const financialService = require("../../services/financial.service.js");
const marketplaceService = require("../../services/marketplace.service.js");
const commoditiesService = require("../../services/commodities.service.js");
const pricingService = require("../../services/commodities-pricing.service.js");
const adminControls = require("../../services/commodities-admin-controls.service.js");
const notificationCenter = require("../../modules/notification-center");

const OPENED_AT = "2026-01-01T00:00:00.000Z";

// An account whose balance is backed by one opening transaction, so the
// integrity recalculation in getAccount keeps the same balance.
function account(id, userId, balance) {
  return {
    id,
    userId,
    balance,
    currency: "ROL",
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
    transactions:
      balance > 0
        ? [{ id: id * 1000, type: "income", amount: balance, description: "Opening", category: "seed", timestamp: OPENED_AT }]
        : [],
  };
}

// In-memory financial store. replaceAll yields to the event loop like the real
// persist does, which is what lets two unlocked operations interleave.
function useInMemoryLedger(accounts) {
  const data = { accounts, counters: { lastAccountId: 100, lastTransactionId: 100000 } };
  vi.spyOn(financialService.db, "getAll").mockImplementation(async () => data);
  vi.spyOn(financialService.db, "replaceAll").mockImplementation(async (next) => {
    await new Promise((resolve) => setImmediate(resolve));
    if (next !== data) Object.assign(data, next);
  });
  return {
    data,
    balanceOf: (userId) => data.accounts.find((acc) => parseInt(acc.userId, 10) === parseInt(userId, 10)).balance,
    transactionsOf: (userId) => data.accounts.find((acc) => parseInt(acc.userId, 10) === parseInt(userId, 10)).transactions,
  };
}

beforeEach(() => {
  vi.spyOn(notificationCenter, "publish").mockResolvedValue({ accepted: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ledger helpers", () => {
  it("roundMoney keeps two decimals without float drift", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney("12.345")).toBe(12.35);
    expect(roundMoney("abc")).toBeNaN();
  });

  it("sameUserId treats numeric and string ids as the same user", () => {
    expect(sameUserId(5, "5")).toBe(true);
    expect(sameUserId("5", 5)).toBe(true);
    expect(sameUserId(5, 6)).toBe(false);
    expect(sameUserId("abc", "abc")).toBe(false);
    expect(sameUserId(undefined, undefined)).toBe(false);
  });

  it("withLedgerLock runs operations one at a time", async () => {
    const events = [];
    const op = (name) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([withLedgerLock(op("a")), withLedgerLock(op("b"))]);

    expect(results).toEqual(["a", "b"]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("withLedgerLock is reentrant and a failure does not block the queue", async () => {
    const nested = await withLedgerLock(() => withLedgerLock(async () => "inner"));
    expect(nested).toBe("inner");

    await expect(withLedgerLock(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(withLedgerLock(async () => "after")).resolves.toBe("after");
  });
});

describe("financial.service money integrity", () => {
  it("does not let two concurrent expenses overdraw the account", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 100)]);

    const results = await Promise.allSettled([
      financialService.addTransaction(2, { type: "expense", amount: 80, description: "first" }),
      financialService.addTransaction(2, { type: "expense", amount: 80, description: "second" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected").reason.message).toContain("Insufficient funds");
    expect(ledger.balanceOf(2)).toBe(20);
  });

  it("does not let two concurrent transfers spend the same balance", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 100), account(2, 3, 0), account(3, 4, 0)]);

    const results = await Promise.allSettled([
      financialService.transferFunds(2, 3, 70, "to three"),
      financialService.transferFunds(2, 4, 70, "to four"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(ledger.balanceOf(2)).toBe(30);
    expect(ledger.balanceOf(3) + ledger.balanceOf(4)).toBe(70);
  });

  it("rounds stored amounts and balances to cents", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 0)]);

    await financialService.addTransaction(2, { type: "income", amount: 0.1, description: "a" });
    await financialService.addTransaction(2, { type: "income", amount: 0.2, description: "b" });
    const tx = await financialService.addTransaction(2, { type: "income", amount: "10.006", description: "c" });

    expect(tx.amount).toBe(10.01);
    expect(ledger.balanceOf(2)).toBe(10.31);
  });

  it("rejects a non-numeric amount instead of storing NaN", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 50)]);

    await expect(financialService.addTransaction(2, { type: "income", amount: "abc", description: "x" })).rejects.toThrow(
      "Transaction amount must be positive",
    );
    expect(ledger.transactionsOf(2)).toHaveLength(1);
    expect(ledger.balanceOf(2)).toBe(50);
  });

  it("rejects a transfer to yourself whatever the id types", async () => {
    const ledger = useInMemoryLedger([account(1, 5, 100)]);

    await expect(financialService.transferFunds("5", 5, 10, "self")).rejects.toThrow("Cannot transfer funds to yourself");
    await expect(financialService.transferFunds(5, "5", 10, "self")).rejects.toThrow("Cannot transfer funds to yourself");
    expect(ledger.balanceOf(5)).toBe(100);
  });

  it("gives the sender the money back when crediting the recipient fails", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 100), account(2, 3, 0)]);
    const realNextId = financialService._getNextTransactionId.bind(financialService);
    let calls = 0;
    vi.spyOn(financialService, "_getNextTransactionId").mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw new Error("ledger unavailable");
      return realNextId();
    });

    await expect(financialService.transferFunds(2, 3, 40, "rent")).rejects.toThrow("ledger unavailable");

    expect(ledger.balanceOf(2)).toBe(100);
    expect(ledger.balanceOf(3)).toBe(0);
    expect(ledger.transactionsOf(2).map((t) => t.description)).toEqual(["Opening", "Transfer to user: rent", "Transfer reversal: rent"]);
  });
});

describe("marketplace.service purchase payments", () => {
  // Seller 8 and buyer 17 store numeric userIds, like every account created
  // after the seed data. Payment used to look accounts up by string id only.
  function useMarket({ sellerBalance = 0, buyerBalances = { 17: 100 }, offerPrice = 40 } = {}) {
    const accounts = [account(1, 8, sellerBalance)];
    let nextAccountId = 2;
    for (const [buyerId, balance] of Object.entries(buyerBalances)) {
      accounts.push(account(nextAccountId++, Number(buyerId), balance));
    }
    const ledger = useInMemoryLedger(accounts);

    const market = {
      offers: [{ id: 1, sellerId: 8, itemType: "animal", itemId: 50, price: offerPrice, status: "active" }],
      transactions: [],
      counters: { lastOfferId: 1, lastTransactionId: 0 },
    };
    const animals = [{ id: 50, userId: 8, type: "cow", amount: 1, fieldId: null }];
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockImplementation(async () => market);
    vi.spyOn(marketplaceService.marketplaceDb, "write").mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    vi.spyOn(marketplaceService.animalsDb, "read").mockImplementation(async () => animals);
    vi.spyOn(marketplaceService.animalsDb, "write").mockResolvedValue();
    vi.spyOn(marketplaceService.fieldsDb, "read").mockResolvedValue([]);

    return { ledger, market, animals };
  }

  it("pays a seller whose account stores a numeric userId", async () => {
    const { ledger, market, animals } = useMarket();

    const transaction = await marketplaceService.buyItem(17, 1);

    expect(transaction).toMatchObject({ offerId: 1, sellerId: 8, buyerId: 17, price: 40 });
    expect(ledger.balanceOf(8)).toBe(40);
    expect(ledger.balanceOf(17)).toBe(60);
    expect(ledger.transactionsOf(8).at(-1)).toMatchObject({ type: "income", amount: 40, category: "marketplace" });
    expect(ledger.transactionsOf(17).at(-1)).toMatchObject({ type: "expense", amount: 40, category: "marketplace" });
    expect(market.offers[0].status).toBe("sold");
    expect(animals[0].userId).toBe(17);
  });

  it("sells an offer only once when two buyers race for it", async () => {
    const { ledger, market } = useMarket({ buyerBalances: { 17: 100, 18: 100 } });

    const results = await Promise.allSettled([marketplaceService.buyItem(17, 1), marketplaceService.buyItem(18, 1)]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected").reason).toMatchObject({ statusCode: 404 });
    expect(ledger.balanceOf(8)).toBe(40);
    expect(ledger.balanceOf(17) + ledger.balanceOf(18)).toBe(160);
    expect(market.transactions).toHaveLength(1);
  });

  it("refunds both sides when the item cannot change hands", async () => {
    const { ledger, market } = useMarket();
    vi.spyOn(marketplaceService, "_transferItemOwnership").mockRejectedValue(new Error("Failed to transfer animal ownership: disk full"));

    await expect(marketplaceService.buyItem(17, 1)).rejects.toThrow("disk full");

    expect(ledger.balanceOf(8)).toBe(0);
    expect(ledger.balanceOf(17)).toBe(100);
    expect(market.offers[0].status).toBe("active");
    expect(market.transactions).toHaveLength(0);
  });

  it("rejects an offer price that is not a number", async () => {
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([{ id: 1 }]);

    await expect(marketplaceService.createOffer(1, { itemType: "animal", itemId: 50, price: "abc" })).rejects.toMatchObject({
      statusCode: 400,
      message: "Price must be greater than 0",
    });
  });

  it("never reuses an offer id when the counter is behind the stored offers", async () => {
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([{ id: 1 }]);
    vi.spyOn(marketplaceService, "_verifyItemOwnership").mockResolvedValue({ id: 50, userId: 1 });
    const market = {
      offers: [{ id: 29, sellerId: 6, itemType: "field", itemId: 7, price: 155500, status: "active" }],
      counters: { lastOfferId: 28 },
    };
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue(market);
    vi.spyOn(marketplaceService.marketplaceDb, "write").mockResolvedValue();

    const { newOffer } = await marketplaceService.createOffer(1, { itemType: "animal", itemId: 50, price: 75.5 });

    expect(newOffer.id).toBe(30);
    expect(market.offers.filter((o) => o.id === newOffer.id)).toHaveLength(1);
  });

  it("stores the offer price rounded to cents", async () => {
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([{ id: 1 }]);
    vi.spyOn(marketplaceService, "_verifyItemOwnership").mockResolvedValue({ id: 50, userId: 1 });
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({ offers: [], counters: { lastOfferId: 0 } });
    vi.spyOn(marketplaceService.marketplaceDb, "write").mockResolvedValue();

    const { newOffer } = await marketplaceService.createOffer(1, { itemType: "animal", itemId: 50, price: "19.999" });

    expect(newOffer.price).toBe(20);
  });
});

describe("commodities.service buy refund", () => {
  it("refunds the buyer when the holding cannot be recorded", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 500)]);
    vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
    vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
    vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({
      executionPrice: 100,
      midPrice: 100,
      spreadPct: 1,
      liquidityImpactPct: 0,
      hourStartUtc: "h",
    });
    vi.spyOn(commoditiesService.db, "getAll").mockResolvedValue({ holdings: [], metadata: {} });
    vi.spyOn(commoditiesService.db, "replaceAll").mockRejectedValue(new Error("disk full"));

    await expect(commoditiesService.buyCommodity(2, { symbol: "gold", quantity: 2 })).rejects.toThrow("disk full");

    expect(ledger.balanceOf(2)).toBe(500);
    expect(ledger.transactionsOf(2).map((t) => t.type)).toEqual(["income", "expense", "income"]);
  });
});

describe("commodities.service trading integrity", () => {
  // In-memory holdings store; replaceAll yields like the real persist does.
  function useHoldings(holdings) {
    let state = { holdings, metadata: { version: 1 } };
    vi.spyOn(commoditiesService.db, "getAll").mockImplementation(async () => state);
    vi.spyOn(commoditiesService.db, "replaceAll").mockImplementation(async (next) => {
      await new Promise((resolve) => setImmediate(resolve));
      state = next;
    });
    return { holdingOf: (userId, symbol) => state.holdings.find((h) => h.userId === userId && h.symbol === symbol) };
  }

  function quoteAt(executionPrice) {
    vi.spyOn(pricingService, "normalizeSymbol").mockReturnValue("GOLD");
    vi.spyOn(adminControls, "validateTrade").mockImplementation(() => {});
    vi.spyOn(pricingService, "getExecutionQuote").mockReturnValue({
      executionPrice,
      midPrice: executionPrice,
      spreadPct: 0,
      liquidityImpactPct: 0,
      hourStartUtc: "h",
    });
  }

  it("two concurrent sells of the whole holding pay out only once", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 0)]);
    const store = useHoldings([{ userId: 2, symbol: "GOLD", quantity: 2, totalInvested: 200, avgBuyPrice: 100 }]);
    quoteAt(100);

    const results = await Promise.allSettled([
      commoditiesService.sellCommodity(2, { symbol: "gold", quantity: 2 }),
      commoditiesService.sellCommodity(2, { symbol: "gold", quantity: 2 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected").reason.message).toContain("Insufficient quantity");
    expect(ledger.balanceOf(2)).toBe(200);
    expect(store.holdingOf(2, "GOLD")).toBeUndefined();
  });

  it("two concurrent buys cannot spend the same balance", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 300)]);
    const store = useHoldings([]);
    quoteAt(100);

    const results = await Promise.allSettled([
      commoditiesService.buyCommodity(2, { symbol: "gold", quantity: 2 }),
      commoditiesService.buyCommodity(2, { symbol: "gold", quantity: 2 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected").reason.message).toContain("Insufficient funds");
    expect(ledger.balanceOf(2)).toBe(100);
    expect(store.holdingOf(2, "GOLD").quantity).toBe(2);
  });

  it("gives the sold quantity back when the seller cannot be paid", async () => {
    useInMemoryLedger([account(1, 2, 0)]);
    const store = useHoldings([{ userId: 2, symbol: "GOLD", quantity: 3, totalInvested: 300, avgBuyPrice: 100 }]);
    quoteAt(120);
    vi.spyOn(financialService, "addTransaction").mockRejectedValue(new Error("ledger unavailable"));

    await expect(commoditiesService.sellCommodity(2, { symbol: "gold", quantity: 2 })).rejects.toThrow("ledger unavailable");

    expect(store.holdingOf(2, "GOLD")).toMatchObject({ quantity: 3, totalInvested: 300, avgBuyPrice: 100 });
  });

  it("rejects a buy worth less than one cent before charging anything", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 50)]);
    const store = useHoldings([]);
    quoteAt(35);

    await expect(commoditiesService.buyCommodity(2, { symbol: "gold", quantity: "0.0001" })).rejects.toThrow(
      "Validation failed: trade value must be at least 0.01 ROL",
    );

    expect(ledger.transactionsOf(2)).toHaveLength(1);
    expect(store.holdingOf(2, "GOLD")).toBeUndefined();
  });

  it("rejects a sell worth less than one cent without touching the holding", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 0)]);
    const store = useHoldings([{ userId: 2, symbol: "GOLD", quantity: 1, totalInvested: 35, avgBuyPrice: 35 }]);
    quoteAt(35);

    await expect(commoditiesService.sellCommodity(2, { symbol: "gold", quantity: "0.0001" })).rejects.toThrow(
      "Validation failed: trade value must be at least 0.01 ROL",
    );

    expect(store.holdingOf(2, "GOLD").quantity).toBe(1);
    expect(ledger.balanceOf(2)).toBe(0);
  });
});

describe("money edge cases", () => {
  it("allows spending the exact balance but not one cent more", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 10.5)]);

    await expect(financialService.addTransaction(2, { type: "expense", amount: 10.51, description: "x" })).rejects.toThrow(
      "Insufficient funds",
    );
    await financialService.addTransaction(2, { type: "expense", amount: 10.5, description: "x" });

    expect(ledger.balanceOf(2)).toBe(0);
  });

  it("does not debit the sender when the recipient does not exist", async () => {
    const ledger = useInMemoryLedger([account(1, 2, 100)]);

    await expect(financialService.transferFunds(2, 999, 10, "ghost")).rejects.toThrow("Recipient user does not exist");

    expect(ledger.balanceOf(2)).toBe(100);
    expect(ledger.transactionsOf(2)).toHaveLength(1);
  });

  it.each([["Infinity"], [-5], [0], ["1e400"], [null]])("rejects offer price %s", async (price) => {
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([{ id: 1 }]);

    await expect(marketplaceService.createOffer(1, { itemType: "animal", itemId: 50, price })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("leaves everything untouched when the buyer cannot afford the offer", async () => {
    const ledger = useInMemoryLedger([account(1, 8, 0), account(2, 17, 30)]);
    const market = {
      offers: [{ id: 1, sellerId: 8, itemType: "animal", itemId: 50, price: 40, status: "active" }],
      transactions: [],
      counters: { lastOfferId: 1, lastTransactionId: 0 },
    };
    const animals = [{ id: 50, userId: 8, fieldId: null }];
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue(market);
    const marketWrite = vi.spyOn(marketplaceService.marketplaceDb, "write").mockResolvedValue();
    vi.spyOn(marketplaceService.animalsDb, "read").mockResolvedValue(animals);
    const animalsWrite = vi.spyOn(marketplaceService.animalsDb, "write").mockResolvedValue();

    await expect(marketplaceService.buyItem(17, 1)).rejects.toMatchObject({ statusCode: 400 });

    expect(ledger.balanceOf(8)).toBe(0);
    expect(ledger.balanceOf(17)).toBe(30);
    expect(market.offers[0].status).toBe("active");
    expect(animals[0].userId).toBe(8);
    expect(marketWrite).not.toHaveBeenCalled();
    expect(animalsWrite).not.toHaveBeenCalled();
  });

  it("refuses to sell an item the seller no longer owns, and moves no money", async () => {
    const ledger = useInMemoryLedger([account(1, 8, 0), account(2, 17, 100)]);
    const market = {
      offers: [{ id: 1, sellerId: 8, itemType: "animal", itemId: 50, price: 40, status: "active" }],
      transactions: [],
      counters: { lastOfferId: 1, lastTransactionId: 0 },
    };
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue(market);
    vi.spyOn(marketplaceService.animalsDb, "read").mockResolvedValue([{ id: 50, userId: 99, fieldId: null }]);

    await expect(marketplaceService.buyItem(17, 1)).rejects.toMatchObject({ statusCode: 404 });

    expect(ledger.balanceOf(8)).toBe(0);
    expect(ledger.balanceOf(17)).toBe(100);
  });
});

describe("financial CSV escaping", () => {
  const financialController = require("../../controllers/financial.controller");

  it.each([
    ["=1+1", "'=1+1"],
    ["+cmd", "'+cmd"],
    ["-SUM(1,2)", `"'-SUM(1,2)"`],
    ["@A1", "'@A1"],
    ["\tTAB", "'\tTAB"],
  ])("prefixes formula-like text %j", (input, expected) => {
    expect(financialController._escapeCsv(input)).toBe(expected);
  });

  it.each([
    ["-12.5", "-12.5"],
    ["42", "42"],
    ["Feed for cows", "Feed for cows"],
    ['say "hi", farmer', '"say ""hi"", farmer"'],
    [null, ""],
  ])("leaves %j as plain CSV", (input, expected) => {
    expect(financialController._escapeCsv(input)).toBe(expected);
  });
});
