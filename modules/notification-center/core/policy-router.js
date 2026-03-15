class PolicyRouter {
  constructor(policies = {}) {
    this.policies = { ...policies };
  }

  registerPolicy(eventType, policy) {
    if (!eventType || !policy) return;
    this.policies[eventType] = policy;
  }

  resolve(event) {
    if (!event || typeof event.type !== "string") return null;
    return this.policies[event.type] || null;
  }
}

module.exports = PolicyRouter;
