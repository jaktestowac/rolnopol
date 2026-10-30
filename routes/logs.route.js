const express = require("express");
const router = express.Router();
const { getLogList } = require("../helpers/logger-api");

// GET /api/logs - return log list
// ?synthetic=true|false keeps only request entries from (or not from) synthetic monitors;
// any other value is ignored and the full list is returned.
router.get("/", (req, res) => {
  let logs = getLogList();
  const { synthetic } = req.query;
  if (synthetic === "true" || synthetic === "false") {
    const wanted = synthetic === "true";
    logs = logs.filter((entry) => entry.synthetic === wanted);
  }
  res.json({ logs });
});

module.exports = router;
