const express = require("express");
const { apiLimiter } = require("../../api/limiters");
const { formatResponseBody } = require("../../helpers/response-helper");

const pingRoute = express.Router();

pingRoute.get("/ping", apiLimiter, (req, res) => {
  const isBlackMonolith = String(req.query?.sig || "").toLowerCase() === "odyssey";

  return res.status(200).json(
    formatResponseBody({
      message: "pong",
      meta: isBlackMonolith
        ? {
            easterEgg: {
              id: "black-monolith-ping",
              monolithGlyph: "■",
            },
          }
        : undefined,
    }),
  );
});

module.exports = pingRoute;
