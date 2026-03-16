const express = require("express");
const app = require("../../app-data.json");
const { formatResponseBody } = require("../../helpers/response-helper");
const { getDocumentation } = require("../../controllers/admin.controller");

const aboutRoute = express.Router();

function getBrokenCompassCode(date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  const seed = isoDate.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[seed % directions.length];
}

function getData() {
  return {
    ...app,
    dateTime: new Date().toISOString(),
    // brokenCompass: getBrokenCompassCode(),
  };
}

/**
 * Get about information
 * GET /api/about
 */
aboutRoute.get("/about", (req, res) => {
  res.status(200).send(formatResponseBody({ data: getData(), message: "Welcome to Rolnopol!" }));
});

/**
 * Serve documentation data as JSON
 * GET /api/documentation
 */
aboutRoute.get("/documentation", getDocumentation);

module.exports = aboutRoute;
