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
const { ERROR_CODES, bridgeError, sendBridgeError } = require("../../helpers/farm-stay-errors");
const { withIdempotency } = require("../../modules/farm-stay/idempotency");

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
    sendBridgeError(res, 500, ERROR_CODES.INTERNAL, err.message);
  }
}

// Payment status for a guest's booking, derived from the ROL ledger: a
// confirmed/completed stay with a recorded charge is "paid"; one without is
// "pending" (the charge failed at confirm and awaits reconciliation). Non-money
// states (hold/cancelled/expired) have no payment status.
function paymentStatusOf(booking, ledgerEntry) {
  if (!["confirmed", "completed"].includes(booking.state)) return "";
  return (ledgerEntry?.charged || 0) > 0 ? "paid" : "pending";
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

/**
 * Retry guest charges that never landed. A booking is `confirmed`/`completed` but
 * carries no `expense` in the ROL ledger only when the charge failed after the
 * gateway already flipped the state (the failure window in POST /confirm). This
 * settles those: it re-charges the stay total; if the guest now lacks funds, a
 * still-cancellable (`confirmed`) booking is rolled back, while a `completed` one
 * is left flagged (the stay already happened — it can't be un-held).
 *
 * Idempotent: a booking that already has a charge is skipped, so running the sweep
 * repeatedly never double-charges. Returns a per-booking summary.
 */
async function reconcileGuestCharges(userId, bookings) {
  const ledger = await guestLedger(userId);
  const summary = [];
  for (const b of bookings || []) {
    if (String(b.guest_id) !== String(userId)) continue;
    if (!["confirmed", "completed"].includes(b.state)) continue;
    const entry = ledger[b.id] || { charged: 0, refunded: 0 };
    if (entry.charged > 0) continue; // already paid
    const amount = money(b.quote_total || 0);
    if (amount <= 0) continue;
    await ensureAccount(userId);
    try {
      await financialService.addTransaction(userId, {
        type: "expense",
        amount,
        description: `FarmStay booking ${b.id} (reconciled)`,
        category: "farmstay",
        referenceId: String(b.id),
      });
      summary.push({ bookingId: b.id, status: "charged", charged: amount });
    } catch (err) {
      if (/insufficient/i.test(err.message)) {
        if (b.state === "confirmed") {
          await farmStay.cancelBooking(userId, b.id).catch(() => {});
          summary.push({ bookingId: b.id, status: "cancelled_insufficient_funds" });
        } else {
          summary.push({ bookingId: b.id, status: "unpaid_insufficient_funds" });
        }
      } else {
        logError("[farm-stay] reconcile charge failed", err.message);
        summary.push({ bookingId: b.id, status: "retry_failed" });
      }
    }
  }
  return summary;
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
      sort: req.query.sort,
      page: req.query.page,
      pageSize: req.query.pageSize,
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

// Listing bookings also runs the host payout sweep (completed stays → ROL income)
// and annotates the caller's own (guest) bookings with a payment_status derived
// from the ROL ledger, so the UI can surface a stuck ("pending") charge.
router.get("/farm-stay/bookings", async (req, res) => {
  const userId = userOf(req);
  const result = await farmStay.listBookings(userId, { role: req.query.role });
  if (result.status !== 200 || !Array.isArray(result.body?.bookings)) return forward(res, result);
  try {
    await sweepHostPayouts(result.body.bookings);
  } catch (err) {
    logError("[farm-stay] payout sweep error", err.message);
  }
  const ledger = await guestLedger(userId);
  const bookings = result.body.bookings.map((b) =>
    String(b.guest_id) === String(userId) ? { ...b, payment_status: paymentStatusOf(b, ledger[b.id]) } : b,
  );
  const balance = await currentBalance(userId);
  res.status(200).json({ ...result.body, bookings, balance: balance != null ? money(balance) : null, currency: "ROL" });
});

/**
 * Confirm → charge ROL. Confirm first (the gateway re-quotes and runs the
 * price-change handshake), then debit the final total. If the balance is too
 * low, roll the booking back (cancel → releases the hold) and return 402.
 *
 * Idempotent when the caller sends an `Idempotency-Key` header: a retry with the
 * same key replays the first outcome instead of charging again.
 */
router.post("/farm-stay/bookings/:id/confirm", async (req, res) => {
  const userId = userOf(req);
  const idemKey = req.get("idempotency-key") || "";
  try {
    const { status, body } = await withIdempotency({ namespace: "confirm", user: userId, key: idemKey }, () =>
      doConfirm(userId, req.params.id, req.body),
    );
    res.status(status).json(body);
  } catch (err) {
    sendBridgeError(res, 500, ERROR_CODES.INTERNAL, err.message);
  }
});

/**
 * Core confirm+charge, returning `{ status, body }` so it can be wrapped by the
 * idempotency guard. On a NON-insufficient charge failure the booking stays
 * confirmed but unpaid; we report `charged: 0` + `paymentStatus: "pending"` (the
 * old code wrongly reported the full amount as charged) and leave it for the
 * reconciliation sweep to settle later.
 */
async function doConfirm(userId, bookingId, reqBody) {
  const result = await farmStay.confirmBooking(userId, bookingId, reqBody);
  if (result.status !== 200) return { status: result.status, body: result.body };

  const booking = result.body?.booking || {};
  const amount = money(booking.quote_total || result.body?.quote?.total || 0);
  await ensureAccount(userId);

  let charged = 0;
  let paymentStatus = amount > 0 ? "paid" : "";
  if (amount > 0) {
    try {
      await financialService.addTransaction(userId, {
        type: "expense",
        amount,
        description: `FarmStay booking ${booking.id || bookingId}`,
        category: "farmstay",
        referenceId: String(booking.id || bookingId),
      });
      charged = amount;
    } catch (err) {
      if (/insufficient/i.test(err.message)) {
        // Roll back the confirmation so we never hold a stay we couldn't pay for.
        await farmStay.cancelBooking(userId, bookingId).catch(() => {});
        const balance = await currentBalance(userId);
        return {
          status: 402,
          body: bridgeError(ERROR_CODES.INSUFFICIENT_FUNDS, undefined, {
            needed: amount,
            balance: balance != null ? money(balance) : null,
            currency: "ROL",
          }),
        };
      }
      // Confirmed but not charged — defer to reconciliation.
      logError("[farm-stay] charge failed after confirm", err.message);
      paymentStatus = "pending";
    }
  }
  const balance = await currentBalance(userId);
  return {
    status: 200,
    body: { ...result.body, charged, paymentStatus, balance: balance != null ? money(balance) : null, currency: "ROL" },
  };
}

/**
 * Cancel → refund ROL. Refund refundPct% of what was ACTUALLY paid (read from the
 * ledger, not the quote), so a confirmed-but-unpaid booking — one whose charge is
 * still pending — never refunds money that was never taken.
 *
 * Idempotent via the `Idempotency-Key` header.
 */
router.post("/farm-stay/bookings/:id/cancel", async (req, res) => {
  const userId = userOf(req);
  const idemKey = req.get("idempotency-key") || "";
  try {
    const { status, body } = await withIdempotency({ namespace: "cancel", user: userId, key: idemKey }, () =>
      doCancel(userId, req.params.id),
    );
    res.status(status).json(body);
  } catch (err) {
    sendBridgeError(res, 500, ERROR_CODES.INTERNAL, err.message);
  }
});

async function doCancel(userId, bookingId) {
  const before = await farmStay.getBooking(userId, bookingId);
  const prior = before.body?.booking || {};
  const wasConfirmed = prior.state === "confirmed";

  const result = await farmStay.cancelBooking(userId, bookingId);
  if (result.status !== 200) return { status: result.status, body: result.body };

  // Refund base = what the guest has actually paid net of prior refunds.
  const ledger = await guestLedger(userId);
  const entry = ledger[bookingId] || { charged: 0, refunded: 0 };
  const netPaid = money(entry.charged - entry.refunded);

  let refunded = 0;
  const refundPct = result.body?.refundPct || 0;
  if (wasConfirmed && refundPct > 0 && netPaid > 0) {
    refunded = money((netPaid * refundPct) / 100);
    try {
      await financialService.addTransaction(userId, {
        type: "income",
        amount: refunded,
        description: `FarmStay refund ${bookingId} (${refundPct}%)`,
        category: "farmstay",
        referenceId: String(bookingId),
      });
    } catch (err) {
      logError("[farm-stay] refund failed", err.message);
      refunded = 0;
    }
  }
  const balance = await currentBalance(userId);
  return {
    status: 200,
    body: { ...result.body, refunded, balance: balance != null ? money(balance) : null, currency: "ROL" },
  };
}

/**
 * Reconciliation sweep for the authenticated user — settles money that the
 * read-triggered paths would otherwise only fix when a booking happens to be
 * viewed. Retries the caller's stuck guest charges (the confirm failure window)
 * AND releases host payouts for their completed stays. Safe to call repeatedly
 * (both operations are idempotent) and safe to wire to a scheduler.
 */
router.post("/farm-stay/reconcile", async (req, res) => {
  const userId = userOf(req);
  try {
    const [guestRes, hostRes] = await Promise.all([
      farmStay.listBookings(userId, { role: "guest" }),
      farmStay.listBookings(userId, { role: "host" }),
    ]);
    const guestBookings = Array.isArray(guestRes.body?.bookings) ? guestRes.body.bookings : [];
    const hostBookings = Array.isArray(hostRes.body?.bookings) ? hostRes.body.bookings : [];

    const charges = await reconcileGuestCharges(userId, guestBookings);
    await sweepHostPayouts(hostBookings);
    const payouts = hostBookings.filter((b) => b.payout_status === "paid").map((b) => b.id);

    const balance = await currentBalance(userId);
    res.status(200).json({ charges, payouts, balance: balance != null ? money(balance) : null, currency: "ROL" });
  } catch (err) {
    sendBridgeError(res, 500, ERROR_CODES.INTERNAL, err.message);
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
        paymentStatus: paymentStatusOf(b, l),
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
      return sendBridgeError(res, 403, ERROR_CODES.FORBIDDEN, "Only the guest can download this receipt");
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
    sendBridgeError(res, 500, ERROR_CODES.INTERNAL, err.message);
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
