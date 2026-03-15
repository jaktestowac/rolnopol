class InAppDispatcher {
  constructor(config = {}, helpers = {}) {
    this.storeDelayMs = config.storeDelayMs || 0;
    this.sleep = helpers.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async dispatch(notification) {
    if (this.storeDelayMs > 0) {
      await this.sleep(this.storeDelayMs);
    }

    return {
      success: true,
      channel: "in-app",
      deliveredAt: new Date().toISOString(),
      notificationId: notification.id,
    };
  }
}

module.exports = InAppDispatcher;
