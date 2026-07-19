const { POOLS, pick } = require("../phrases");

/**
 * Greetings, thanks, and "what can you do" capability questions — varied so the
 * assistant feels conversational rather than scripted. Phrasing pools live in
 * ../phrases so they're easy to extend.
 */

function capabilities() {
  return [
    pick([
      "I'm Porky, your farm assistant. Here's what I can help with:",
      "Happy to help! I can cover:",
      "I'm Porky 🐷 — here's what I can do:",
      "Glad you asked — here's my toolkit:",
      "I'm Porky, your farm assistant. Here's what I can do for you:",
      "I'm Porky, your farm assistant. Here's what I can help you with:",
      "I'm Porky, your farm assistant. Here's what I can assist you with:",
      "I'm Porky, your farm assistant. Here's what I can support you with:",
      "I'm Porky, your farm assistant. Here's what I can provide for you:",
      "I'm Porky, your farm assistant. Here's what I can offer you:",
    ]),
    '- Weather forecasts by region (try "weather in Silesia")',
    '- Commodity & market prices ("wheat prices")',
    '- Farm alerts and risks ("any alerts?")',
    '- Your fields, staff, animals, and finances ("summary", "how are my fields?")',
    '- Marketplace offers ("what\'s on the marketplace?")',
    "- Playful modes: pirate, coach, detective, bard, oracle, zen",
  ].join("\n");
}

module.exports = {
  id: "smalltalk",
  match(normalizedPrompt) {
    return (
      /\b(hi|hello|hey|hiya|howdy|greetings|cześć|czesc|witaj|witam)\b/.test(normalizedPrompt) ||
      /\b(thanks|thank you|thx|dzięki|dzieki|dziękuję)\b/.test(normalizedPrompt) ||
      /(what can you do|what do you do|who are you|how can you help|capabilities|\bhelp\b)/.test(normalizedPrompt)
    );
  },
  respond({ normalizedPrompt }) {
    if (/\b(thanks|thank you|thx|dzięki|dzieki|dziękuję)\b/.test(normalizedPrompt)) {
      return pick(POOLS.thanks);
    }

    if (/(what can you do|what do you do|who are you|how can you help|capabilities|\bhelp\b)/.test(normalizedPrompt)) {
      return capabilities();
    }

    // Greeting.
    return [pick(POOLS.greetings), pick(POOLS.greetingHints)].join("\n");
  },
};
