/**
 * HTTP client → pricing-service (gateway side). Stateless leaf; the gateway
 * always passes basePrice (sourced from inventory) so there is no split-brain.
 */
const { request } = require("./http");
const { PRICING_URL, HTTP_TIMEOUT_MS, HEALTH_TIMEOUT_MS } = require("../config");

module.exports = {
  url: PRICING_URL,
  health: () => request(`${PRICING_URL}/health`, { timeoutMs: HEALTH_TIMEOUT_MS }),
  quote: ({ propertyId, basePrice, from, to, guests }) =>
    request(`${PRICING_URL}/v1/quotes`, {
      method: "POST",
      body: { propertyId, basePrice, from, to, guests },
      timeoutMs: HTTP_TIMEOUT_MS,
    }),
};
