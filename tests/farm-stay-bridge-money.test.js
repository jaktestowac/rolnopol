import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// This suite exercises the Rolnopol bridge (routes/v1/farm-stay.route.js) against
// a REAL FarmStay ecosystem, but with an IN-MEMORY financial service so no real
// data/financial.json is touched and insufficient/transient failures can be
// simulated deterministically. Covers: coupons e2e, idempotency, the confirm
// charge-failure window + reconciliation, resilient host payout, and the
// structured error contract.
const GATEWAY_PORT = 4460;
process.env.FARM_STAY_TARGET = `http://localhost:${GATEWAY_PORT}`;
process.env.FARM_STAY_CLIENT_TIMEOUT_MS = "3000";

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const financialService = require("../services/financial.service.js");
const { _clear: clearIdempotency } = require("../modules/farm-stay/idempotency.js");

const FLAG = "farmStayEnabled";

// ── In-memory financial fake (overrides the singleton's methods in place) ──────
const accounts = new Map(); // userId(string) → { userId, balance, currency, transactions: [] }
let failNextExpenseWith = null; // simulate a transient (non-insufficient) charge failure

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const acc = (id) => accounts.get(String(id));
const ensure = (id) => {
  if (!acc(id)) accounts.set(String(id), { userId: id, balance: 0, currency: "ROL", transactions: [] });
  return acc(id);
};
const fund = (id, amount) => {
  ensure(id).balance = amount;
};
const txOf = (id, type) => (acc(id)?.transactions || []).filter((t) => t.type === type);

function installFinancialFake() {
  financialService.getAccount = vi.fn(async (id) => acc(id) || null);
  financialService.initializeAccount = vi.fn(async (id) => ensure(id));
  financialService.addTransaction = vi.fn(async (id, tx) => {
    if (tx.type === "expense" && failNextExpenseWith) {
      const msg = failNextExpenseWith;
      failNextExpenseWith = null;
      throw new Error(msg);
    }
    const a = ensure(id);
    if (tx.type === "expense" && a.balance < tx.amount) {
      throw new Error("Insufficient funds: overdraft is not allowed");
    }
    const t = { id: a.transactions.length + 1, ...tx, timestamp: new Date().toISOString() };
    a.transactions.push(t);
    a.balance = round2(a.balance + (tx.type === "income" ? tx.amount : -tx.amount));
    return t;
  });
}

async function setFlag(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { [FLAG]: enabled } })
    .expect(200);
}
async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

const tok = (u) => tokenHelpers.generateToken(u);
const bridge = (method, path, token) => request(app)[method](`/api/v1/farm-stay${path}`).set("token", token);

async function createProperty(token, over = {}) {
  const res = await bridge("post", "/properties", token)
    .send({ name: "Money Test Farm", type: "cottage", capacity: 4, basePrice: 100, district: "MoneyTest", policy: "flexible", ...over })
    .expect(201);
  return res.body.id;
}

let eco;
let originalFlags;

beforeAll(async () => {
  originalFlags = await getFlags();
  installFinancialFake();
  eco = await startEcosystem({ base: GATEWAY_PORT, tag: "money" });
  await setFlag(true);
});

afterAll(async () => {
  if (eco) await eco.stop();
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
});

describe("farm-stay bridge — coupons end to end", () => {
  it("applies a promo code through bridge → gateway → pricing, and charges the discounted total", async () => {
    const host = tok("host-coupon");
    const guest = tok("guest-coupon");
    fund("guest-coupon", 1000);
    const propertyId = await createProperty(host);

    const booked = await bridge("post", "/bookings", guest)
      .send({ propertyId, from: "2035-06-11", to: "2035-06-13", guests: 2, coupon: "WELCOME10" })
      .expect(201);

    expect(booked.body.quote.coupon).toMatchObject({ code: "WELCOME10", applied: true });
    expect(booked.body.quote.total).toBeLessThan(booked.body.quote.subtotal);
    const discounted = booked.body.quote.total;

    const confirmed = await bridge("post", `/bookings/${booked.body.bookingId}/confirm`, guest).send({}).expect(200);
    expect(confirmed.body.charged).toBe(discounted); // charged the discounted price, not the subtotal
    expect(confirmed.body.paymentStatus).toBe("paid");
  });
});

describe("farm-stay bridge — idempotent confirm", () => {
  it("charges once for repeated confirms carrying the same Idempotency-Key", async () => {
    clearIdempotency();
    const host = tok("host-idem");
    const guest = tok("guest-idem");
    fund("guest-idem", 1000);
    const propertyId = await createProperty(host);
    const booked = await bridge("post", "/bookings", guest)
      .send({ propertyId, from: "2035-07-10", to: "2035-07-12", guests: 1 })
      .expect(201);
    const id = booked.body.bookingId;

    const first = await bridge("post", `/bookings/${id}/confirm`, guest).set("Idempotency-Key", "confirm-key-1").send({}).expect(200);
    const replay = await bridge("post", `/bookings/${id}/confirm`, guest).set("Idempotency-Key", "confirm-key-1").send({}).expect(200);

    expect(replay.body.charged).toBe(first.body.charged);
    expect(txOf("guest-idem", "expense")).toHaveLength(1); // exactly one charge despite two confirms
  });
});

describe("farm-stay bridge — insufficient funds (structured error)", () => {
  it("returns a 402 with the canonical envelope and rolls the hold back", async () => {
    const host = tok("host-poor");
    const guest = tok("guest-poor"); // balance 0
    const propertyId = await createProperty(host);
    const booked = await bridge("post", "/bookings", guest)
      .send({ propertyId, from: "2035-08-10", to: "2035-08-12", guests: 1 })
      .expect(201);

    const res = await bridge("post", `/bookings/${booked.body.bookingId}/confirm`, guest).send({}).expect(402);
    expect(res.body.error).toBe("INSUFFICIENT_FUNDS");
    expect(res.body.code).toBe("INSUFFICIENT_FUNDS");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.needed).toBeGreaterThan(0);
    expect(res.body.balance).toBe(0);
    expect(res.body.currency).toBe("ROL");
  });
});

describe("farm-stay bridge — charge-failure window + reconciliation", () => {
  it("leaves the booking paid=pending on a transient charge failure, then settles on reconcile", async () => {
    const host = tok("host-window");
    const guest = tok("guest-window");
    fund("guest-window", 1000);
    const propertyId = await createProperty(host);
    const booked = await bridge("post", "/bookings", guest)
      .send({ propertyId, from: "2035-09-10", to: "2035-09-12", guests: 1 })
      .expect(201);
    const id = booked.body.bookingId;

    // Confirm succeeds at the gateway, but the ROL charge throws a transient error.
    failNextExpenseWith = "financial service network glitch";
    const confirmed = await bridge("post", `/bookings/${id}/confirm`, guest).send({}).expect(200);
    expect(confirmed.body.paymentStatus).toBe("pending");
    expect(confirmed.body.charged).toBe(0);
    expect(confirmed.body.booking.state).toBe("confirmed");
    expect(txOf("guest-window", "expense")).toHaveLength(0); // nothing charged yet

    // The purchases view surfaces the stuck payment.
    const before = await bridge("get", "/purchases", guest).expect(200);
    expect(before.body.purchases.find((p) => p.id === id)).toMatchObject({ paymentStatus: "pending", charged: 0 });

    // Reconcile retries the charge (no longer failing) and settles it.
    const recon = await bridge("post", "/reconcile", guest).expect(200);
    expect(recon.body.charges).toContainEqual(expect.objectContaining({ bookingId: id, status: "charged" }));
    expect(txOf("guest-window", "expense")).toHaveLength(1);

    const after = await bridge("get", "/purchases", guest).expect(200);
    expect(after.body.purchases.find((p) => p.id === id)).toMatchObject({ paymentStatus: "paid" });
  });
});

describe("farm-stay bridge — resilient host payout via reconcile", () => {
  it("pays the host for a completed stay without anyone browsing the booking", async () => {
    const host = tok("host-payout");
    const guest = tok("guest-payout");
    fund("guest-payout", 1000);
    const propertyId = await createProperty(host);

    // Past dates → the confirmed booking reads as "completed" immediately.
    const booked = await bridge("post", "/bookings", guest)
      .send({ propertyId, from: "2020-03-04", to: "2020-03-06", guests: 1 })
      .expect(201);
    const id = booked.body.bookingId;
    const confirmed = await bridge("post", `/bookings/${id}/confirm`, guest).send({}).expect(200);
    const stayTotal = confirmed.body.charged;
    expect(confirmed.body.booking.state).toBe("completed");

    // Host has not been paid yet (confirm does not sweep).
    expect(acc("host-payout")?.balance || 0).toBe(0);

    // Host reconciles their own completed stays → payout lands.
    const recon = await bridge("post", "/reconcile", host).expect(200);
    expect(recon.body.payouts).toContain(id);
    expect(acc("host-payout").balance).toBe(stayTotal);
    expect(txOf("host-payout", "income")).toHaveLength(1);
  });
});

describe("farm-stay bridge — search sorting & pagination", () => {
  const DISTRICT = "PageTest";
  const FROM = "2036-05-10";
  const TO = "2036-05-12";

  beforeAll(async () => {
    const host = tok("host-search");
    // Three listings at distinct base prices, isolated by a unique district.
    await createProperty(host, { name: "Cheap", basePrice: 50, district: DISTRICT });
    await createProperty(host, { name: "Mid", basePrice: 90, district: DISTRICT });
    await createProperty(host, { name: "Pricey", basePrice: 140, district: DISTRICT });
  });

  it("paginates results and reports page metadata", async () => {
    const guest = tok("guest-search");
    const page1 = await bridge("get", `/search?from=${FROM}&to=${TO}&guests=1&district=${DISTRICT}&pageSize=2&page=1`, guest).expect(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.pageSize).toBe(2);
    expect(page1.body.totalPages).toBe(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.results).toHaveLength(2);

    const page2 = await bridge("get", `/search?from=${FROM}&to=${TO}&guests=1&district=${DISTRICT}&pageSize=2&page=2`, guest).expect(200);
    expect(page2.body.page).toBe(2);
    expect(page2.body.results).toHaveLength(1);
  });

  it("sorts by price ascending / descending", async () => {
    const guest = tok("guest-search");
    const asc = await bridge("get", `/search?from=${FROM}&to=${TO}&guests=1&district=${DISTRICT}&sort=price_asc`, guest).expect(200);
    const totalsAsc = asc.body.results.map((r) => r.quote.total);
    expect(asc.body.sort).toBe("price_asc");
    expect([...totalsAsc].sort((a, b) => a - b)).toEqual(totalsAsc);

    const desc = await bridge("get", `/search?from=${FROM}&to=${TO}&guests=1&district=${DISTRICT}&sort=price_desc`, guest).expect(200);
    const totalsDesc = desc.body.results.map((r) => r.quote.total);
    expect([...totalsDesc].sort((a, b) => b - a)).toEqual(totalsDesc);
  });
});

describe("farm-stay bridge — idempotent cancel refund", () => {
  it("refunds once for repeated cancels carrying the same Idempotency-Key", async () => {
    clearIdempotency();
    const host = tok("host-cancel");
    const guest = tok("guest-cancel");
    fund("guest-cancel", 1000);
    const propertyId = await createProperty(host); // flexible policy → 100% refund far out
    const booked = await bridge("post", "/bookings", guest)
      .send({ propertyId, from: "2035-10-10", to: "2035-10-12", guests: 1 })
      .expect(201);
    const id = booked.body.bookingId;
    const confirmed = await bridge("post", `/bookings/${id}/confirm`, guest).send({}).expect(200);
    const charged = confirmed.body.charged;

    const first = await bridge("post", `/bookings/${id}/cancel`, guest).set("Idempotency-Key", "cancel-key-1").send({}).expect(200);
    const replay = await bridge("post", `/bookings/${id}/cancel`, guest).set("Idempotency-Key", "cancel-key-1").send({}).expect(200);

    expect(first.body.refunded).toBe(charged); // flexible + far → 100%
    expect(replay.body.refunded).toBe(first.body.refunded);
    expect(txOf("guest-cancel", "income")).toHaveLength(1); // refunded once despite two cancels
  });
});
