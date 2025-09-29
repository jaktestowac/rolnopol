const express = require("express");
const router = express.Router();
const { getLogList } = require("../helpers/logger-api");

// GET /api/logs - return log list
router.get("/", (req, res) => {
  const logs = getLogList();
  res.json({ logs });
});

module.exports = router;
