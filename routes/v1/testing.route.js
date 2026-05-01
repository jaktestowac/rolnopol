const express = require("express");
const testingController = require("../../controllers/testing.controller");

const testingRoute = express.Router();

testingRoute.all(
  "/testing/webhooks/sink",
  express.text({ type: "*/*", limit: "1mb" }),
  testingController.webhookSink.bind(testingController),
);

module.exports = testingRoute;
