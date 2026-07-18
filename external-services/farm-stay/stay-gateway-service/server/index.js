/**
 * FarmStay thin gateway — standalone REST process (:4310).
 * Start with:  npm run farmstay:gateway
 *
 * Owns NO data. Forwards identity (x-stay-user), orchestrates the four leaves,
 * shapes responses, maps errors, and exposes aggregate health. All domain state
 * lives in the leaf services.
 */
const express = require("express");
const { HOST, PORT, HOLD_TTL_SEC, HEALTH_TIMEOUT_MS, ADMIN_USERS, PLATFORM_FEE_PCT } = require("../config");
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

// Platform analytics is admin-gated. An empty allowlist (the dev default) leaves
// it open so the hidden dashboard works locally; set FARM_STAY_ADMIN_USERS to
// restrict it. This mirrors the ecosystem's header-only trust model — the bridge
// does the real auth, this is a second, config-driven fence.
const isAdmin = (userId) => ADMIN_USERS.length === 0 || ADMIN_USERS.includes(String(userId));

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
 * Per-day occupancy for a set of revenue-bearing bookings — the data behind the
 * GitHub-style heatmap. `bookings` counts how many stays occupied each night
 * (overlapping stays stack); `guests` sums their headcount. Sparse: only days
 * with at least one booked night appear. Also returns the single busiest day.
 */
function buildDayOccupancy(income) {
  const dayMap = {};
  for (const b of income) {
    for (const night of eachNight(b.from, b.to)) {
      const d = (dayMap[night] = dayMap[night] || { date: night, bookings: 0, guests: 0 });
      d.bookings += 1;
      d.guests += b.guests || 1;
    }
  }
  const occupancyByDay = Object.values(dayMap).sort((a, b) => (a.date < b.date ? -1 : 1));
  const peakDay = occupancyByDay.reduce((best, d) => (best && best.bookings >= d.bookings ? best : d), null);
  return { occupancyByDay, peakDay };
}

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
  const { occupancyByDay, peakDay } = buildDayOccupancy(income);

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
    occupancyByDay,
    peakDay,
    perProperty,
    stateDistribution,
    currency: "ROL",
  };
}

/**
 * Shape a single guest's bookings (+ the property catalog, for region/type
 * labels) into a "your travel" summary — the guest-facing counterpart to
 * buildHostingAnalytics. Pure function, no I/O. Only real trips (confirmed +
 * completed) count toward nights/spend; `spend` here is the booking quote total,
 * which the bridge overlays with what the guest was ACTUALLY charged (money
 * lives in Rolnopol, not the ecosystem).
 */
function buildGuestTravelSummary({ bookings = [], properties = [] }) {
  const propMeta = {};
  for (const p of properties) propMeta[p.id] = p;
  const regionOf = (b) => propMeta[b.property_id]?.district || "Unknown";
  const typeOf = (b) => propMeta[b.property_id]?.type || "other";

  const trips = bookings.filter((b) => INCOME_STATES.includes(b.state));

  const nights = trips.reduce((s, b) => s + nightsBetween(b.from, b.to), 0);
  const guestNights = trips.reduce((s, b) => s + nightsBetween(b.from, b.to) * (b.guests || 1), 0);
  const spend = trips.reduce((s, b) => s + (b.quote_total || 0), 0);
  const completed = trips.filter((b) => b.state === "completed");
  const upcoming = trips.filter((b) => b.state === "confirmed");

  // ── By region (property district) ─────────────────────────────────────────
  const regionMap = {};
  for (const b of trips) {
    const region = regionOf(b);
    const r = (regionMap[region] = regionMap[region] || { region, trips: 0, nights: 0, spend: 0 });
    r.trips += 1;
    r.nights += nightsBetween(b.from, b.to);
    r.spend += b.quote_total || 0;
  }
  const byRegion = Object.values(regionMap)
    .map((r) => ({ ...r, spend: round2(r.spend) }))
    .sort((a, b) => b.nights - a.nights || b.spend - a.spend);

  // ── By stay type ──────────────────────────────────────────────────────────
  const typeMap = {};
  for (const b of trips) {
    const type = typeOf(b);
    const t = (typeMap[type] = typeMap[type] || { type, trips: 0, nights: 0 });
    t.trips += 1;
    t.nights += nightsBetween(b.from, b.to);
  }
  const byType = Object.values(typeMap).sort((a, b) => b.nights - a.nights);

  // ── By month (bucketed on check-in) ───────────────────────────────────────
  const monthMap = {};
  for (const b of trips) {
    const key = b.from.slice(0, 7);
    const m = (monthMap[key] = monthMap[key] || { month: key, trips: 0, nights: 0, spend: 0 });
    m.trips += 1;
    m.nights += nightsBetween(b.from, b.to);
    m.spend += b.quote_total || 0;
  }
  const byMonth = Object.values(monthMap)
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => ({ ...m, spend: round2(m.spend) }));

  const stateDistribution = {};
  for (const b of bookings) stateDistribution[b.state] = (stateDistribution[b.state] || 0) + 1;

  const { occupancyByDay, peakDay } = buildDayOccupancy(trips);

  return {
    totals: {
      trips: trips.length,
      completed: completed.length,
      upcoming: upcoming.length,
      nights,
      guestNights,
      spend: round2(spend),
      distinctProperties: new Set(trips.map((b) => b.property_id)).size,
      distinctRegions: byRegion.length,
    },
    favouriteRegion: byRegion[0]?.region || "",
    byRegion,
    byType,
    byMonth,
    occupancyByDay,
    peakDay,
    stateDistribution,
    currency: "ROL",
  };
}

/**
 * Shape the ENTIRE ecosystem (all listings, all bookings, all review scores)
 * into a platform/admin dashboard: GMV, guest headcount, occupancy, and per
 * host/district/type breakdowns. Same pure-shaper discipline as the host and
 * guest views — the gateway owns no data, it just merges what the leaves return.
 * GMV is the sum of income-bearing booking totals (confirmed + completed); the
 * take-rate is an ESTIMATE against `feePct` (no real fee moves — IMPROVEMENTS #9).
 */
function buildPlatformAnalytics({ properties = [], bookings = [], scoresById = {}, feePct = PLATFORM_FEE_PCT }) {
  const propMeta = {};
  for (const p of properties) propMeta[p.id] = p;
  const districtOf = (b) => propMeta[b.property_id]?.district || "Unknown";
  const typeOf = (b) => propMeta[b.property_id]?.type || "other";
  const hostOf = (b) => b.host_id || propMeta[b.property_id]?.host_id || "unknown";

  const income = bookings.filter((b) => INCOME_STATES.includes(b.state));

  const gmv = income.reduce((s, b) => s + (b.quote_total || 0), 0);
  const completedRevenue = income.filter((b) => b.state === "completed").reduce((s, b) => s + (b.quote_total || 0), 0);
  const upcomingRevenue = income.filter((b) => b.state === "confirmed").reduce((s, b) => s + (b.quote_total || 0), 0);
  const nightsBooked = income.reduce((s, b) => s + nightsBetween(b.from, b.to), 0);
  // "Guests across all stays" — the summed headcount, plus the distinct people.
  const guestHeadcount = income.reduce((s, b) => s + (b.guests || 1), 0);
  const guestNights = income.reduce((s, b) => s + nightsBetween(b.from, b.to) * (b.guests || 1), 0);
  const distinctGuests = new Set(income.map((b) => b.guest_id)).size;
  const distinctHosts = new Set(properties.map((p) => p.host_id).concat(income.map(hostOf))).size;

  const reviewsCount = Object.values(scoresById).reduce((s, x) => s + (x.count || 0), 0);
  const ratingWeighted = Object.values(scoresById).reduce((s, x) => s + (x.avgRating || 0) * (x.count || 0), 0);
  const avgRating = reviewsCount ? round2(ratingWeighted / reviewsCount) : 0;

  // ── Income by month + occupancy by year (mirror the host view) ────────────
  const monthMap = {};
  for (const b of income) {
    const key = b.from.slice(0, 7);
    const m = (monthMap[key] = monthMap[key] || { month: key, gmv: 0, nights: 0, bookings: 0, guests: 0 });
    m.gmv += b.quote_total || 0;
    m.nights += nightsBetween(b.from, b.to);
    m.bookings += 1;
    m.guests += b.guests || 1;
  }
  const gmvByMonth = Object.values(monthMap)
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => ({ ...m, gmv: round2(m.gmv) }));

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
  const { occupancyByDay, peakDay } = buildDayOccupancy(income);

  // ── Breakdowns: district, type, host, property ────────────────────────────
  const bucket = (map, key, seed) => (map[key] = map[key] || { ...seed });

  const districtMap = {};
  for (const p of properties) bucket(districtMap, p.district || "Unknown", { district: p.district || "Unknown", listings: 0, bookings: 0, nights: 0, gmv: 0 }).listings += 1;
  for (const b of income) {
    const d = bucket(districtMap, districtOf(b), { district: districtOf(b), listings: 0, bookings: 0, nights: 0, gmv: 0 });
    d.bookings += 1;
    d.nights += nightsBetween(b.from, b.to);
    d.gmv += b.quote_total || 0;
  }
  const byDistrict = Object.values(districtMap)
    .map((d) => ({ ...d, gmv: round2(d.gmv) }))
    .sort((a, b) => b.gmv - a.gmv);

  const typeMap = {};
  for (const p of properties) bucket(typeMap, p.type || "other", { type: p.type || "other", listings: 0, bookings: 0, nights: 0, gmv: 0 }).listings += 1;
  for (const b of income) {
    const t = bucket(typeMap, typeOf(b), { type: typeOf(b), listings: 0, bookings: 0, nights: 0, gmv: 0 });
    t.bookings += 1;
    t.nights += nightsBetween(b.from, b.to);
    t.gmv += b.quote_total || 0;
  }
  const byType = Object.values(typeMap)
    .map((t) => ({ ...t, gmv: round2(t.gmv) }))
    .sort((a, b) => b.gmv - a.gmv);

  const hostMap = {};
  for (const p of properties) bucket(hostMap, p.host_id || "unknown", { hostId: p.host_id || "unknown", listings: 0, bookings: 0, nights: 0, gmv: 0 }).listings += 1;
  for (const b of income) {
    const h = bucket(hostMap, hostOf(b), { hostId: hostOf(b), listings: 0, bookings: 0, nights: 0, gmv: 0 });
    h.bookings += 1;
    h.nights += nightsBetween(b.from, b.to);
    h.gmv += b.quote_total || 0;
  }
  const topHosts = Object.values(hostMap)
    .map((h) => ({ ...h, gmv: round2(h.gmv) }))
    .sort((a, b) => b.gmv - a.gmv);

  const propMap = {};
  for (const p of properties)
    propMap[p.id] = { propertyId: p.id, name: p.name || p.id, host: p.host_id || "", type: p.type || "", district: p.district || "", gmv: 0, bookings: 0, nights: 0, guests: 0 };
  for (const b of income) {
    const p =
      propMap[b.property_id] ||
      (propMap[b.property_id] = { propertyId: b.property_id, name: b.property_id, host: hostOf(b), type: "", district: "", gmv: 0, bookings: 0, nights: 0, guests: 0, removed: true });
    p.gmv += b.quote_total || 0;
    p.bookings += 1;
    p.nights += nightsBetween(b.from, b.to);
    p.guests += b.guests || 1;
  }
  const topProperties = Object.values(propMap)
    .map((p) => {
      const score = scoresById[p.propertyId] || { avgRating: 0, count: 0 };
      return { ...p, gmv: round2(p.gmv), avgRating: score.avgRating || 0, reviews: score.count || 0 };
    })
    .sort((a, b) => b.gmv - a.gmv);

  const stateDistribution = {};
  for (const b of bookings) stateDistribution[b.state] = (stateDistribution[b.state] || 0) + 1;

  return {
    totals: {
      gmv: round2(gmv),
      completedRevenue: round2(completedRevenue),
      upcomingRevenue: round2(upcomingRevenue),
      estimatedTakeRatePct: feePct,
      estimatedPlatformRevenue: round2((gmv * feePct) / 100),
      listings: properties.length,
      activeListings: properties.filter((p) => p.active).length,
      hosts: distinctHosts,
      totalBookings: bookings.length,
      activeBookings: bookings.filter((b) => ["hold", "confirmed", "completed"].includes(b.state)).length,
      incomeBookings: income.length,
      guestHeadcount,
      distinctGuests,
      nightsBooked,
      guestNights,
      avgBookingValue: income.length ? round2(gmv / income.length) : 0,
      avgRating,
      reviews: reviewsCount,
    },
    gmvByMonth,
    occupancyByYear,
    occupancyByDay,
    peakDay,
    byDistrict,
    byType,
    topHosts,
    topProperties,
    stateDistribution,
    currency: "ROL",
  };
}

// ── Search sorting + pagination ───────────────────────────────────────────────
// Sorting/paging happen in the gateway (not inventory) because the sort keys —
// price and rating — only exist AFTER the gateway enriches each match with its
// quote and review score. Pure functions so they are unit-testable in isolation.

const SEARCH_SORTS = ["price_asc", "price_desc", "rating_desc", "capacity_desc"];
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

const quotePrice = (r) => (r.quote && typeof r.quote.total === "number" ? r.quote.total : null);

/** Return a NEW array sorted by `sort`; unknown/empty sort → original order. */
function sortSearchResults(results, sort) {
  if (!SEARCH_SORTS.includes(sort)) return results;
  const cmpPrice = (a, b, dir) => {
    const pa = quotePrice(a);
    const pb = quotePrice(b);
    // Unpriced listings (pricing unavailable) always sink to the bottom.
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return dir === "asc" ? pa - pb : pb - pa;
  };
  return [...results].sort((a, b) => {
    switch (sort) {
      case "price_asc":
        return cmpPrice(a, b, "asc");
      case "price_desc":
        return cmpPrice(a, b, "desc");
      case "rating_desc":
        return (b.score?.avgRating || 0) - (a.score?.avgRating || 0);
      case "capacity_desc":
        return (b.capacity || 0) - (a.capacity || 0);
      default:
        return 0;
    }
  });
}

/** Slice `items` into a clamped page. Returns the page metadata + `slice`. */
function paginate(items, page, pageSize) {
  const total = items.length;
  const size = Math.min(Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (current - 1) * size;
  return { page: current, pageSize: size, total, totalPages, slice: items.slice(start, start + size) };
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
      const enriched = await Promise.all(
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
      const sort = SEARCH_SORTS.includes(req.query.sort) ? req.query.sort : "";
      const sorted = sortSearchResults(enriched, sort);
      const { page, pageSize, total, totalPages, slice } = paginate(sorted, req.query.page, req.query.pageSize);
      res.json({
        results: slice,
        total,
        page,
        pageSize,
        totalPages,
        sort,
        scoreStatus: scores ? "ok" : "unavailable",
      });
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
    const { propertyId, from, to, guests, coupon } = req.body || {};
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
        quote = await pricing.quote({ propertyId, basePrice: property.base_price, from, to, guests, coupon });
      } catch (err) {
        await inventory.release(user, hold.lock_id).catch(() => {});
        return sendError(res, err);
      }

      // Only persist a coupon that actually applied, so the confirm-time re-quote
      // reproduces the same total (an invalid/ineligible code is surfaced in the
      // quote but not remembered on the booking).
      const appliedCoupon = quote.coupon && quote.coupon.applied ? quote.coupon.code : "";

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
          coupon: appliedCoupon,
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
          coupon: booking.coupon || "",
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

  // Guest "your travel" summary — the caller's own trips shaped into nights,
  // spend, and favourite regions (option B of IMPROVEMENTS #20). Spend is the
  // booking quote total; the bridge overlays what was actually charged in ROL.
  app.get("/v1/guest/travel", async (req, res) => {
    const user = userOf(req);
    try {
      const [bookingsReply, propsReply] = await Promise.all([reservation.listBookings(user, "guest"), inventory.listProperties(user, "")]);
      const bookings = bookingsReply.bookings || [];
      const properties = propsReply.properties || [];
      res.json(buildGuestTravelSummary({ bookings, properties }));
    } catch (err) {
      sendError(res, err); // reservation down → 503
    }
  });

  // Platform/admin analytics — aggregate across ALL hosts, listings, and
  // bookings (option A of IMPROVEMENTS #20). Admin-gated; owns no data, just
  // shapes what every leaf returns. Review scores are best-effort.
  app.get("/v1/platform/analytics", async (req, res) => {
    const user = userOf(req);
    if (!isAdmin(user)) return res.status(403).json({ error: "FORBIDDEN", detail: "Platform analytics is admin-only" });
    try {
      const [propsReply, bookingsReply] = await Promise.all([inventory.listAllProperties(user), reservation.listAllBookings(user)]);
      const properties = propsReply.properties || [];
      const bookings = bookingsReply.bookings || [];
      const scoresById = (await scoresBestEffort(properties.map((p) => p.id))) || {};
      res.json(buildPlatformAnalytics({ properties, bookings, scoresById }));
    } catch (err) {
      sendError(res, err); // inventory or reservation down → 503
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

module.exports = {
  buildApp,
  start,
  buildHostingAnalytics,
  buildGuestTravelSummary,
  buildPlatformAnalytics,
  sortSearchResults,
  paginate,
  SEARCH_SORTS,
};
