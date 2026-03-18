module.exports = {
  name: "test-header-plugin",
  order: 10,
  enabled: true,

  onResponse({ res, config }) {
    const headerName = config.headerName || "x-rolnopol-plugin-test";
    const headerValue = config.headerValue || "enabled";

    if (!res.headersSent) {
      res.setHeader(headerName, headerValue);
    }
  },
};
