const { logError } = require("../helpers/logger-api");

/**
 * User lifecycle hook registry (data layer).
 *
 * This is a pure, dependency-free choke point that lets the service layer react
 * to user create/delete without the data layer ever depending on services.
 * Services register their side effects here (e.g. financial-account init,
 * resource cascade-delete) — the dependency direction stays service → data.
 *
 * Handlers are keyed so registration is idempotent.
 */
const createHandlers = new Map();
const deleteHandlers = new Map();

/**
 * Register a handler invoked after a user is created.
 * @param {string} key - unique handler id (idempotent on re-register)
 * @param {(user: object) => any} handler
 */
function onUserCreated(key, handler) {
  if (typeof handler === "function") {
    createHandlers.set(key, handler);
  }
}

/**
 * Register a handler invoked after a user is deleted.
 * @param {string} key - unique handler id (idempotent on re-register)
 * @param {(user: object) => any} handler
 */
function onUserDeleted(key, handler) {
  if (typeof handler === "function") {
    deleteHandlers.set(key, handler);
  }
}

/**
 * Fire create handlers. Best-effort: a failing handler is logged and swallowed
 * so user creation itself never fails on a side effect.
 */
async function notifyUserCreated(user) {
  for (const [key, handler] of createHandlers) {
    try {
      await handler(user);
    } catch (error) {
      logError(`user-lifecycle create handler "${key}" failed`, error);
    }
  }
}

/**
 * Fire delete handlers. Errors propagate (matching the original cascade-delete
 * semantics where a failed cascade fails the delete).
 */
async function notifyUserDeleted(user) {
  for (const [, handler] of deleteHandlers) {
    await handler(user);
  }
}

/** Test helper — clear all registered handlers. */
function _reset() {
  createHandlers.clear();
  deleteHandlers.clear();
}

module.exports = {
  onUserCreated,
  onUserDeleted,
  notifyUserCreated,
  notifyUserDeleted,
  _reset,
};
