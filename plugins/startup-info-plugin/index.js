module.exports = {
  name: "startup-info-plugin",
  order: 5,
  enabled: false,

  config: {
    message: "startup-info-plugin initialized",
  },

  init({ logInfo, config }) {
    const message = config?.message || "startup-info-plugin initialized";
    logInfo(message, { plugin: "startup-info-plugin" });
  },
};
