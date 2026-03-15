/**
 * Event payload templates for triggering events from Kraken Dashboard.
 * Each template function generates realistic payload examples for testing.
 */

const PAYLOAD_TEMPLATES = {
  "transaction.created": {
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
  "user.account.created": {
    label: "User Account Created",
    description: "A new user account has been registered",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      username: overrides.username || `user_${Date.now()}`,
      ...overrides,
    }),
  },
  "field.created": {
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
  "staff.created": {
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
  "animal.created": {
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
  "animal.assigned": {
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
  "marketplace.offer.created": {
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
  "marketplace.purchase.completed": {
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
  "transfer.completed": {
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
  "user.login.failed": {
    label: "User Login Failed",
    description: "A login attempt has failed",
    template: (overrides = {}) => ({
      userId: overrides.userId || `user-${Date.now()}`,
      email: overrides.email || `user-${Date.now()}@example.com`,
      reason: overrides.reason || "invalid_credentials",
      attempts: overrides.attempts ?? 1,
      timestamp: overrides.timestamp || new Date().toISOString(),
      ...overrides,
    }),
  },
  "user.login.invalid_credentials": {
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
  "user.registration.failed.user_exists": {
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
};

const EVENT_TYPE_METADATA = {
  "transaction.created": {
    icon: "fa-money-bill",
    color: "#4CAF50",
    priority: "high",
  },
  "user.account.created": {
    icon: "fa-user-plus",
    color: "#2196F3",
    priority: "high",
  },
  "field.created": {
    icon: "fa-leaf",
    color: "#8BC34A",
    priority: "normal",
  },
  "staff.created": {
    icon: "fa-users",
    color: "#FF9800",
    priority: "normal",
  },
  "animal.created": {
    icon: "fa-paw",
    color: "#9C27B0",
    priority: "normal",
  },
  "animal.assigned": {
    icon: "fa-link",
    color: "#E91E63",
    priority: "normal",
  },
  "marketplace.offer.created": {
    icon: "fa-tag",
    color: "#00BCD4",
    priority: "normal",
  },
  "marketplace.purchase.completed": {
    icon: "fa-shopping-cart",
    color: "#4CAF50",
    priority: "high",
  },
  "transfer.completed": {
    icon: "fa-exchange-alt",
    color: "#4CAF50",
    priority: "high",
  },
  "user.login.failed": {
    icon: "fa-lock",
    color: "#F44336",
    priority: "high",
  },
  "user.login.invalid_credentials": {
    icon: "fa-user-lock",
    color: "#E53935",
    priority: "high",
  },
  "user.registration.failed.user_exists": {
    icon: "fa-user-xmark",
    color: "#EF6C00",
    priority: "normal",
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
