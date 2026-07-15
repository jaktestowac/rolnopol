/**
 * External services monitoring route.
 *
 * Thin proxy: it delegates all probing to services/service-monitor.service,
 * which owns the registry of monitored services and the per-transport adapters.
 * This route stays transport-agnostic — adding a service or a new transport
 * (HTTP, etc.) is done in the service module, not here.
 *
 * Intentionally NOT gated by the services' feature flags, so operators can see a
 * service is up even while its feature is toggled off; each service's flag state
 * is reported alongside its health for context.
 *
 * Mounted under /api/v1 (see routes/v1/index.js):
 *   GET /services/status   → { services: [{ key, name, status, ... }] }
 */
const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const serviceMonitor = require("../../services/service-monitor.service");

const router = express.Router();
const apiLimiter = createRateLimiter("api");

router.get("/services/status", apiLimiter, async (req, res) => {
  const services = await serviceMonitor.probeAll();
  return res.status(200).json(formatResponseBody({ data: { services } }));
});

module.exports = router;
