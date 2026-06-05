const express = require("express");
const router = express.Router();
const { handle } = require("../../controllers/notification-count.controller");

router.get("/notifications/count", handle);

module.exports = router;
