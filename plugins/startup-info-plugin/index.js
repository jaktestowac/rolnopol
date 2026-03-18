module.exports = {
  name: "startup-info-plugin",
  order: 5,
  enabled: true,

  init({ logInfo, config }) {
    const message = config.message || "startup-info-plugin initialized";
    logInfo(message, { plugin: "startup-info-plugin" });
  },
};
