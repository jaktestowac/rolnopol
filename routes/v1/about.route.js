const express = require("express");
const app = require("../../app-data.json");
const { formatResponseBody } = require("../../helpers/response-helper");
const { getDocumentation } = require("../../controllers/admin.controller");

const aboutRoute = express.Router();

function getData() {
  return { ...app, dateTime: new Date().toISOString() };
}

/**
 * Get about information
 * GET /api/about
 */
aboutRoute.get("/about", (req, res) => {
  res
    .status(200)
    .send(
      formatResponseBody({ data: getData(), message: "Welcome to Rolnopol!" }),
    );
});

/**
 * Serve documentation data as JSON
 * GET /api/documentation
 */
aboutRoute.get("/documentation", getDocumentation);

module.exports = aboutRoute;
