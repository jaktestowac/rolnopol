/**
 * FarmStay REST companion routes.
 *
 * Thin proxy: feature-flag gate → rate limit → session auth (logged-in users
 * only) → HTTP call to the standalone FarmStay gateway → passthrough. The app
 * never touches FarmStay data directly; it dials ONLY the gateway, which
 * orchestrates the five-service ecosystem.
 *
 * MONEY lives in Rolnopol, not in the (independent) ecosystem — so payment is
 * handled HERE in the bridge against Rolnopol's financial service (ROL):
 *   - confirming a booking charges the quote total as an expense (blocked when
 *     the balance is too low; the just-confirmed booking is rolled back);
 *   - cancelling a *confirmed* booking refunds refundPct% of what was paid.
 *
 * Mounted under /api/v1 (see routes/v1/index.js).
 */
const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { client: farmStay } = require("../../modules/farm-stay");
const financialService = require("../../services/financial.service");
const { logError } = require("../../helpers/logger-api");

const router = express.Router();
const apiLimiter = createRateLimiter("api");

router.use(
  "/farm-stay",
  requireFeatureFlag("farmStayEnabled", { resourceName: "FarmStay" }),
  apiLimiter,
  authenticateSessionUser,
);

const userOf = (req) => req.user?.userId;
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Forward the gateway's { status, body } to the HTTP response verbatim.
function forward(res, result) {
  return res.status(result.status).json(result.body);
}
async function proxy(res, promise) {
  try {
    forward(res, await promise);
  } catch (err) {
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
}

// Ensure the caller has a financial account (created lazily for older users).
async function ensureAccount(userId) {
  try {
    const acc = await financialService.getAccount(userId);
    if (acc) return acc;
  } catch {
    /* fall through to init */
  }
  try {
    return await financialService.initializeAccount(userId);
  } catch {
    return null;
  }
}

async function currentBalance(userId) {
  try {
    const acc = await financialService.getAccount(userId);
    return acc ? acc.balance : null;
  } catch {
    return null;
  }
}

// Health (aggregate across the ecosystem).
router.get("/farm-stay/health", (req, res) => proxy(res, farmStay.healthAll()));

// Balance passthrough so the page can show finite ROL without a second service.
router.get("/farm-stay/balance", async (req, res) => {
  await ensureAccount(userOf(req));
  const balance = await currentBalance(userOf(req));
  res.json({ balance, currency: "ROL" });
});

// Search + property details.
router.get("/farm-stay/search", (req, res) =>
  proxy(
    res,
    farmStay.search(userOf(req), {
      from: req.query.from,
      to: req.query.to,
      guests: req.query.guests,
      district: req.query.district,
      type: req.query.type,
      maxPrice: req.query.maxPrice,
    }),
  ),
);
router.get("/farm-stay/properties/mine", (req, res) => proxy(res, farmStay.listMine(userOf(req))));
router.get("/farm-stay/properties/:id/reviews", (req, res) =>
  proxy(res, farmStay.listReviews(userOf(req), req.params.id, { page: req.query.page })),
);
router.get("/farm-stay/properties/:id", (req, res) =>
  proxy(
    res,
    farmStay.getProperty(userOf(req), req.params.id, {
      from: req.query.from,
      to: req.query.to,
      guests: req.query.guests,
    }),
  ),
);
router.post("/farm-stay/properties", (req, res) => proxy(res, farmStay.createProperty(userOf(req), req.body)));
router.patch("/farm-stay/properties/:id", (req, res) => proxy(res, farmStay.updateProperty(userOf(req), req.params.id, req.body)));
router.post("/farm-stay/properties/:id/blackouts", (req, res) => proxy(res, farmStay.addBlackout(userOf(req), req.params.id, req.body)));
router.delete("/farm-stay/properties/:id/blackouts/:lockId", (req, res) =>
  proxy(res, farmStay.removeBlackout(userOf(req), req.params.id, req.params.lockId)),
);

// Bookings.
router.post("/farm-stay/bookings", (req, res) => proxy(res, farmStay.createBooking(userOf(req), req.body)));
router.get("/farm-stay/bookings", (req, res) => proxy(res, farmStay.listBookings(userOf(req), { role: req.query.role })));

/**
 * Confirm → charge ROL. Confirm first (the gateway re-quotes and runs the
 * price-change handshake), then debit the final total. If the balance is too
 * low, roll the booking back (cancel → releases the hold) and return 402.
 */
router.post("/farm-stay/bookings/:id/confirm", async (req, res) => {
  const userId = userOf(req);
  try {
    const result = await farmStay.confirmBooking(userId, req.params.id, req.body);
    if (result.status !== 200) return forward(res, result);

    const booking = result.body?.booking || {};
    const amount = money(booking.quote_total || result.body?.quote?.total || 0);
    await ensureAccount(userId);

    if (amount > 0) {
      try {
        await financialService.addTransaction(userId, {
          type: "expense",
          amount,
          description: `FarmStay booking ${booking.id || req.params.id}`,
          category: "farmstay",
          referenceId: String(booking.id || req.params.id),
        });
      } catch (err) {
        if (/insufficient/i.test(err.message)) {
          // Roll back the confirmation so we never hold a stay we couldn't pay for.
          await farmStay.cancelBooking(userId, req.params.id).catch(() => {});
          const balance = await currentBalance(userId);
          return res.status(402).json({ error: "INSUFFICIENT_FUNDS", needed: amount, balance, currency: "ROL" });
        }
        logError("[farm-stay] charge failed after confirm", err.message);
      }
    }
    const balance = await currentBalance(userId);
    return res.status(200).json({ ...result.body, charged: amount, balance: balance != null ? money(balance) : null, currency: "ROL" });
  } catch (err) {
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
});

/**
 * Cancel → refund ROL. If the booking was confirmed (already paid), refund
 * refundPct% of what was paid as income.
 */
router.post("/farm-stay/bookings/:id/cancel", async (req, res) => {
  const userId = userOf(req);
  try {
    const before = await farmStay.getBooking(userId, req.params.id);
    const prior = before.body?.booking || {};
    const wasPaid = prior.state === "confirmed";
    const paidTotal = money(prior.quote_total || 0);

    const result = await farmStay.cancelBooking(userId, req.params.id);
    if (result.status !== 200) return forward(res, result);

    let refunded = 0;
    const refundPct = result.body?.refundPct || 0;
    if (wasPaid && refundPct > 0 && paidTotal > 0) {
      refunded = money((paidTotal * refundPct) / 100);
      try {
        await financialService.addTransaction(userId, {
          type: "income",
          amount: refunded,
          description: `FarmStay refund ${req.params.id} (${refundPct}%)`,
          category: "farmstay",
          referenceId: String(req.params.id),
        });
      } catch (err) {
        logError("[farm-stay] refund failed", err.message);
        refunded = 0;
      }
    }
    const balance = await currentBalance(userId);
    return res.status(200).json({ ...result.body, refunded, balance: balance != null ? money(balance) : null, currency: "ROL" });
  } catch (err) {
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
});

router.post("/farm-stay/bookings/:id/review", (req, res) => proxy(res, farmStay.reviewBooking(userOf(req), req.params.id, req.body)));
router.get("/farm-stay/bookings/:id", (req, res) => proxy(res, farmStay.getBooking(userOf(req), req.params.id)));

module.exports = router;
