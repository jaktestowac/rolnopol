/**
 * FarmStay thin gateway — standalone REST process (:4310).
 * Start with:  npm run farmstay:gateway
 *
 * Owns NO data. Forwards identity (x-stay-user), orchestrates the four leaves,
 * shapes responses, maps errors, and exposes aggregate health. All domain state
 * lives in the leaf services.
 */
const express = require("express");
const { HOST, PORT, HOLD_TTL_SEC, HEALTH_TIMEOUT_MS } = require("../config");
const inventory = require("../clients/inventory-client");
const reservation = require("../clients/reservation-client");
const pricing = require("../clients/pricing-client");
const reviews = require("../clients/review-client");
const catalogMeta = require("../config/catalog-meta");
const { sendError, grpcPreconditionToken } = require("./errors");
const { createLogger } = require("../../shared/logger");
const { nightsBetween, eachNight } = require("../../shared/dates");

const log = createLogger("gateway");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

// ── helpers ───────────────────────────────────────────────────────────────────

const userOf = (req) => req.get("x-stay-user") || "";

/** Fetch a single property via ListProperties (inventory has no GetProperty). */
async function getProperty(userId, id) {
  const { properties } = await inventory.listProperties(userId, "");
  return (properties || []).find((p) => p.id === id) || null;
}

/**
 * Best-effort quote for BROWSING (search / property details): any pricing
 * failure — service down, timeout, or an error response — degrades to a null
 * quote so the listing still renders, just without a price. Booking never uses
 * this path: POST /v1/bookings calls pricing.quote directly and refuses (503)
 * when it fails, so a stay is never committed without a firm price.
 */
async function quoteBestEffort(property, from, to, guests) {
  try {
    const q = await pricing.quote({ propertyId: property.id, basePrice: property.base_price, from, to, guests });
    return { quote: q, quoteStatus: "ok" };
  } catch {
    return { quote: null, quoteStatus: "unavailable" };
  }
}

/** Best-effort batch scores; null when review-desk is unavailable. */
async function scoresBestEffort(propertyIds) {
  try {
    const { scores } = await reviews.scores(propertyIds);
    const byId = {};
    for (const s of scores || []) byId[s.propertyId] = s;
    return byId;
  } catch {
    return null;
  }
}

/**
 * Self-heal a booking whose lock release is still pending (cancel succeeded but
 * inventory.Release failed earlier). Idempotent; best-effort.
 */
async function healPendingRelease(userId, booking) {
  if (booking.release_status !== "pending" || !booking.lock_id) return booking;
  try {
    await inventory.release(userId, booking.lock_id);
    const updated = await reservation.markReleaseDone(userId, booking.id);
    log.info("healed pending release", { booking: booking.id });
    return updated;
  } catch {
    return booking; // still pending; will retry on the next access
  }
}

// States that represent real, revenue-bearing occupancy (money the host keeps
// or will keep). Cancelled/expired holds never occupied the calendar.
const INCOME_STATES = ["confirmed", "completed"];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Shape a host's raw listings + bookings (+ optional review scores) into a
 * dashboard-ready analytics payload. Pure function — no I/O — so it is unit
 * testable and keeps the gateway a thin shaper (it owns no data, just merges
 * what the leaves already returned). Income is the booking `quote_total`; a
 * booked "night" is one day of a half-open [from, to) stay.
 */
function buildHostingAnalytics({ properties = [], bookings = [], scoresById = {} }) {
  const income = bookings.filter((b) => INCOME_STATES.includes(b.state));

  // ── Totals ──────────────────────────────────────────────────────────────
  const grossIncome = income.reduce((s, b) => s + (b.quote_total || 0), 0);
  const paidOut = income.filter((b) => b.state === "completed").reduce((s, b) => s + (b.quote_total || 0), 0);
  const upcoming = income.filter((b) => b.state === "confirmed").reduce((s, b) => s + (b.quote_total || 0), 0);
  const nightsBooked = income.reduce((s, b) => s + nightsBetween(b.from, b.to), 0);
  const guestNights = income.reduce((s, b) => s + nightsBetween(b.from, b.to) * (b.guests || 1), 0);
  const distinctVisitors = new Set(income.map((b) => b.guest_id)).size;

  const reviewsCount = Object.values(scoresById).reduce((s, x) => s + (x.count || 0), 0);
  const ratingWeighted = Object.values(scoresById).reduce((s, x) => s + (x.avgRating || 0) * (x.count || 0), 0);
  const avgRating = reviewsCount ? round2(ratingWeighted / reviewsCount) : 0;

  // ── State distribution (all bookings, not just income-bearing) ───────────
  const stateDistribution = {};
  for (const b of bookings) stateDistribution[b.state] = (stateDistribution[b.state] || 0) + 1;

  // ── Income by month (bucketed on check-in) ───────────────────────────────
  const monthMap = {};
  for (const b of income) {
    const key = b.from.slice(0, 7); // YYYY-MM
    const m = (monthMap[key] = monthMap[key] || { month: key, income: 0, nights: 0, bookings: 0, visitors: new Set() });
    m.income += b.quote_total || 0;
    m.nights += nightsBetween(b.from, b.to);
    m.bookings += 1;
    m.visitors.add(b.guest_id);
  }
  const incomeByMonth = Object.values(monthMap)
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => ({ month: m.month, income: round2(m.income), nights: m.nights, bookings: m.bookings, visitors: m.visitors.size }));

  // ── Occupancy (booked nights) by year ────────────────────────────────────
  const yearMap = {};
  for (const b of income) {
    for (const night of eachNight(b.from, b.to)) {
      const y = night.slice(0, 4);
      const yr = (yearMap[y] = yearMap[y] || { year: y, nights: 0, guestNights: 0 });
      yr.nights += 1;
      yr.guestNights += b.guests || 1;
    }
  }
  const occupancyByYear = Object.values(yearMap).sort((a, b) => (a.year < b.year ? -1 : 1));

  // ── Per-property breakdown ────────────────────────────────────────────────
  const propMeta = {};
  for (const p of properties) propMeta[p.id] = p;
  const propMap = {};
  const ensureProp = (id) =>
    (propMap[id] = propMap[id] || {
      propertyId: id,
      name: propMeta[id]?.name || id,
      type: propMeta[id]?.type || "",
      capacity: propMeta[id]?.capacity || 0,
      basePrice: propMeta[id]?.base_price || 0,
      removed: !propMeta[id],
      income: 0,
      nights: 0,
      bookings: 0,
      visitors: new Set(),
    });
  // Seed every current listing so idle ones still appear at zero.
  for (const p of properties) ensureProp(p.id);
  for (const b of income) {
    const p = ensureProp(b.property_id);
    p.income += b.quote_total || 0;
    p.nights += nightsBetween(b.from, b.to);
    p.bookings += 1;
    p.visitors.add(b.guest_id);
  }
  const perProperty = Object.values(propMap)
    .map((p) => {
      const score = scoresById[p.propertyId] || { avgRating: 0, count: 0 };
      return {
        propertyId: p.propertyId,
        name: p.name,
        type: p.type,
        capacity: p.capacity,
        removed: p.removed,
        income: round2(p.income),
        nights: p.nights,
        bookings: p.bookings,
        visitors: p.visitors.size,
        avgRating: score.avgRating || 0,
        reviews: score.count || 0,
      };
    })
    .sort((a, b) => b.income - a.income);

  return {
    totals: {
      grossIncome: round2(grossIncome),
      paidOut: round2(paidOut),
      upcoming: round2(upcoming),
      listings: properties.length,
      activeBookings: bookings.filter((b) => ["hold", "confirmed", "completed"].includes(b.state)).length,
      totalBookings: bookings.length,
      nightsBooked,
      guestNights,
      distinctVisitors,
      avgRating,
      reviews: reviewsCount,
    },
    incomeByMonth,
    occupancyByYear,
    perProperty,
    stateDistribution,
    currency: "ROL",
  };
}

// ── app ─────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  // Self health (no downstream).
  app.get("/health", (req, res) => {
    res.json({ status: "SERVING", version: SERVICE_VERSION, uptime_ms: Date.now() - startedAt, stateless: true });
  });

  // Aggregate health across all five.
  app.get("/health/all", async (req, res) => {
    const services = [
      { name: "stay-gateway", status: "SERVING", version: SERVICE_VERSION, uptimeMs: Date.now() - startedAt, target: `:${PORT}` },
    ];
    const probes = [
      { name: "inventory", target: inventory.target, fn: () => inventory.health() },
      { name: "pricing", target: pricing.url, fn: () => pricing.health() },
      { name: "reservation", target: reservation.target, fn: () => reservation.health() },
      { name: "review-desk", target: reviews.url, fn: () => reviews.health() },
    ];
    const results = await Promise.all(
      probes.map(async (p) => {
        try {
          const reply = await p.fn();
          return { name: p.name, status: "SERVING", version: reply.version || "", uptimeMs: reply.uptime_ms || 0, target: p.target };
        } catch {
          return { name: p.name, status: "UNREACHABLE", version: "", uptimeMs: 0, target: p.target };
        }
      }),
    );
    services.push(...results);
    const down = results.filter((s) => s.status !== "SERVING").length;
    const overall = down === 0 ? "SERVING" : down === results.length ? "DOWN" : "DEGRADED";
    res.status(overall === "SERVING" ? 200 : 503).json({ overall, services });
  });

  // Identity required for everything below.
  app.use("/v1", (req, res, next) => {
    if (!userOf(req)) return res.status(401).json({ error: "Missing x-stay-user identity" });
    next();
  });

  // Presentation catalog — option lists + icons/gradients for the UI. Static.
  app.get("/v1/catalog", (req, res) => res.json(catalogMeta));

  // ── Host: listings ──────────────────────────────────────────────────────────

  app.post("/v1/properties", async (req, res) => {
    const user = userOf(req);
    try {
      const p = await inventory.createProperty(user, { hostId: user, ...(req.body || {}) });
      res.status(201).json(p);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/v1/properties/:id", async (req, res) => {
    const user = userOf(req);
    try {
      const p = await inventory.updateProperty(user, req.params.id, user, req.body || {});
      res.json(p);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/v1/properties/:id", async (req, res) => {
    const user = userOf(req);
    try {
      const result = await inventory.deleteProperty(user, req.params.id, user);
      res.json({ id: result.id, deleted: result.deleted });
    } catch (err) {
      // Refuse to delete a listing with active/upcoming bookings.
      if (grpcPreconditionToken(err) === "OCCUPIED") {
        return res.status(409).json({ error: "OCCUPIED", detail: "Listing has active or upcoming bookings" });
      }
      sendError(res, err);
    }
  });

  app.get("/v1/properties/mine", async (req, res) => {
    const user = userOf(req);
    try {
      const { properties, total } = await inventory.listProperties(user, user);
      res.json({ properties, total });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Host analytics dashboard — aggregate of the host's listings + bookings
  // (+ review scores, best-effort). Pure shaping over what the leaves return;
  // the gateway stores nothing. Refuses (503) only if a data owner is down.
  app.get("/v1/hosting/analytics", async (req, res) => {
    const user = userOf(req);
    try {
      const [propsReply, bookingsReply] = await Promise.all([inventory.listProperties(user, user), reservation.listBookings(user, "host")]);
      const properties = propsReply.properties || [];
      const bookings = bookingsReply.bookings || [];
      const scoresById = (await scoresBestEffort(properties.map((p) => p.id))) || {};
      res.json(buildHostingAnalytics({ properties, bookings, scoresById }));
    } catch (err) {
      sendError(res, err); // inventory or reservation down → 503
    }
  });

  app.post("/v1/properties/:id/blackouts", async (req, res) => {
    const user = userOf(req);
    const { from, to } = req.body || {};
    try {
      const r = await inventory.hold(user, { propertyId: req.params.id, from, to, kind: "blackout", hostId: user });
      res.status(201).json({ lockId: r.lock_id });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/v1/properties/:id/blackouts/:lockId", async (req, res) => {
    const user = userOf(req);
    try {
      await inventory.release(user, req.params.lockId);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Guest: search + details ───────────────────────────────────────────────────

  app.get("/v1/search", async (req, res) => {
    const user = userOf(req);
    const { from, to } = req.query;
    const guests = Number(req.query.guests) || 1;
    try {
      // Own listings are included (excludeHostId omitted) so hosts can see how
      // their stays appear in "All stays"; each result is tagged with isOwn so
      // the UI can mark them and disable booking (booking own property is 409'd).
      const { properties } = await inventory.search(user, {
        from,
        to,
        guests,
        district: req.query.district,
        type: req.query.type,
        maxPrice: Number(req.query.maxPrice) || 0,
      });
      const scores = await scoresBestEffort(properties.map((p) => p.id));
      const results = await Promise.all(
        properties.map(async (p) => {
          const { quote, quoteStatus } = await quoteBestEffort(p, from, to, guests);
          return {
            ...p,
            quote,
            quoteStatus,
            isOwn: p.host_id === user,
            score: scores ? scores[p.id] || { avgRating: 0, count: 0 } : null,
          };
        }),
      );
      res.json({ results, total: results.length, scoreStatus: scores ? "ok" : "unavailable" });
    } catch (err) {
      sendError(res, err); // inventory down → 503 (catalog lives there)
    }
  });

  app.get("/v1/properties/:id", async (req, res) => {
    const user = userOf(req);
    const { from, to } = req.query;
    try {
      const property = await getProperty(user, req.params.id);
      if (!property) return res.status(404).json({ error: "Property not found" });

      const out = { property };
      if (from && to) {
        const { quote, quoteStatus } = await quoteBestEffort(property, from, to, Number(req.query.guests) || 1);
        out.quote = quote;
        out.quoteStatus = quoteStatus;
        try {
          out.calendar = await inventory.getCalendar(user, property.id, from, to);
        } catch {
          out.calendar = null;
        }
      }
      try {
        out.reviews = await reviews.listReviews(property.id, 1);
      } catch {
        out.reviews = { status: "unavailable" };
      }
      res.json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Guest: bookings ───────────────────────────────────────────────────────────

  app.post("/v1/bookings", async (req, res) => {
    const user = userOf(req);
    const { propertyId, from, to, guests } = req.body || {};
    try {
      const property = await getProperty(user, propertyId);
      if (!property) return res.status(404).json({ error: "Property not found" });
      if (property.host_id === user) return res.status(409).json({ error: "You cannot book your own property" });
      if ((property.capacity || 0) < (guests || 1)) return res.status(400).json({ error: "Guests exceed capacity" });

      // 1) atomic hold
      let hold;
      try {
        hold = await inventory.hold(user, { propertyId, from, to, ttlSec: HOLD_TTL_SEC });
      } catch (err) {
        if (grpcPreconditionToken(err) === "RANGE_UNAVAILABLE") {
          return res.status(409).json({ error: "RANGE_UNAVAILABLE" });
        }
        return sendError(res, err);
      }

      // 2) firm quote (release the hold if pricing is unavailable so it doesn't linger)
      let quote;
      try {
        quote = await pricing.quote({ propertyId, basePrice: property.base_price, from, to, guests });
      } catch (err) {
        await inventory.release(user, hold.lock_id).catch(() => {});
        return sendError(res, err);
      }

      // 3) persist the booking as a hold
      let booking;
      try {
        booking = await reservation.createBooking(user, {
          guestId: user,
          propertyId,
          hostId: property.host_id,
          from,
          to,
          guests: guests || 1,
          lockId: hold.lock_id,
          quoteTotal: quote.total,
          holdExpiresAt: hold.expires_at,
          policy: property.policy,
        });
      } catch (err) {
        await inventory.release(user, hold.lock_id).catch(() => {});
        return sendError(res, err);
      }

      res.status(201).json({ bookingId: booking.id, state: booking.state, holdExpiresAt: booking.hold_expires_at, quote });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/v1/bookings/:id/confirm", async (req, res) => {
    const user = userOf(req);
    const acceptQuote = req.body?.acceptQuote;
    try {
      const booking = await reservation.getBooking(user, req.params.id);
      if (booking.state === "expired") return res.status(410).json({ error: "HOLD_EXPIRED" });
      if (booking.state !== "hold") return res.status(409).json({ error: `Cannot confirm a ${booking.state} booking` });

      const property = await getProperty(user, booking.property_id);
      if (!property) return res.status(404).json({ error: "Property not found" });

      // Re-quote and run the price-change handshake in the gateway.
      let current;
      try {
        current = await pricing.quote({
          propertyId: property.id,
          basePrice: property.base_price,
          from: booking.from,
          to: booking.to,
          guests: booking.guests,
        });
      } catch (err) {
        return sendError(res, err); // pricing down → 503; hold still alive
      }
      const held = booking.quote_total;
      const changed = Math.abs(current.total - held) > 0.001;
      if (changed) {
        const accepts = acceptQuote != null && Math.abs(Number(acceptQuote) - current.total) <= 0.001;
        if (!accepts) {
          return res.status(409).json({ error: "PRICE_CHANGED", heldQuote: held, currentQuote: current.total });
        }
      }

      // Make the lock permanent first (idempotent), then flip the booking.
      try {
        await inventory.confirmHold(user, booking.lock_id);
      } catch (err) {
        // NOT_FOUND here means the hold expired at inventory.
        if (err.code === require("@grpc/grpc-js").status.NOT_FOUND) return res.status(410).json({ error: "HOLD_EXPIRED" });
        return sendError(res, err);
      }
      const confirmed = await reservation.confirmBooking(user, booking.id, current.total);
      res.json({ booking: confirmed, quote: current });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/v1/bookings/:id/cancel", async (req, res) => {
    const user = userOf(req);
    try {
      const result = await reservation.cancelBooking(user, req.params.id);
      let booking = result.booking;
      // Release the lock; if it fails, releaseStatus stays "pending" and heals later.
      try {
        await inventory.release(user, result.lock_id);
        booking = await reservation.markReleaseDone(user, booking.id);
      } catch {
        log.warn("release after cancel failed — will heal on next access", { booking: booking.id });
      }
      res.json({ booking, refundPct: result.refund_pct });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/bookings", async (req, res) => {
    const user = userOf(req);
    try {
      const { bookings } = await reservation.listBookings(user, req.query.role || "any");
      const healed = await Promise.all(bookings.map((b) => healPendingRelease(user, b)));
      res.json({ bookings: healed, total: healed.length });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/bookings/:id", async (req, res) => {
    const user = userOf(req);
    try {
      let booking = await reservation.getBooking(user, req.params.id);
      booking = await healPendingRelease(user, booking);
      res.json({ booking });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Reviews ───────────────────────────────────────────────────────────────────

  app.post("/v1/bookings/:id/review", async (req, res) => {
    const user = userOf(req);
    try {
      const booking = await reservation.getBooking(user, req.params.id);
      if (booking.guest_id !== user) return res.status(403).json({ error: "Only the guest can review this stay" });
      if (booking.state !== "completed")
        return res.status(409).json({ error: "NOT_COMPLETED", detail: "You can review only after the stay is completed" });
      const review = await reviews.submitReview({
        propertyId: booking.property_id,
        bookingId: booking.id,
        author: user,
        rating: req.body?.rating,
        text: req.body?.text,
      });
      res.status(201).json(review);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/properties/:id/reviews", async (req, res) => {
    try {
      const data = await reviews.listReviews(req.params.id, Number(req.query.page) || 1);
      res.json(data);
    } catch (err) {
      sendError(res, err);
    }
  });

  return app;
}

function start() {
  const app = buildApp();
  const server = app.listen(PORT, HOST, () => {
    log.info("listening", { codename: "stay-gateway", host: HOST, port: server.address().port });
  });
  const shutdown = (signal) => {
    log.info("shutting down", { signal });
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}

if (require.main === module) start();

module.exports = { buildApp, start, buildHostingAnalytics };
