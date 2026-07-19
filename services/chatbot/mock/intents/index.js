/**
 * Ordered intent registry for the mock provider. Order = priority: the first
 * intent whose match() returns truthy handles the prompt. Specific intents come
 * first; the catch-all fallback must stay last.
 *
 * To extend the mock: add a new `*.intent.js` module ({ id, match, respond }) and
 * insert it at the right priority here. No other file needs to change.
 */
module.exports = [
  require("./easter-eggs.intent"),
  require("./personas.intent"),
  require("./weather.intent"),
  require("./alerts.intent"),
  require("./commodities.intent"),
  require("./marketplace.intent"),
  require("./farm.intent"),
  require("./smalltalk.intent"),
  require("./fallback.intent"),
];
