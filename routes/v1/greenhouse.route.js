/**
 * Greenhouse REST companion routes — "Grow-a-Plant" (P2).
 *
 * Thin proxy: feature-flag gate → identity resolution → gRPC client → JSON.
 * The app never touches greenhouse data directly; it calls the standalone
 * greenhouse service over gRPC. gRPC status codes are mapped to HTTP.
 *
 * Mounted under /api/v1 (see routes/v1/index.js):
 *   GET  /greenhouse/crops
 *   GET  /greenhouse
 *   POST /greenhouse/:slot/plant     body: { crop }
 *   POST /greenhouse/:slot/water
 *   POST /greenhouse/:slot/harvest
 */
const express = require("express");
const grpc = require("@grpc/grpc-js");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const { client: greenhouseClient, resolveGreenhouseIdentity } = require("../../modules/greenhouse");

const router = express.Router();
const apiLimiter = createRateLimiter("api");

router.use("/greenhouse", requireFeatureFlag("greenhouseControlRoomEnabled", { resourceName: "Greenhouse" }));

function sendGrpcError(res, err) {
  switch (err?.code) {
    case grpc.status.NOT_FOUND:
      return res.status(404).json(formatResponseBody({ error: err.details || "Not found" }));
    case grpc.status.INVALID_ARGUMENT:
      return res.status(400).json(formatResponseBody({ error: err.details || "Invalid argument" }));
    case grpc.status.FAILED_PRECONDITION:
      return res.status(409).json(formatResponseBody({ error: err.details || "Action not allowed in current state" }));
    case grpc.status.UNAVAILABLE:
    case grpc.status.DEADLINE_EXCEEDED:
      return res
        .status(503)
        .json(formatResponseBody({ error: "Greenhouse service offline — run `npm run greenhouse`" }));
    default:
      return res.status(500).json(formatResponseBody({ error: "Internal error" }));
  }
}

const slotOf = (req) => Number(req.params.slot);

// Crop catalog (no identity needed, but keep it behind the flag + limiter).
router.get("/greenhouse/crops", apiLimiter, resolveGreenhouseIdentity, async (req, res) => {
  try {
    const data = await greenhouseClient.listCrops(req.ghIdentity);
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.get("/greenhouse", apiLimiter, resolveGreenhouseIdentity, async (req, res) => {
  try {
    const data = await greenhouseClient.listGreenhouses(req.ghIdentity);
    return res.status(200).json(formatResponseBody({ data, meta: { identityKind: req.ghIdentity.kind } }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.post("/greenhouse/:slot/plant", apiLimiter, resolveGreenhouseIdentity, async (req, res) => {
  try {
    const data = await greenhouseClient.plant(req.ghIdentity, slotOf(req), req.body?.crop);
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.post("/greenhouse/:slot/water", apiLimiter, resolveGreenhouseIdentity, async (req, res) => {
  try {
    const data = await greenhouseClient.water(req.ghIdentity, slotOf(req));
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.post("/greenhouse/:slot/harvest", apiLimiter, resolveGreenhouseIdentity, async (req, res) => {
  try {
    const data = await greenhouseClient.harvest(req.ghIdentity, slotOf(req));
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

module.exports = router;
