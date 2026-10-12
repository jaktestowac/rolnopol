const express = require("express");
const practiceController = require("../../controllers/practice.controller");

/**
 * Practice endpoint family: /api/v1/practice/*
 *
 * Backs the hidden practice pages under /practice/*.html (not linked from the app).
 * Always on: no login, no feature flag, no rate limiter shared with the rest of
 * the API. State is in memory, per x-practice-session-id, so these endpoints
 * cannot affect any other part of Rolnopol.
 */
const practiceRoute = express.Router();

practiceRoute.get("/practice/catalog", practiceController.getCatalog.bind(practiceController));
practiceRoute.get("/practice/webmcp-demo/state", practiceController.getWebMcpDemoState.bind(practiceController));
practiceRoute.post("/practice/webmcp-demo/beds/:bedId/water", practiceController.waterWebMcpDemoBed.bind(practiceController));
practiceRoute.post("/practice/webmcp-demo/beds/:bedId/harvest", practiceController.harvestWebMcpDemoBed.bind(practiceController));
practiceRoute.post("/practice/webmcp-demo/reset", practiceController.resetWebMcpDemo.bind(practiceController));

module.exports = practiceRoute;
