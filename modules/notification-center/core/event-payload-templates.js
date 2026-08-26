/**
 * Event payload templates for triggering events from Kraken Dashboard.
 * Each template function generates realistic payload examples for testing.
 */

const { EVENT_TYPES } = require("./contracts");

const PAYLOAD_TEMPLATES = {
  [EVENT_TYPES.TRANSACTION_CREATED]: {
    label: "Transaction Created",
    description: "A financial transaction has been created in the system",
    template: (overrides = {}) => ({
      transactionId: overrides.transactionId || `txn-${Date.now()}`,
      amount: overrides.amount ?? 150.5,
      currency: overrides.currency || "ROL",
      type: overrides.type || "credit",
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_ACCOUNT_CREATED]: {
    label: "User Account Created",
    description: "A new user account has been registered",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      username: overrides.username || `user_${Date.now()}`,
      ...overrides,
    }),
  },
  [EVENT_TYPES.FIELD_CREATED]: {
    label: "Field Created",
    description: "A new agricultural field has been registered",
    template: (overrides = {}) => ({
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      name: overrides.name || `Field ${Math.floor(Math.random() * 100)}`,
      size: overrides.size ?? 50.5,
      location: overrides.location || "Region A",
      ...overrides,
    }),
  },
  [EVENT_TYPES.STAFF_CREATED]: {
    label: "Staff Created",
    description: "A new staff member has been added",
    template: (overrides = {}) => ({
      staffId: overrides.staffId || `staff-${Date.now()}`,
      name: overrides.name || `Staff Member ${Math.floor(Math.random() * 1000)}`,
      role: overrides.role || "Manager",
      email: overrides.email || `staff-${Date.now()}@example.com`,
      ...overrides,
    }),
  },
  [EVENT_TYPES.ANIMAL_CREATED]: {
    label: "Animal Created",
    description: "A new animal has been added to inventory",
    template: (overrides = {}) => ({
      animalId: overrides.animalId || `animal-${Date.now()}`,
      type: overrides.type || "cow",
      amount: overrides.amount ?? 5,
      breed: overrides.breed || "Angus",
      ...overrides,
    }),
  },
  [EVENT_TYPES.ANIMAL_ASSIGNED]: {
    label: "Animal Assigned",
    description: "An animal has been assigned to a field",
    template: (overrides = {}) => ({
      animalId: overrides.animalId || `animal-${Date.now()}`,
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      quantity: overrides.quantity ?? 1,
      assignedDate: overrides.assignedDate || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.MARKETPLACE_OFFER_CREATED]: {
    label: "Marketplace Offer Created",
    description: "A new offer has been listed in the marketplace",
    template: (overrides = {}) => ({
      offerId: overrides.offerId || `offer-${Date.now()}`,
      itemType: overrides.itemType || "vegetables",
      title: overrides.title || "Fresh Produce Bundle",
      price: overrides.price ?? 99.99,
      quantity: overrides.quantity ?? 10,
      ...overrides,
    }),
  },
  [EVENT_TYPES.MARKETPLACE_PURCHASE_COMPLETED]: {
    label: "Marketplace Purchase Completed",
    description: "A purchase transaction has been completed",
    template: (overrides = {}) => ({
      purchaseId: overrides.purchaseId || `purchase-${Date.now()}`,
      offerId: overrides.offerId || `offer-${Date.now()}`,
      itemType: overrides.itemType || "vegetables",
      price: overrides.price ?? 99.99,
      buyerId: overrides.buyerId || `buyer-${Date.now()}`,
      ...overrides,
    }),
  },
  [EVENT_TYPES.TRANSFER_COMPLETED]: {
    label: "Transfer Completed",
    description: "A funds transfer has been successfully completed",
    template: (overrides = {}) => ({
      transferId: overrides.transferId || `transfer-${Date.now()}`,
      amount: overrides.amount ?? 500.0,
      currency: overrides.currency || "ROL",
      fromUserId: overrides.fromUserId || "system",
      toUserId: overrides.toUserId || `user-${Date.now()}`,
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_LOGIN_FAILED]: {
    label: "User Login Failed",
    description: "A login attempt has been failed",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      reason: overrides.reason || "invalid_credentials",
      attempts: overrides.attempts ?? 1,
      timestamp: overrides.timestamp || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_LOGIN_INVALID_CREDENTIALS]: {
    label: "Invalid Login Credentials",
    description: "A login attempt failed due to invalid credentials",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      attemptedEmail: overrides.attemptedEmail || `user-${Date.now()}@example.com`,
      reason: overrides.reason || "invalid_credentials",
      attempts: overrides.attempts ?? 1,
      timestamp: overrides.timestamp || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_REGISTRATION_FAILED_USER_EXISTS]: {
    label: "Registration Failed: User Exists",
    description: "A registration attempt failed because the user already exists",
    template: (overrides = {}) => ({
      existingUserId: overrides.existingUserId || `user-${Date.now()}`,
      attemptedEmail: overrides.attemptedEmail || `user-${Date.now()}@example.com`,
      reason: overrides.reason || "user_already_exists",
      timestamp: overrides.timestamp || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FARMLOG_POST_CREATED]: {
    label: "Farmlog Post Created",
    description: "A new post was created in the Farmlog",
    template: (overrides = {}) => ({
      postId: overrides.postId || `post-${Date.now()}`,
      blogId: overrides.blogId || `blog-${Date.now()}`,
      authorId: overrides.authorId || `user-${Date.now()}`,
      title: overrides.title || "New Farmlog Post",
      slug: overrides.slug || "new-farmlog-post",
      createdAt: overrides.createdAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FARMLOG_POST_UPDATED]: {
    label: "Farmlog Post Updated",
    description: "A post in the Farmlog was updated",
    template: (overrides = {}) => ({
      postId: overrides.postId || `post-${Date.now()}`,
      blogId: overrides.blogId || `blog-${Date.now()}`,
      authorId: overrides.authorId || `user-${Date.now()}`,
      changes: overrides.changes || { title: "Updated title" },
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FARMLOG_POST_DELETED]: {
    label: "Farmlog Post Deleted",
    description: "A post in the Farmlog was deleted",
    template: (overrides = {}) => ({
      postId: overrides.postId || `post-${Date.now()}`,
      blogId: overrides.blogId || `blog-${Date.now()}`,
      authorId: overrides.authorId || `user-${Date.now()}`,
      deletedAt: overrides.deletedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FARMLOG_POST_LIKED]: {
    label: "Farmlog Post Liked",
    description: "A Farmlog post was liked by a user",
    template: (overrides = {}) => ({
      postId: overrides.postId || `post-${Date.now()}`,
      blogId: overrides.blogId || `blog-${Date.now()}`,
      likedByUserId: overrides.likedByUserId || `user-${Date.now()}`,
      likeId: overrides.likeId || `like-${Date.now()}`,
      occurredAt: overrides.occurredAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FARMLOG_POST_FAVORITED]: {
    label: "Farmlog Post Favorited",
    description: "A Farmlog post was added to favorites",
    template: (overrides = {}) => ({
      postId: overrides.postId || `post-${Date.now()}`,
      blogId: overrides.blogId || `blog-${Date.now()}`,
      userId: overrides.userId || `user-${Date.now()}`,
      favoriteId: overrides.favoriteId || `fav-${Date.now()}`,
      occurredAt: overrides.occurredAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_ACCOUNT_UPDATED]: {
    label: "User Account Updated",
    description: "An existing user account has been modified",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      changes: overrides.changes || { username: "updated_username" },
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_ACCOUNT_DEACTIVATED]: {
    label: "User Account Deactivated",
    description: "A user account has been deactivated by an administrator",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      reason: overrides.reason || "admin_action",
      deactivatedAt: overrides.deactivatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_ACCOUNT_REACTIVATED]: {
    label: "User Account Reactivated",
    description: "A previously deactivated user account has been restored",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      reactivatedAt: overrides.reactivatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.USER_ACCOUNT_DELETED]: {
    label: "User Account Deleted",
    description: "A user account has been permanently removed",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      deletedAt: overrides.deletedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FIELD_UPDATED]: {
    label: "Field Updated",
    description: "An agricultural field has been modified",
    template: (overrides = {}) => ({
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      name: overrides.name || `Field ${Math.floor(Math.random() * 100)}`,
      changes: overrides.changes || { area: 75.25 },
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.FIELD_DELETED]: {
    label: "Field Deleted",
    description: "An agricultural field has been removed",
    template: (overrides = {}) => ({
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      name: overrides.name || `Field ${Math.floor(Math.random() * 100)}`,
      deletedAt: overrides.deletedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.STAFF_UPDATED]: {
    label: "Staff Updated",
    description: "An existing staff member has been modified",
    template: (overrides = {}) => ({
      staffId: overrides.staffId || `staff-${Date.now()}`,
      name: overrides.name || `Staff Member ${Math.floor(Math.random() * 1000)}`,
      surname: overrides.surname || "Kowalski",
      changes: overrides.changes || { position: "Supervisor" },
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.STAFF_DELETED]: {
    label: "Staff Deleted",
    description: "A staff member has been removed",
    template: (overrides = {}) => ({
      staffId: overrides.staffId || `staff-${Date.now()}`,
      deletedAt: overrides.deletedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.ANIMAL_UPDATED]: {
    label: "Animal Updated",
    description: "An animal record has been modified",
    template: (overrides = {}) => ({
      animalId: overrides.animalId || `animal-${Date.now()}`,
      type: overrides.type || "cow",
      amount: overrides.amount ?? 5,
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      changes: overrides.changes || { amount: 7 },
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.ANIMAL_DELETED]: {
    label: "Animal Deleted",
    description: "An animal has been removed from inventory",
    template: (overrides = {}) => ({
      animalId: overrides.animalId || `animal-${Date.now()}`,
      deletedAt: overrides.deletedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.ASSIGNMENT_CREATED]: {
    label: "Assignment Created",
    description: "A staff member has been assigned to a field",
    template: (overrides = {}) => ({
      assignmentId: overrides.assignmentId || `assignment-${Date.now()}`,
      staffId: overrides.staffId || `staff-${Date.now()}`,
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      createdAt: overrides.createdAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.ASSIGNMENT_REMOVED]: {
    label: "Assignment Removed",
    description: "A staff-to-field assignment has been removed",
    template: (overrides = {}) => ({
      assignmentId: overrides.assignmentId || `assignment-${Date.now()}`,
      staffId: overrides.staffId || `staff-${Date.now()}`,
      fieldId: overrides.fieldId || `field-${Date.now()}`,
      removedAt: overrides.removedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.MARKETPLACE_OFFER_CANCELLED]: {
    label: "Marketplace Offer Cancelled",
    description: "A marketplace offer has been withdrawn",
    template: (overrides = {}) => ({
      offerId: overrides.offerId || `offer-${Date.now()}`,
      itemType: overrides.itemType || "vegetables",
      reason: overrides.reason || "cancelled_by_seller",
      cancelledAt: overrides.cancelledAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.TRANSACTION_FAILED]: {
    label: "Transaction Failed",
    description: "A financial transaction could not be completed",
    template: (overrides = {}) => ({
      transactionId: overrides.transactionId || `txn-${Date.now()}`,
      amount: overrides.amount ?? 150.5,
      currency: overrides.currency || "ROL",
      reason: overrides.reason || "insufficient_funds",
      failedAt: overrides.failedAt || new Date().toISOString(),
      ...overrides,
    }),
  },
  [EVENT_TYPES.CREW_LEAVE_APPROVED]: {
    label: "Crew Leave Approved",
    description: "A crew member's leave request has been approved",
    template: (overrides = {}) => ({
      requestId: overrides.requestId || `leave-${Date.now()}`,
      staffId: overrides.staffId || `staff-${Date.now()}`,
      leaveType: overrides.leaveType || "annual",
      from: overrides.from || new Date().toISOString().slice(0, 10),
      to: overrides.to || new Date().toISOString().slice(0, 10),
      workingDays: overrides.workingDays ?? 1,
      ...overrides,
    }),
  },
  [EVENT_TYPES.CREW_LEAVE_REJECTED]: {
    label: "Crew Leave Rejected",
    description: "A crew member's leave request has been rejected",
    template: (overrides = {}) => ({
      requestId: overrides.requestId || `leave-${Date.now()}`,
      staffId: overrides.staffId || `staff-${Date.now()}`,
      leaveType: overrides.leaveType || "annual",
      from: overrides.from || new Date().toISOString().slice(0, 10),
      to: overrides.to || new Date().toISOString().slice(0, 10),
      reason: overrides.reason || "Cover is already thin that week.",
      ...overrides,
    }),
  },
  [EVENT_TYPES.CREW_EMPLOYMENT_ENDED]: {
    label: "Crew Employment Ended",
    description: "An end date has been recorded for a crew member",
    template: (overrides = {}) => ({
      staffId: overrides.staffId || `staff-${Date.now()}`,
      lastDay: overrides.lastDay || new Date().toISOString().slice(0, 10),
      reason: overrides.reason || "end_of_season",
      ...overrides,
    }),
  },
  [EVENT_TYPES.CREW_CERTIFICATION_REVOKED]: {
    label: "Crew Certification Revoked",
    description: "A crew member's certification has been revoked, which may block tool issuance",
    template: (overrides = {}) => ({
      certificationId: overrides.certificationId || `cert-${Date.now()}`,
      staffId: overrides.staffId || `staff-${Date.now()}`,
      courseName: overrides.courseName || "Chainsaw Operation",
      reason: overrides.reason || "Assessment result overturned on review.",
      gapCount: overrides.gapCount ?? 1,
      ...overrides,
    }),
  },
  [EVENT_TYPES.CREW_TOOL_ISSUED]: {
    label: "Crew Tool Issued",
    description: "A tool has been issued to a crew member",
    template: (overrides = {}) => ({
      issuanceId: overrides.issuanceId || `issuance-${Date.now()}`,
      toolId: overrides.toolId || `tool-${Date.now()}`,
      toolName: overrides.toolName || "Chainsaw",
      staffId: overrides.staffId || `staff-${Date.now()}`,
      dueBack: overrides.dueBack || new Date().toISOString().slice(0, 10),
      ...overrides,
    }),
  },
  [EVENT_TYPES.CREW_TOOL_RETURNED]: {
    label: "Crew Tool Returned",
    description: "A tool has come back from a crew member",
    template: (overrides = {}) => ({
      issuanceId: overrides.issuanceId || `issuance-${Date.now()}`,
      toolId: overrides.toolId || `tool-${Date.now()}`,
      toolName: overrides.toolName || "Chainsaw",
      staffId: overrides.staffId || `staff-${Date.now()}`,
      condition: overrides.condition || "good",
      late: overrides.late ?? false,
      ...overrides,
    }),
  },
};

const EVENT_TYPE_METADATA = {
  [EVENT_TYPES.TRANSACTION_CREATED]: {
    icon: "fa-money-bill",
    color: "#4CAF50",
    priority: "high",
  },
  [EVENT_TYPES.USER_ACCOUNT_CREATED]: {
    icon: "fa-user-plus",
    color: "#2196F3",
    priority: "high",
  },
  [EVENT_TYPES.FIELD_CREATED]: {
    icon: "fa-leaf",
    color: "#8BC34A",
    priority: "normal",
  },
  [EVENT_TYPES.STAFF_CREATED]: {
    icon: "fa-users",
    color: "#FF9800",
    priority: "normal",
  },
  [EVENT_TYPES.ANIMAL_CREATED]: {
    icon: "fa-paw",
    color: "#9C27B0",
    priority: "normal",
  },
  [EVENT_TYPES.ANIMAL_ASSIGNED]: {
    icon: "fa-link",
    color: "#E91E63",
    priority: "normal",
  },
  [EVENT_TYPES.MARKETPLACE_OFFER_CREATED]: {
    icon: "fa-tag",
    color: "#00BCD4",
    priority: "normal",
  },
  [EVENT_TYPES.MARKETPLACE_PURCHASE_COMPLETED]: {
    icon: "fa-shopping-cart",
    color: "#4CAF50",
    priority: "high",
  },
  [EVENT_TYPES.TRANSFER_COMPLETED]: {
    icon: "fa-exchange-alt",
    color: "#4CAF50",
    priority: "high",
  },
  [EVENT_TYPES.USER_LOGIN_FAILED]: {
    icon: "fa-lock",
    color: "#F44336",
    priority: "high",
  },
  [EVENT_TYPES.USER_LOGIN_INVALID_CREDENTIALS]: {
    icon: "fa-user-lock",
    color: "#E53935",
    priority: "high",
  },
  [EVENT_TYPES.USER_REGISTRATION_FAILED_USER_EXISTS]: {
    icon: "fa-user-xmark",
    color: "#EF6C00",
    priority: "normal",
  },
  [EVENT_TYPES.FARMLOG_POST_CREATED]: {
    icon: "fa-pen",
    color: "#3F51B5",
    priority: "normal",
  },
  [EVENT_TYPES.FARMLOG_POST_UPDATED]: {
    icon: "fa-edit",
    color: "#2196F3",
    priority: "low",
  },
  [EVENT_TYPES.FARMLOG_POST_DELETED]: {
    icon: "fa-trash",
    color: "#F44336",
    priority: "normal",
  },
  [EVENT_TYPES.FARMLOG_POST_LIKED]: {
    icon: "fa-heart",
    color: "#E91E63",
    priority: "normal",
  },
  [EVENT_TYPES.FARMLOG_POST_FAVORITED]: {
    icon: "fa-star",
    color: "#FFEB3B",
    priority: "normal",
  },
  [EVENT_TYPES.USER_ACCOUNT_UPDATED]: {
    icon: "fa-user-pen",
    color: "#2196F3",
    priority: "normal",
  },
  [EVENT_TYPES.USER_ACCOUNT_DEACTIVATED]: {
    icon: "fa-user-slash",
    color: "#FF5722",
    priority: "high",
  },
  [EVENT_TYPES.USER_ACCOUNT_REACTIVATED]: {
    icon: "fa-user-check",
    color: "#4CAF50",
    priority: "high",
  },
  [EVENT_TYPES.USER_ACCOUNT_DELETED]: {
    icon: "fa-user-minus",
    color: "#F44336",
    priority: "high",
  },
  [EVENT_TYPES.FIELD_UPDATED]: {
    icon: "fa-pen-to-square",
    color: "#8BC34A",
    priority: "normal",
  },
  [EVENT_TYPES.FIELD_DELETED]: {
    icon: "fa-trash",
    color: "#F44336",
    priority: "normal",
  },
  [EVENT_TYPES.STAFF_UPDATED]: {
    icon: "fa-user-gear",
    color: "#FF9800",
    priority: "normal",
  },
  [EVENT_TYPES.STAFF_DELETED]: {
    icon: "fa-user-xmark",
    color: "#F44336",
    priority: "normal",
  },
  [EVENT_TYPES.ANIMAL_UPDATED]: {
    icon: "fa-pen",
    color: "#9C27B0",
    priority: "normal",
  },
  [EVENT_TYPES.ANIMAL_DELETED]: {
    icon: "fa-trash",
    color: "#F44336",
    priority: "normal",
  },
  [EVENT_TYPES.ASSIGNMENT_CREATED]: {
    icon: "fa-link",
    color: "#3F51B5",
    priority: "normal",
  },
  [EVENT_TYPES.ASSIGNMENT_REMOVED]: {
    icon: "fa-link-slash",
    color: "#795548",
    priority: "normal",
  },
  [EVENT_TYPES.MARKETPLACE_OFFER_CANCELLED]: {
    icon: "fa-ban",
    color: "#FF5722",
    priority: "normal",
  },
  [EVENT_TYPES.TRANSACTION_FAILED]: {
    icon: "fa-circle-exclamation",
    color: "#F44336",
    priority: "high",
  },
  [EVENT_TYPES.CREW_LEAVE_APPROVED]: {
    icon: "fa-calendar-check",
    color: "#4CAF50",
    priority: "normal",
  },
  [EVENT_TYPES.CREW_LEAVE_REJECTED]: {
    icon: "fa-calendar-xmark",
    color: "#FF5722",
    priority: "normal",
  },
  [EVENT_TYPES.CREW_EMPLOYMENT_ENDED]: {
    icon: "fa-door-open",
    color: "#795548",
    priority: "high",
  },
  [EVENT_TYPES.CREW_CERTIFICATION_REVOKED]: {
    icon: "fa-certificate",
    color: "#F44336",
    priority: "high",
  },
  [EVENT_TYPES.CREW_TOOL_ISSUED]: {
    icon: "fa-screwdriver-wrench",
    color: "#607D8B",
    priority: "low",
  },
  [EVENT_TYPES.CREW_TOOL_RETURNED]: {
    icon: "fa-rotate-left",
    color: "#607D8B",
    priority: "low",
  },
};

function getPayloadTemplate(eventType, overrides = {}) {
  const template = PAYLOAD_TEMPLATES[eventType];
  if (!template) {
    return null;
  }
  return template.template(overrides);
}

function getAllEventTypes() {
  return Object.keys(PAYLOAD_TEMPLATES);
}

function getEventMetadata(eventType) {
  return EVENT_TYPE_METADATA[eventType] || null;
}

module.exports = {
  PAYLOAD_TEMPLATES,
  EVENT_TYPE_METADATA,
  getPayloadTemplate,
  getAllEventTypes,
  getEventMetadata,
};
