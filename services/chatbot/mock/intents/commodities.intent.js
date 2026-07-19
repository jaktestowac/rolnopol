const { jitter } = require("../mock-random");
const { POOLS, pick } = require("../phrases");

/**
 * Commodity prices intent — calls the real `get_commodity_prices` tool and, when
 * the account has no price samples, generates believable, gently-varying market
 * prices (in ROL) so the reply looks like a live ticker.
 */

const BASE_PRICES = [
  { name: "Wheat", base: 92, unit: "ROL/100kg" },
  { name: "Corn", base: 78, unit: "ROL/100kg" },
  { name: "Barley", base: 71, unit: "ROL/100kg" },
  { name: "Rapeseed", base: 189, unit: "ROL/100kg" },
  { name: "Milk", base: 2.15, unit: "ROL/L" },
  { name: "Potatoes", base: 48, unit: "ROL/100kg" },
];

function trendArrow() {
  return pick(["↑", "↓", "→"]);
}

function synthesize(commodityFilter) {
  const rows = BASE_PRICES.filter((c) => !commodityFilter || c.name.toLowerCase().includes(commodityFilter));
  const list = (rows.length ? rows : BASE_PRICES).map((c) => {
    const price = jitter(c.base, 6);
    const digits = c.base < 10 ? 2 : 0;
    return `- ${c.name}: ${price.toFixed(digits)} ${c.unit} ${trendArrow()}`;
  });
  return list.join("\n");
}

function formatFromTool(data) {
  const items = Array.isArray(data.commodities) ? data.commodities : [];
  if (!items.length) {
    return null;
  }
  return items
    .map((c) => `- ${c.name}: ${c.currentPrice} ${c.unit || ""} ${c.trend || ""}`.trim())
    .join("\n");
}

module.exports = {
  id: "commodities",
  match(normalizedPrompt) {
    return /\b(price|prices|commodity|commodities|market|wheat|corn|barley|rapeseed|milk|potato|potatoes|trading|trade)\b/.test(normalizedPrompt);
  },
  async respond({ normalizedPrompt, tools }) {
    const result = await tools.call("get_commodity_prices", { commodity: "all", include_history: false });
    const fromTool = result && !result.error ? formatFromTool(result) : null;

    const intro = pick(POOLS.pricesIntros);

    if (fromTool) {
      return [intro, fromTool].join("\n");
    }

    // Detect a specific commodity in the prompt for a focused answer.
    const specific = ["wheat", "corn", "barley", "rapeseed", "milk", "potato"].find((c) => normalizedPrompt.includes(c));
    const closer = pick([
      "\nPrices are simulated and refresh each time you ask.",
      "\nThese are mock quotes — ask again for a fresh read.",
      "\nSimulated market data; trends shift on each request.",
    ]);
    return [intro, synthesize(specific || null), closer].join("\n");
  },
};
