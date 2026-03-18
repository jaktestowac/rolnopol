module.exports = {
  name: "auto-discoverable-plugin",
  order: 900,
  enabled: false,

  init({ logInfo, config }) {
    logInfo("auto-discoverable-plugin initialized", {
      plugin: "auto-discoverable-plugin",
      feature: config.feature || "example",
    });
  },
};
