module.exports = {
  name: "barn-whisper-ping-plugin",
  order: 50,
  enabled: false,
  autoDiscoverable: false,

  config: {
    sigValue: "barn-whisper",
    whisper: "The barn doors only sing when the weather vane points toward mischief.",
    hoofbeats: 7,
  },

  onResponse({ req, responseBody, responseType, config }) {
    if (req.method !== "GET" || req.path !== "/api/v1/ping" || responseType !== "json") {
      return;
    }

    if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
      return;
    }

    const expectedSig = String(config.sigValue || "barn-whisper")
      .trim()
      .toLowerCase();
    const actualSig = String(req.query?.sig || "")
      .trim()
      .toLowerCase();

    if (actualSig !== expectedSig) {
      return;
    }

    const hoofbeats = Number.isFinite(Number(config.hoofbeats)) ? Number(config.hoofbeats) : 7;
    const whisper =
      typeof config.whisper === "string" && config.whisper.trim().length > 0
        ? config.whisper.trim()
        : "The barn doors only sing when the weather vane points toward mischief.";

    responseBody.meta = {
      ...(responseBody.meta || {}),
      easterEgg: {
        id: "barn-whisper-ping",
        whisper,
        hoofbeats,
      },
    };
  },
};
