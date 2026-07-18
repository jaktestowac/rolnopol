/**
 * Config for the pricing REST service (:4311). Stateless — no data file.
 */
const HOST = process.env.PRICING_HOST || "0.0.0.0";
const PORT = process.env.PRICING_PORT != null && process.env.PRICING_PORT !== "" ? Number(process.env.PRICING_PORT) : 4311;

module.exports = { HOST, PORT };
