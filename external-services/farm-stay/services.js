/**
 * FarmStay service registry — the single list the supervisor and control CLI
 * both read. Order matters for startup: leaves before the gateway so aggregate
 * health is green as soon as the gateway is up.
 */
const path = require("path");

const SERVICES = [
  {
    name: "inventory",
    kind: "grpc",
    entry: path.join(__dirname, "inventory-service", "server", "index.js"),
    port: () => Number(process.env.INVENTORY_GRPC_PORT || 50071),
  },
  {
    name: "pricing",
    kind: "rest",
    entry: path.join(__dirname, "pricing-service", "server", "index.js"),
    port: () => Number(process.env.PRICING_PORT || 4311),
  },
  {
    name: "reservation",
    kind: "grpc",
    entry: path.join(__dirname, "reservation-service", "server", "index.js"),
    port: () => Number(process.env.RESERVATION_GRPC_PORT || 50072),
  },
  {
    name: "review-desk",
    kind: "rest",
    entry: path.join(__dirname, "review-desk-service", "server", "index.js"),
    port: () => Number(process.env.REVIEW_DESK_PORT || 4312),
  },
  {
    name: "gateway",
    kind: "rest",
    entry: path.join(__dirname, "stay-gateway-service", "server", "index.js"),
    port: () => Number(process.env.STAY_GATEWAY_PORT || 4310),
  },
];

const NAMES = SERVICES.map((s) => s.name);

function byName(name) {
  return SERVICES.find((s) => s.name === name);
}

// Port the supervisor's control HTTP server listens on.
const CONTROL_PORT = Number(process.env.FARM_STAY_CONTROL_PORT || 4319);

module.exports = { SERVICES, NAMES, byName, CONTROL_PORT };
