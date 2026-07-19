const { pick, chance } = require("./mock-random");

/**
 * Central pools of interchangeable phrasings for the mock provider. Keeping them
 * here (rather than inline) makes the mock feel less scripted and is the single
 * place to add more variety — just extend an array.
 *
 * IMPORTANT: only *framing* text (intros, closers, connectors) lives here. The
 * factual lines intents produce (numbers, region names, prices) stay in the
 * intents so their wording is stable and testable.
 */

const POOLS = {
  summaryIntros: [
    "Here is a quick summary of your farm data:",
    "Here's where your farm stands right now:",
    "A quick snapshot of your farm:",
    "At a glance, your farm looks like this:",
    "Sure — here's your farm summary:",
    "Let's take stock of your farm:",
  ],
  // Closers appended after a list reply (fields/staff/animals). The list intros
  // themselves stay fixed ("Your fields:", …) — a smoke-eval health check keys
  // off them — so variety here comes from the trailing line.
  listClosers: [
    "",
    "",
    "Ask me for a full summary anytime.",
    "Want details on any of them?",
    "Let me know if you'd like a deeper look.",
    "Happy to break any of these down further.",
  ],
  financeIntros: [
    "Here's your financial snapshot:",
    "Money-wise, here's where you are:",
    "Your finances at a glance:",
    "Let's look at the books:",
  ],
  weatherIntros: [
    "Here's today's weather for",
    "Current conditions in",
    "Weather check for",
    "Latest reading for",
    "Right now in",
  ],
  nationwideIntros: [
    "Here's a quick nationwide snapshot:",
    "A country-wide glance at today:",
    "Weather across Poland today:",
    "Top-level view for the country:",
  ],
  pricesIntros: [
    "Here are the latest commodity prices:",
    "Current market prices:",
    "Today's price board:",
    "Fresh off the ticker:",
    "Market check — here's where prices sit:",
  ],
  alertsHaveIntros: [
    "Here are your recent farm alerts:",
    "Latest alerts on your farm:",
    "What's flagged right now:",
    "A few things need your attention:",
  ],
  alertsQuietIntros: [
    "Nothing critical is flagged for your account right now. Typical things I watch for:",
    "Your alert feed is quiet at the moment. Here's the kind of thing I'd flag:",
    "No active alerts on record — but here's a sample of what I monitor:",
    "All clear for now. To give you a feel, these are the alerts I keep an eye on:",
  ],
  marketplaceIntros: [
    "Here's your marketplace snapshot:",
    "Marketplace overview:",
    "What's happening in the market:",
    "A look at the marketplace:",
  ],
  greetings: [
    "Hi there! I'm Porky, your farm assistant. 🐷",
    "Hello! Porky here, ready to help with the farm.",
    "Hey! Good to see you — Porky at your service.",
    "Well hello! Porky reporting for farm duty. 🐷",
    "Hi! Porky here — let's talk crops, herds, and weather.",
  ],
  greetingHints: [
    "Ask me about the weather, market prices, alerts, or your own fields, staff, and animals.",
    'Try "weather in Silesia", "wheat prices", or "summary" to get started.',
    "What would you like to know — weather, prices, alerts, or your farm data?",
    "I can check the forecast, prices, alerts, or summarize your farm — your call.",
  ],
  thanks: [
    "You're welcome! Anything else about your farm?",
    "Anytime! Ask me about weather, prices, or your fields whenever.",
    "Glad to help 🐷 — what's next?",
    "My pleasure! Need anything else?",
    "Happy to help. What else can I dig into?",
  ],
  followUps: [
    "Want me to check the weather for a region?",
    "Ask me about market prices whenever you like.",
    "I can pull up recent alerts too, if useful.",
    "Need a summary of your fields, staff, or animals?",
    "Curious about marketplace offers? Just ask.",
    "Want a look at your finances next?",
  ],
  mockedNotes: [
    "This is a mocked assistant response — try pirate, coach, detective, bard, oracle, or zen mode for a different tone.",
    "Heads up: I'm running in mock mode. Ask about weather, prices, alerts, or try a persona mode (pirate, bard, zen…).",
    "Note: responses are simulated. I can still do weather, prices, alerts, and playful modes.",
    "Mock mode is on — for fun, try \"pirate mode\" or ask about the weather and prices.",
  ],
};

// Return a follow-up suggestion with the given probability, prefixed for spacing.
function maybeFollowUp(probability = 0.5) {
  return chance(probability) ? `\n\n${pick(POOLS.followUps)}` : "";
}

module.exports = { POOLS, pick, maybeFollowUp };
