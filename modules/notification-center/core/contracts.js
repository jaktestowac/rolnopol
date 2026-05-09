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
const EVENT_TYPES = {
  TRANSACTION_CREATED: "transaction.created",
  USER_ACCOUNT_CREATED: "user.account.created",
  USER_ACCOUNT_UPDATED: "user.account.updated",
  USER_ACCOUNT_DEACTIVATED: "user.account.deactivated",
  USER_ACCOUNT_REACTIVATED: "user.account.reactivated",
  USER_ACCOUNT_DELETED: "user.account.deleted",
  FIELD_CREATED: "field.created",
  FIELD_UPDATED: "field.updated",
  FIELD_DELETED: "field.deleted",
  STAFF_CREATED: "staff.created",
  ANIMAL_CREATED: "animal.created",
  ANIMAL_ASSIGNED: "animal.assigned",
  FARMLOG_POST_CREATED: "farmlog.post.created",
  FARMLOG_POST_UPDATED: "farmlog.post.updated",
  FARMLOG_POST_DELETED: "farmlog.post.deleted",
  FARMLOG_POST_LIKED: "farmlog.post.liked",
  FARMLOG_POST_FAVORITED: "farmlog.post.favorited",
  MARKETPLACE_OFFER_CREATED: "marketplace.offer.created",
  MARKETPLACE_OFFER_CANCELLED: "marketplace.offer.cancelled",
  MARKETPLACE_PURCHASE_COMPLETED: "marketplace.purchase.completed",
  TRANSFER_COMPLETED: "transfer.completed",
  TRANSACTION_FAILED: "transaction.failed",
  USER_LOGIN_FAILED: "user.login.failed",
  USER_LOGIN_INVALID_CREDENTIALS: "user.login.invalid_credentials",
  USER_REGISTRATION_FAILED_USER_EXISTS: "user.registration.failed.user_exists",
  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_REMOVED: "assignment.removed",
};

const MVP_EVENT_CATALOG = [
  EVENT_TYPES.TRANSACTION_CREATED,
  EVENT_TYPES.USER_ACCOUNT_CREATED,
  EVENT_TYPES.FIELD_CREATED,
  EVENT_TYPES.STAFF_CREATED,
  EVENT_TYPES.ANIMAL_CREATED,
  EVENT_TYPES.ANIMAL_ASSIGNED,
  EVENT_TYPES.MARKETPLACE_OFFER_CREATED,
  EVENT_TYPES.MARKETPLACE_OFFER_CANCELLED,
  EVENT_TYPES.MARKETPLACE_PURCHASE_COMPLETED,
  EVENT_TYPES.TRANSFER_COMPLETED,
  EVENT_TYPES.TRANSACTION_FAILED,
  EVENT_TYPES.USER_ACCOUNT_UPDATED,
  EVENT_TYPES.USER_ACCOUNT_DEACTIVATED,
  EVENT_TYPES.USER_ACCOUNT_REACTIVATED,
  EVENT_TYPES.USER_ACCOUNT_DELETED,
  EVENT_TYPES.USER_LOGIN_FAILED,
  EVENT_TYPES.USER_LOGIN_INVALID_CREDENTIALS,
  EVENT_TYPES.USER_REGISTRATION_FAILED_USER_EXISTS,
  EVENT_TYPES.FIELD_UPDATED,
  EVENT_TYPES.FIELD_DELETED,
  EVENT_TYPES.FARMLOG_POST_CREATED,
  EVENT_TYPES.FARMLOG_POST_UPDATED,
  EVENT_TYPES.FARMLOG_POST_DELETED,
  EVENT_TYPES.FARMLOG_POST_LIKED,
  EVENT_TYPES.FARMLOG_POST_FAVORITED,
  EVENT_TYPES.ASSIGNMENT_CREATED,
  EVENT_TYPES.ASSIGNMENT_REMOVED,
];

module.exports = {
  EVENT_TYPES,
  MVP_EVENT_CATALOG,
};
