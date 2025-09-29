const express = require("express");
const router = express.Router();
const { getLogList } = require("../helpers/logger-api");
const { logDebug, logError, logInfo } = require("../helpers/logger-api");
const dbManager = require("../data/database-manager");

// POST /api/contact - submit contact form
router.post("/", async (req, res) => {
  const { name, email, subject, message } = req.body;
  // verify contact form fields
  if (!name || !email || !subject || !message) {
    logError("Contact Form Submission Failed: Missing Fields", { name, email, subject, message });
    return res.status(400).json({ success: false, error: "All fields are required." });
  }

  // check if email is valid
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    logError("Contact Form Submission Failed: Invalid Email", { email });
    return res.status(400).json({ success: false, error: "Invalid email format." });
  }

  // check if subject is valid
  if (subject.length < 3) {
    logError("Contact Form Submission Failed: Invalid Subject", { subject });
    return res.status(400).json({ success: false, error: "Subject must be at least 3 characters long." });
  }

  // check if message is valid
  if (message.length < 10) {
    logError("Contact Form Submission Failed: Invalid Message", { message });
    return res.status(400).json({ success: false, error: "Message must be at least 10 characters long." });
  }

  logInfo("Contact Form Submission", { name, email, subject, message });

  try {
    const contactsDb = dbManager.getCustomDatabase(
      "contacts",
      "contacts.json",
      [],
    );

    const contactRecord = {
      name,
      email,
      subject,
      message,
      createdAt: new Date().toISOString(),
      ip: req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const saved = await contactsDb.add(contactRecord);
    logDebug("Contact saved", { id: saved.id, email: saved.email });

    res.status(200).json({ success: true, message: "Message received", id: saved.id });
  } catch (error) {
    logError("Failed to save contact form", { error: error.message });
    res.status(500).json({ success: false, error: "Failed to save message." });
  }
});

module.exports = router;
