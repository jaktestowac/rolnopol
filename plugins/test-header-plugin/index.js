module.exports = {
  name: "test-header-plugin",
  order: 10,
  enabled: false,

  config: {
    headerName: "x-rolnopol-plugin-test",
    headerValue: "enabled",
  },

  onResponse({ res, config }) {
    const headerName = config?.headerName || "x-rolnopol-plugin-test";
    const headerValue = config?.headerValue || "enabled";

    if (!res.headersSent) {
      res.setHeader(headerName, headerValue);
    }
  },
};
