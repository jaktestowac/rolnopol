/**
 * Pricing rules — compiled-in, not data (the service is stateless).
 *
 * Season is derived from the month of each night. Weekend nights (Fri/Sat
 * check-in) get an uplift. Stays of 7+ nights get a discount on the nightly
 * subtotal. All deterministic: same inputs → same total, to the penny.
 */

// month (1-12) → season key
const SEASON_BY_MONTH = {
  1: "low",
  2: "low",
  3: "mid",
  4: "mid",
  5: "mid",
  6: "high",
  7: "high",
  8: "high",
  9: "mid",
  10: "mid",
  11: "low",
  12: "high", // holidays
};

const SEASON_MULTIPLIER = { low: 0.9, mid: 1.0, high: 1.3 };

const WEEKEND_UPLIFT = 1.15; // applied to Fri (5) and Sat (6) check-ins
const LONG_STAY_MIN_NIGHTS = 7;
const LONG_STAY_DISCOUNT = 0.1; // 10% off the nightly subtotal

function seasonForDate(date) {
  const month = Number(date.slice(5, 7));
  return SEASON_BY_MONTH[month] || "mid";
}

module.exports = {
  SEASON_BY_MONTH,
  SEASON_MULTIPLIER,
  WEEKEND_UPLIFT,
  LONG_STAY_MIN_NIGHTS,
  LONG_STAY_DISCOUNT,
  seasonForDate,
};
