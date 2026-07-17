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
const { buildReceiptPdf } = require("../../helpers/farm-stay-receipt");
const { logError } = require("../../helpers/logger-api");

const router = express.Router();
const apiLimiter = createRateLimiter("api");

router.use("/farm-stay", requireFeatureFlag("farmStayEnabled", { resourceName: "FarmStay" }), apiLimiter, authenticateSessionUser);

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

/**
 * Per-booking money ledger for the caller, built from their FarmStay financial
 * transactions. A booking's charge is an `expense` tagged with the bookingId;
 * a refund is an `income` with the same reference. Host payouts use a
 * `payout-<id>` reference and are excluded here (they belong to the host, not
 * to a guest purchase). Returns `{ [bookingId]: { charged, refunded } }`.
 */
async function guestLedger(userId) {
  const ledger = {};
  let account;
  try {
    account = await financialService.getAccount(userId);
  } catch {
    return ledger; // financial service unavailable — receipts show booking totals only
  }
  for (const t of account?.transactions || []) {
    const ref = String(t.referenceId || "");
    if (!ref || ref.startsWith("payout-")) continue;
    const entry = (ledger[ref] = ledger[ref] || { charged: 0, refunded: 0 });
    if (t.type === "expense") entry.charged += Number(t.amount) || 0;
    else if (t.type === "income") entry.refunded += Number(t.amount) || 0;
  }
  return ledger;
}

/**
 * Host payout sweep. A confirmed booking reads as "completed" once checkout has
 * passed (lazy, in the reservation service). Each completed booking credits its
 * stay total to the *host's* ROL balance — exactly once — regardless of who is
 * looking at the booking. Because `addTransaction` can credit any user id (not
 * only the caller), a host is paid as soon as the stay completes and ANY party
 * (guest or host) next loads the booking; it no longer waits for the host to
 * open their own list. Bookings are grouped by host so each host account is
 * loaded once per sweep.
 *
 * Idempotency lives here, not in the (money-agnostic) ecosystem: each payout is
 * a financial transaction tagged `referenceId: payout-<bookingId>`, so a booking
 * already carrying that transaction is skipped. Mutates each swept booking with
 * `payout_status: "paid"` so the UI can show it.
 */
async function sweepHostPayouts(bookings) {
  const completed = (bookings || []).filter((b) => b.state === "completed" && b.host_id);
  if (!completed.length) return;

  // Group completed bookings by host so we touch each host account only once.
  const byHost = new Map();
  for (const b of completed) {
    const host = String(b.host_id);
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(b);
  }

  for (const [hostId, hostBookings] of byHost) {
    await ensureAccount(hostId);
    let account;
    try {
      account = await financialService.getAccount(hostId);
    } catch {
      continue; // financial service unavailable for this host — retry on next load
    }
    const paid = new Set(
      (account?.transactions || [])
        .filter((t) => t.type === "income" && String(t.referenceId || "").startsWith("payout-"))
        .map((t) => t.referenceId),
    );
    for (const b of hostBookings) {
      const ref = `payout-${b.id}`;
      if (!paid.has(ref)) {
        const amount = money(b.quote_total || 0);
        if (amount > 0) {
          try {
            await financialService.addTransaction(hostId, {
              type: "income",
              amount,
              description: `FarmStay payout for booking ${b.id}`,
              category: "farmstay",
              referenceId: ref,
            });
            paid.add(ref);
          } catch (err) {
            logError("[farm-stay] host payout failed", err.message);
            continue; // leave unpaid; retried on the next load
          }
        }
      }
      b.payout_status = "paid";
    }
  }
}

// Health (aggregate across the ecosystem).
router.get("/farm-stay/health", (req, res) => proxy(res, farmStay.healthAll()));

// Presentation catalog (types, policies, amenities, photo themes) for the UI.
router.get("/farm-stay/catalog", (req, res) => proxy(res, farmStay.getCatalog(userOf(req))));

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

// Host analytics dashboard (income / occupancy / visitors / per-property).
// The gateway shapes the payload; we pass it through unchanged.
router.get("/farm-stay/hosting/analytics", (req, res) => proxy(res, farmStay.hostingAnalytics(userOf(req))));
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
router.delete("/farm-stay/properties/:id", (req, res) => proxy(res, farmStay.deleteProperty(userOf(req), req.params.id)));
router.post("/farm-stay/properties/:id/blackouts", (req, res) => proxy(res, farmStay.addBlackout(userOf(req), req.params.id, req.body)));
router.delete("/farm-stay/properties/:id/blackouts/:lockId", (req, res) =>
  proxy(res, farmStay.removeBlackout(userOf(req), req.params.id, req.params.lockId)),
);

// Bookings.
router.post("/farm-stay/bookings", (req, res) => proxy(res, farmStay.createBooking(userOf(req), req.body)));

// Listing bookings also runs the host payout sweep (completed stays → ROL income).
router.get("/farm-stay/bookings", async (req, res) => {
  const userId = userOf(req);
  const result = await farmStay.listBookings(userId, { role: req.query.role });
  if (result.status !== 200 || !Array.isArray(result.body?.bookings)) return forward(res, result);
  try {
    await sweepHostPayouts(result.body.bookings);
  } catch (err) {
    logError("[farm-stay] payout sweep error", err.message);
  }
  const balance = await currentBalance(userId);
  res.status(200).json({ ...result.body, balance: balance != null ? money(balance) : null, currency: "ROL" });
});

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

/**
 * Purchase history — the caller's bookings as a guest, enriched with the money
 * actually moved (charged / refunded / net) from Rolnopol's financial ledger.
 * Only bookings that were paid for (or ever confirmed) count as purchases.
 */
router.get("/farm-stay/purchases", async (req, res) => {
  const userId = userOf(req);
  const result = await farmStay.listBookings(userId, { role: "guest" });
  if (result.status !== 200 || !Array.isArray(result.body?.bookings)) return forward(res, result);
  // A guest viewing a completed stay is enough to release the host's payout.
  try {
    await sweepHostPayouts(result.body.bookings);
  } catch (err) {
    logError("[farm-stay] payout sweep error", err.message);
  }
  const ledger = await guestLedger(userId);
  const purchases = result.body.bookings
    .map((b) => {
      const l = ledger[b.id] || { charged: 0, refunded: 0 };
      const charged = money(l.charged);
      const refunded = money(l.refunded);
      return {
        id: b.id,
        propertyId: b.property_id,
        from: b.from,
        to: b.to,
        guests: b.guests,
        state: b.state,
        quoteTotal: money(b.quote_total || 0),
        charged,
        refunded,
        net: money(charged - refunded),
        createdAt: b.created_at || "",
        receiptUrl: `/api/v1/farm-stay/bookings/${encodeURIComponent(b.id)}/receipt.pdf`,
      };
    })
    .filter((p) => p.charged > 0 || ["confirmed", "completed"].includes(p.state))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.status(200).json({ purchases, total: purchases.length, currency: "ROL" });
});

/**
 * Downloadable PDF receipt for one booking. Guest-only (you can only receive a
 * receipt for a stay you paid for). Built server-side, dependency-free.
 */
router.get("/farm-stay/bookings/:id/receipt.pdf", async (req, res) => {
  const userId = userOf(req);
  try {
    const result = await farmStay.getBooking(userId, req.params.id);
    if (result.status !== 200 || !result.body?.booking) return forward(res, result);
    const booking = result.body.booking;
    if (String(booking.guest_id) !== String(userId)) {
      return res.status(403).json({ error: "Only the guest can download this receipt" });
    }
    const ledger = await guestLedger(userId);
    const l = ledger[booking.id] || { charged: 0, refunded: 0 };
    const pdf = buildReceiptPdf({ booking, charged: l.charged, refunded: l.refunded, guest: String(userId) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="farmstay-receipt-${booking.id}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.status(200).end(pdf);
  } catch (err) {
    // Never leave the request hanging on an unexpected failure (PDF build or I/O).
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
});

router.get("/farm-stay/bookings/:id", async (req, res) => {
  const userId = userOf(req);
  const result = await farmStay.getBooking(userId, req.params.id);
  // Viewing a completed booking (as guest or host) releases the host's payout.
  if (result.status === 200 && result.body?.booking) {
    try {
      await sweepHostPayouts([result.body.booking]);
    } catch (err) {
      logError("[farm-stay] payout sweep error", err.message);
    }
  }
  return forward(res, result);
});

module.exports = router;
