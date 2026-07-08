/**
 * Pricing quote logic — pure function, deterministic, penny-exact.
 *
 * per-night = basePrice × seasonMultiplier × (weekend ? uplift : 1)
 * stays ≥ 7 nights get a 10% discount on the nightly subtotal.
 */
const dates = require("../../shared/dates");
const seasons = require("../config/seasons");

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param {{basePrice:number, from:string, to:string}} input
 * @returns {{total, currency, nights, discounts}}
 */
function quote({ basePrice, from, to }) {
  const nightsList = dates.eachNight(from, to);
  const nights = nightsList.map((date) => {
    const season = seasons.seasonForDate(date);
    const dow = dates.dayOfWeek(date);
    const weekend = dow === 5 || dow === 6;
    const price = round2(basePrice * seasons.SEASON_MULTIPLIER[season] * (weekend ? seasons.WEEKEND_UPLIFT : 1));
    return { date, price, season, weekend };
  });

  const subtotal = round2(nights.reduce((s, n) => s + n.price, 0));
  const discounts = [];
  let total = subtotal;
  if (nightsList.length >= seasons.LONG_STAY_MIN_NIGHTS) {
    const amount = round2(subtotal * seasons.LONG_STAY_DISCOUNT);
    discounts.push({ code: "long_stay", label: `${seasons.LONG_STAY_MIN_NIGHTS}+ nights`, amount });
    total = round2(subtotal - amount);
  }

  return { total, currency: "ROL", nights, discounts, subtotal };
}

module.exports = { quote, round2 };
