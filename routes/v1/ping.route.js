const express = require("express");
const { regularLimiter } = require("../api/limiters");

const pingRoute = express.Router();

pingRoute.get("/ping", regularLimiter, (req, res) => {
  res.status(200).json({ message: "pong" });
});

module.exports = pingRoute;
