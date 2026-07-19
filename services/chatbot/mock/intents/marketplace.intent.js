const { POOLS, pick } = require("../phrases");

/**
 * Marketplace intent — reports the user's own active offers from the summary /
 * samples in context, and calls the `get_marketplace_summary` tool for any
 * available listings. Falls back to an encouraging nudge when nothing is listed.
 */

module.exports = {
  id: "marketplace",
  match(normalizedPrompt) {
    return /\b(marketplace|market place|offer|offers|buy|buying|sell|selling|listing|listings)\b/.test(normalizedPrompt);
  },
  async respond({ context, tools }) {
    const summary = (context && context.summary) || {};
    const myOffers = (context && context.samples && context.samples.marketplaceOffers) || [];
    const activeCount = summary.activeMarketplaceOffers || myOffers.length || 0;

    const market = await tools.call("get_marketplace_summary", { resource_type: "all", limit: 5 });
    const availableFields = market && market.fields ? market.fields.count || 0 : 0;
    const availableAnimals = market && market.animals ? market.animals.count || 0 : 0;

    const lines = [pick(POOLS.marketplaceIntros)];

    if (activeCount > 0) {
      lines.push(`- You have ${activeCount} active offer${activeCount === 1 ? "" : "s"} listed.`);
      myOffers.slice(0, 3).forEach((offer) => {
        lines.push(`  • ${offer.itemType || "item"} — ${offer.price || 0} ROL (${offer.status || "active"})`);
      });
    } else {
      lines.push(pick([
        "- You don't have any active offers right now.",
        "- Nothing listed from your side yet.",
      ]));
    }

    if (availableFields || availableAnimals) {
      lines.push(`- Available to buy: ${availableFields} field listing(s), ${availableAnimals} animal listing(s).`);
    } else {
      lines.push("- The wider marketplace looks quiet at the moment.");
    }

    lines.push("\nWant me to summarize your fields or animals before you list something?");
    return lines.join("\n");
  },
};
