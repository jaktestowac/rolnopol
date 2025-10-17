#!/usr/bin/env node

/**
 * Password Migration Script
 *
 * This script migrates existing plain text passwords to bcrypt hashes.
 * Run this script once after implementing bcrypt to convert all existing user passwords.
 */

const bcrypt = require("bcrypt");
const fs = require("fs").promises;
const path = require("path");
const { logDebug, logError } = require("../helpers/logger-api");

const USERS_FILE = path.join(__dirname, "../data/users.json");

async function migratePasswords() {
  try {
    logDebug("Starting password migration...");

    // Read users file
    const usersData = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(usersData);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // Check if password is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
      if (user.password && !user.password.startsWith("$2")) {
        logDebug(`Migrating password for user: ${user.email || user.username}`);

        // Hash the plain text password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(user.password, saltRounds);

        // Update the user password
        user.password = hashedPassword;
        migratedCount++;

        logDebug(`Password migrated for user: ${user.email || user.username}`);
      } else {
        skippedCount++;
        logDebug(`Password already hashed or empty for user: ${user.email || user.username}`);
      }
    }

    // Write back to file
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    await fs.writeFile(`${USERS_FILE}.backup`, usersData); // Create backup

    logDebug(`Password migration completed. Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
    logDebug(`Backup created at: ${USERS_FILE}.backup`);

  } catch (error) {
    logError("Password migration failed:", error);
    process.exit(1);
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migratePasswords()
    .then(() => {
      logDebug("Migration script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logError("Migration script failed:", error);
      process.exit(1);
    });
}

module.exports = { migratePasswords };
