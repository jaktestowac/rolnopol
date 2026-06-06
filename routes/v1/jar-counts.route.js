const express = require("express");
const router = express.Router();
const { handle } = require("../../controllers/jar-counts.controller");

router.get("/operator/jar-counts", handle);

module.exports = router;
