/**
 * Domain Event v1 contract reference (JSDoc only).
 * @typedef {Object} DomainEvent
 * @property {string} type
 * @property {string} timestamp
 * @property {string} correlationId
 * @property {Object<string, any>} payload
 * @property {string=} source
 * @property {number=} version
 */

/**
 * Notification message contract reference (JSDoc only).
 * @typedef {Object} NotificationMessage
 * @property {string} id
 * @property {string} correlationId
 * @property {number|string} userId
 * @property {Array<{name: string, status: string, attempts?: number, reason?: string}>} channels
 * @property {string} title
 * @property {string} message
 * @property {string} createdAt
 * @property {string|null} sentAt
 * @property {string} expiresAt
 * @property {{eventType: string, policyApplied: string}} metadata
 */

/**
 * Notification policy contract reference (JSDoc only).
 * @typedef {Object} NotificationPolicy
 * @property {string} id
 * @property {string} eventType
 * @property {'low'|'normal'|'high'} priority
 * @property {string[]} channels
 * @property {{seconds: number}=} dedupe
 * @property {{max: number, windowSeconds: number}=} rateLimit
 * @property {number=} processingDelayMs
 * @property {(event: DomainEvent) => {title: string, message: string}} template
 */

const MVP_EVENT_CATALOG = [
  "transaction.created",
  "user.account.created",
  "field.created",
  "staff.created",
  "animal.created",
  "animal.assigned",
  "marketplace.offer.created",
  "marketplace.purchase.completed",
  "transfer.completed",
  "user.login.failed",
  "user.login.invalid_credentials",
  "user.registration.failed.user_exists",
];

module.exports = {
  MVP_EVENT_CATALOG,
};
