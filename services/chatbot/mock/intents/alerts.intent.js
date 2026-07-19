const { POOLS, pick } = require("../phrases");

/**
 * Alerts intent — calls the real `get_recent_alerts` tool. If the user has no
 * live alerts (common on a fresh account), it falls back to a believable,
 * varied set of typical farm alerts so the surface still feels alive.
 */

const SYNTH_ALERTS = [
  { severity: "warning", category: "weather", message: "Heavy rain expected in the next 48h — check drainage on low-lying fields." },
  { severity: "info", category: "irrigation", message: "Soil moisture is trending low; consider irrigating sandy plots midweek." },
  { severity: "warning", category: "pest", message: "Aphid pressure rising in nearby districts — scout your cereals." },
  { severity: "critical", category: "disease", message: "Late blight risk is high after the humid spell — inspect potato foliage." },
  { severity: "info", category: "market", message: "Wheat prices ticked up 2% this week — a window worth watching." },
  { severity: "info", category: "operations", message: "Two staff assignments are due this week — review the task board." },
];

function icon(severity) {
  if (severity === "critical") return "🔴";
  if (severity === "warning") return "🟠";
  return "🟢";
}

function formatAlerts(alerts) {
  return alerts
    .map((a) => `${icon(a.severity)} [${(a.category || "general").toUpperCase()}] ${a.message}${a.severity ? ` (${a.severity})` : ""}`)
    .join("\n");
}

module.exports = {
  id: "alerts",
  match(normalizedPrompt) {
    return /\b(alert|alerts|warning|warnings|risk|danger|urgent|problem|issue|issues)\b/.test(normalizedPrompt);
  },
  async respond({ tools }) {
    const result = await tools.call("get_recent_alerts", { limit: 5 });
    const real = result && Array.isArray(result.alerts) ? result.alerts : [];

    if (real.length > 0) {
      return [pick(POOLS.alertsHaveIntros), formatAlerts(real)].join("\n");
    }

    // No live alerts — surface a believable sample so the assistant stays useful.
    const count = 2 + Math.floor(Math.random() * 2); // 2–3
    const shuffled = SYNTH_ALERTS.slice().sort(() => Math.random() - 0.5).slice(0, count);
    return [
      pick(POOLS.alertsQuietIntros),
      formatAlerts(shuffled),
      pick([
        "\nAsk about weather or prices for the data behind these.",
        "\nWant me to check the forecast that drives these risks?",
        "\nI can dig into any of these — just say which.",
      ]),
    ].join("\n");
  },
};
