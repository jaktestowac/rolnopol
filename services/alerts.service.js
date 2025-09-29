const { logError, logDebug, logInfo } = require("../helpers/logger-api");
const { SPECIAL_ALERTS } = require("./special-alerts.data");

const DEFAULT_CONFIG = {
  // Probability distribution for how many alerts to generate per day.
  // Keys are counts, values are probabilities. They will be normalized if needed.
  countsDistribution: { 0: 0.7, 1: 0.2, 2: 0.05, 3: 0.01 },

  // Probability of generating a special bizarre alert (0.0 to 1.0)
  specialAlertsProbability: 0.001, // 0.1% chance per day

  // Base category weights (relative). Higher = more likely.
  // You can override globally or per-month (1..12) in categoryWeightsByMonth.
  categoryWeights: {
    weather: 5,
    irrigation: 3,
    disease: 3,
    pest: 3,
    soil: 2,
    machinery: 2,
    livestock: 2,
    logistics: 2,
    market: 1,
  },

  // Optional fine-grained per-month overrides (example shows stronger weather in summer)
  // Only specify months you want to tweak. Omitted months fall back to categoryWeights.
  categoryWeightsByMonth: {
    // 7: { weather: 6, irrigation: 4 }, // July example
    // 10: { weather: 3, disease: 2 },   // October example
  },
};

const TITLES_EXTRA = {
  weather: [
    "Cold Snap Advisory",
    "Prolonged Drought Risk",
    "Flood Risk (Rivers/Lowlands)",
    "Dense Fog Advisory",
    "Tornado Watch",
    "Blizzard Warning",
    "Heatwave Alert",
    "Heavy Rain Expected",
    "High Wind Advisory",
    "Hail Risk",
  ],
  irrigation: [
    "High Evapotranspiration (ETo) Today",
    "Soil Moisture Below Target",
    "Night Irrigation Recommended",
    "Irrigation System Pressure Drop",
  ],
  disease: ["Disease Risk: Powdery Mildew", "Disease Risk: Sclerotinia", "Disease Risk: Leaf Rust", "Disease Risk: Septoria"],
  pest: ["Pest Pressure: Armyworm", "Pest Pressure: Fruit Fly"],
  soil: [
    "Soil Compaction Warning",
    "Topsoil Erosion Risk",
    "Soil pH Out of Range",
    "Low Organic Matter Advisory",
    "Crusting Risk After Rain",
  ],
  machinery: [
    "Sprayer Nozzle Check Recommended",
    "Combine Pre-Harvest Inspection",
    "Tractor Tire Pressure Advisory",
    "Hydraulic Leak Inspection",
  ],
  livestock: [
    "Cold Stress Risk (Livestock)",
    "Biosecurity Advisory (Outbreak Nearby)",
    "Water Supply Quality Check",
    "Ventilation Performance Advisory",
  ],
  logistics: ["Muddy Field Access", "Wind Drift Risk Near Roads", "Low Visibility on Rural Routes", "Bridge/Track Weight Limit Advisory"],
  market: [
    "Feed Supply Shortage Advisory",
    "Fertilizer Price Spike",
    "Storage Capacity Planning Reminder",
    "New Subsidy/Grant Deadline",
    "Export Ban/Trade Disruption Alert",
    "Fuel Cost Increase Advisory",
    "Insurance Policy Review Reminder",
    "Loan Interest Rate Change",
  ],
};

/**
 * AlertsService (agro-focused)
 * Deterministically generates realistic farm alerts based on a date seed (YYYY-MM-DD)
 * Public API unchanged: generateAlertsForDate, getHistory, getUpcoming
 */
class AlertsService {
  constructor(profile = {}, config = {}) {
    // Optional farm profile to make alerts feel more relevant
    this.profile = {
      region: profile.region || "PL-24", // ISO-like region code
      farmName: profile.farmName || "Farm",
      crops: profile.crops || ["wheat", "corn", "potato", "rapeseed"],
      livestock: profile.livestock || ["cattle", "sheep", "pigs", "goats", "chickens"],
      // typical field soil types used in some heuristics
      soils: profile.soils || ["loam", "sandy_loam", "clay_loam", "silt_loam"],
    };

    // Merge user config with defaults
    this.config = this._mergeConfig(DEFAULT_CONFIG, config);

    // Core categories tailored to agro
    this.categories = [
      "weather", // severe weather affecting work windows and safety
      "irrigation", // water deficit / ETo / soil moisture
      "disease", // blight, mildew, rust
      "pest", // aphids, beetles, wireworms
      "soil", // compaction, erosion, pH, saturation
      "machinery", // service windows before peak loads
      "livestock", // heat stress, biosecurity
      "logistics", // field access, harvest windows, wind drift
      "market", // simple market nudges
    ];

    this.severities = ["low", "medium", "high", "critical"];
  }

  _mergeConfig(def, user) {
    const deep = (a, b) => {
      const out = Array.isArray(a) ? [...a] : { ...a };
      for (const k of Object.keys(b || {})) {
        if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) {
          out[k] = deep(a[k], b[k]);
        } else {
          out[k] = b[k];
        }
      }
      return out;
    };
    const merged = deep(def, user);

    // normalize countsDistribution
    const cd = merged.countsDistribution || {};
    const sum = Object.values(cd).reduce((s, x) => s + Number(x || 0), 0) || 1;
    for (const k of Object.keys(cd)) cd[k] = Number(cd[k]) / sum;
    logDebug(`Normalized countsDistribution: ${JSON.stringify(cd)} (original sum: ${sum})`);

    return merged;
  }

  _pickWeightedObj(rnd, obj) {
    // obj: {key: weight, ...}
    const entries = Object.entries(obj).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = rnd() * total;
    for (const [k, w] of entries) {
      if ((x -= w) <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  // ---------- utils ----------
  _hash32(str) {
    let h = 2166136261 >>> 0; // FNV-1a basis
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  _mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  _pick(rnd, arr) {
    return arr[Math.floor(rnd() * arr.length)];
  }

  _weighted(rnd, items) {
    // items: [{value, w}]
    const total = items.reduce((s, it) => s + it.w, 0);
    let x = rnd() * total;
    for (const it of items) {
      if ((x -= it.w) <= 0) return it.value;
    }
    return items[items.length - 1].value;
  }

  _clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  _toISODate(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    return d.toISOString().slice(0, 10);
  }

  _parseDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }
    const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
    const date = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(date.getTime())) {
      throw new Error("Invalid date value");
    }
    return date;
  }

  _monthSeasonWeights(monthIdx /* 0-11 */) {
    // Rough PL/EU seasonality
    const m = monthIdx + 1;
    return {
      weather: this._clamp([1, 1, 2, 3, 3, 3, 4, 4, 3, 3, 2, 1][monthIdx], 1, 4),
      irrigation: [0, 0, 1, 2, 3, 4, 5, 5, 3, 1, 0, 0][monthIdx],
      disease: [0, 1, 2, 3, 4, 4, 5, 5, 4, 2, 1, 0][monthIdx],
      pest: [0, 0, 1, 2, 4, 5, 5, 5, 3, 1, 0, 0][monthIdx],
      soil: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3][monthIdx],
      machinery: [2, 2, 2, 2, 3, 3, 3, 3, 3, 2, 2, 2][monthIdx],
      livestock: [1, 1, 1, 2, 2, 3, 4, 4, 2, 1, 1, 1][monthIdx],
      logistics: [1, 1, 1, 2, 3, 3, 3, 3, 3, 2, 1, 1][monthIdx],
      market: [1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1][monthIdx],
      // special cold snaps Apr/Oct
      frostBonus: m === 4 || m === 10 ? 1 : 0,
    };
  }

  _severityFromRisk(rnd, base /* 0..1 */) {
    const bump = base + rnd() * 0.25;
    return this._weighted(rnd, [
      { value: "low", w: this._clamp(1 - bump, 0.05, 0.6) * 100 },
      { value: "medium", w: this._clamp(0.4 + bump * 0.8, 0.2, 0.8) * 100 },
      { value: "high", w: this._clamp(bump * 0.9, 0.1, 0.6) * 100 },
      { value: "critical", w: this._clamp((bump - 0.6) * 1.2, 0, 0.4) * 100 },
    ]);
  }

  _randInt(rnd, min, max) {
    return Math.floor(rnd() * (max - min + 1)) + min;
  }

  _formatNumber(x, digits = 0) {
    return Number(x).toFixed(digits);
  }

  _pickAltTitle(rnd, category, currentTitle) {
    const list = TITLES_EXTRA[category] || [];
    if (!list.length || rnd() < 0.6) return currentTitle;
    return list[Math.floor(rnd() * list.length)];
  }

  // ---------- generators per category ----------
  _buildWeather(rnd, monthIdx) {
    // choose a realistic weather hazard based on season
    const season = this._monthSeasonWeights(monthIdx);
    const hazards = [
      { key: "frost", w: monthIdx === 3 || monthIdx === 9 ? 3 : (monthIdx <= 1 || monthIdx === 11 ? 2 : 0) + season.frostBonus },
      { key: "hail", w: [0, 0, 1, 2, 3, 3, 4, 4, 2, 1, 0, 0][monthIdx] },
      { key: "storm", w: [1, 1, 2, 3, 4, 4, 5, 5, 4, 2, 1, 1][monthIdx] },
      { key: "heat", w: [0, 0, 0, 1, 2, 3, 5, 5, 3, 1, 0, 0][monthIdx] },
      { key: "heavy_rain", w: [1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 2, 2][monthIdx] },
      { key: "wind", w: [2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3][monthIdx] },
      { key: "tornado", w: [0, 0, 0, 1, 2, 3, 4, 4, 2, 1, 0, 0][monthIdx] }, // Spring to summer in PL/EU
      { key: "blizzard", w: [3, 3, 2, 1, 0, 0, 0, 0, 0, 1, 2, 3][monthIdx] }, // Winter months
      { key: "drought", w: [0, 0, 0, 1, 2, 3, 4, 4, 3, 1, 0, 0][monthIdx] }, // Summer
      { key: "fog", w: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1][monthIdx] }, // Year-round, low weight
      { key: "hail", w: [0, 0, 1, 2, 3, 3, 4, 4, 2, 1, 0, 0][monthIdx] }, // Spring to summer in PL/EU
      { key: "severe_weather", w: [0, 0, 1, 2, 3, 3, 4, 4, 2, 1, 0, 0][monthIdx] }, // Spring to summer in PL/EU
      { key: "flood", w: [0, 0, 1, 2, 3, 3, 4, 4, 2, 1, 0, 0][monthIdx] }, // Spring to summer in PL/EU
      { key: "wildfire", w: [0, 0, 0, 1, 2, 3, 4, 4, 3, 1, 0, 0][monthIdx] }, // Summer
    ].filter((h) => h.w > 0);

    const hazardsObj = {};
    hazards.forEach((h) => (hazardsObj[h.key] = h.w));
    const type = this._pickWeightedObj(rnd, hazardsObj);
    let title,
      details = {},
      action;

    switch (type) {
      case "frost": {
        const minT = this._randInt(rnd, -4, 1);
        title = "Frost Warning";
        details = { minTempC: minT, window: "02:00–06:00" };
        action = "Protect sensitive crops (covers/fleece), delay early-morning spraying.";
        break;
      }
      case "storm": {
        const rain = this._randInt(rnd, 15, 60);
        const gust = this._randInt(rnd, 15, 28); // m/s // gust is the wind speed during the storm
        title = "Thunderstorm Watch";
        details = { rainMM: rain, gust_ms: gust, lightning: true };
        action = "Secure loose items, avoid field work; check drainage near low spots.";
        break;
      }
      case "heat": {
        const t = this._randInt(rnd, 30, 36);
        title = "Heatwave Alert";
        details = { maxTempC: t, uvIndex: this._randInt(rnd, 7, 10) };
        action = "Irrigate early/late; adjust livestock shade & water; avoid mid-day sprays.";
        break;
      }
      case "heavy_rain": {
        const rain = this._randInt(rnd, 20, 80);
        title = "Heavy Rain Expected";
        details = { rainMM: rain, runoffRisk: rain > 50 ? "high" : "moderate" };
        action = "Protect seed/inputs; avoid soil compaction; check ditch inlets.";
        break;
      }
      case "tornado": {
        const fScale = this._pick(rnd, ["EF0", "EF1", "EF2", "EF3"]);
        title = "Tornado Watch";
        details = { fujitaScale: fScale, pathWidth: this._randInt(rnd, 100, 500) + "m" };
        const possibleActions = [
          "Secure livestock and equipment; monitor weather updates; avoid open fields.",
          "Have a plan for sheltering in place. Take cover in a sturdy building.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      case "blizzard": {
        const snow = this._randInt(rnd, 10, 50);
        const wind = this._randInt(rnd, 20, 40);
        title = "Blizzard Warning";
        details = { snowCM: snow, wind_ms: wind };
        action = "Delay field work; ensure livestock shelter; check power/fuel supplies.";
        break;
      }
      case "drought": {
        const deficit = this._randInt(rnd, 20, 60);
        title = "Drought Conditions";
        details = { waterDeficitMM: deficit, durationDays: this._randInt(rnd, 7, 21) };
        action = "Implement water conservation; prioritize irrigation; monitor crop stress.";
        break;
      }
      case "flood": {
        const rain = this._randInt(rnd, 30, 100);
        title = "Flood Warning";
        details = { rainMM: rain, floodRisk: "high" };
        const possibleActions = [
          "Evacuate low-lying areas; secure property.",
          "Take shelter in a sturdy building and prepare emergency supplies.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      case "hail": {
        const hailSize = this._pick(rnd, ["pea", "marble", "cherry"]);
        title = "Hail Risk";
        details = { hailSize, stormProb: this._randInt(rnd, 40, 80) + "%" };
        const possibleActions = [
          "Move machinery under cover; postpone harvest/late sprays.",
          "Ensure livestock have shelter; protect sensitive crops if possible.",
          "Monitor weather updates and alerts. Take shelter if necessary.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      case "severe_weather": {
        title = "Severe Weather Alert";
        details = { severity: "high" };
        const possibleActions = [
          "Stay indoors; avoid travel.",
          "Monitor weather updates regularly.",
          "Prepare emergency supplies and a communication plan.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      case "fog": {
        title = "Fog Advisory";
        details = { visibility: this._randInt(rnd, 50, 100) + "m" };
        const possibleActions = [
          "Reduce speed; use fog lights.",
          "Avoid sudden stops; increase following distance.",
          "Use low beam headlights.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      case "wind": {
        title = "High Wind Advisory";
        details = { windSpeed: this._randInt(rnd, 20, 40) + " km/h" };
        const possibleActions = [
          "Secure loose objects; avoid travel if possible.",
          "Monitor weather updates regularly.",
          "Prepare for potential power outages.",
          "Have a plan for sheltering in place.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      case "wildfire": {
        title = "Wildfire Risk";
        details = { riskLevel: this._randInt(rnd, 1, 5) };
        const possibleActions = [
          "Create defensible space around properties.",
          "Have an evacuation plan ready.",
          "Monitor local fire restrictions.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
      default: {
        const gust = this._randInt(rnd, 12, 24);
        title = "Wind Gust Warning";
        details = { gust_ms: gust, driftRisk: "high" };
        const possibleActions = [
          "Secure loose objects; avoid travel if possible.",
          "Monitor weather updates regularly.",
          "Prepare for potential power outages.",
          "Have a plan for sheltering in place.",
        ];
        action = this._pick(rnd, possibleActions);
        break;
      }
    }
    title = this._pickAltTitle(rnd, "weather", title);

    return { title, message: this._finalizeMsg("weather", details, action) };
  }

  _buildIrrigation(rnd, monthIdx) {
    const eto = this._randInt(rnd, 3, 7) / 10; // ETo in mm/h (simplified)
    const deficit = this._randInt(rnd, 10, 45); // mm over last days
    const soil = this._pick(rnd, this.profile.soils);
    let title = deficit > 30 ? "Irrigation Deficit Rising" : "Irrigation Advisory";
    title = this._pickAltTitle(rnd, "irrigation", title);
    const action =
      deficit > 30
        ? "Plan watering within 24h; prioritize shallow-rooted crops."
        : "Monitor soil probes; consider night irrigation to reduce evap.";
    return {
      title,
      message: this._finalizeMsg("irrigation", { eto_mm_h: eto, deficitMM: deficit, soil }, action),
    };
  }

  _buildDisease(rnd, monthIdx) {
    const crop = this._pick(rnd, this.profile.crops);
    const diseaseByCrop = {
      potato: ["late blight", "early blight", "tuber blight"],
      wheat: ["leaf rust", "septoria", "stem rust", "yellow rust"],
      corn: ["northern corn leaf blight", "gray leaf spot"],
      rapeseed: ["sclerotinia", "powdery mildew"],
      barley: ["powdery mildew", "net blotch"],
      soybeans: ["frogeye leaf spot", "brown spot"],
      canola: ["blackleg", "sclerotinia"],
      cotton: ["boll rot", "leaf spot"],
      peanuts: ["leaf spot", "stem rot", "pod rot"],
      sugarbeets: ["leaf spot", "root rot"],
      mixed: ["powdery mildew", "gray leaf spot"],
    };
    const name = this._pick(rnd, diseaseByCrop[crop] || ["powdery mildew"]);
    const risk = this._randInt(rnd, 40, 90);
    let title = `Disease Risk: ${name}`;
    title = this._pickAltTitle(rnd, "disease", title);
    const action =
      risk >= 70
        ? `Check spray window in next 12–24h; verify mode of action for ${crop}.`
        : "Scout hotspots; keep canopy dry where possible.";
    return {
      title,
      message: this._finalizeMsg("disease", { crop, name, risk: risk + "%" }, action),
    };
  }

  _buildPest(rnd) {
    const crop = this._pick(rnd, this.profile.crops);
    const pest = this._pick(rnd, ["aphids", "flea beetle", "wireworm", "leaf miner"]);
    const trap = this._randInt(rnd, 5, 60);
    const threshold = this._randInt(rnd, 20, 50);
    let title = `Pest Pressure: ${pest}`;
    title = this._pickAltTitle(rnd, "pest", title);
    const action =
      trap >= threshold
        ? "Threshold exceeded — consider treatment when wind < 4 m/s and no rain 6h."
        : "Below threshold — continue monitoring traps and borders.";
    return {
      title,
      message: this._finalizeMsg("pest", { crop, pest, trapCount: trap, threshold }, action),
    };
  }

  _buildSoil(rnd) {
    const soil = this._pick(rnd, this.profile.soils);
    const moisture = this._randInt(rnd, 18, 95); // %
    const compaction = this._randInt(rnd, 0, 1) ? "elevated" : "normal";
    let title = moisture > 80 ? "Field Saturation Risk" : "Soil Condition Update";
    title = this._pickAltTitle(rnd, "soil", title);
    const action =
      moisture > 80
        ? "Avoid heavy traffic; keep to headlands; delay tillage."
        : compaction === "elevated"
        ? "Use lower tire pressure or duals; shallow pass only."
        : "Conditions acceptable.";
    return {
      title,
      message: this._finalizeMsg("soil", { soil, moisturePct: moisture, compaction }, action),
    };
  }

  _buildMachinery(rnd, monthIdx) {
    let title = "Machinery Service Window";
    title = this._pickAltTitle(rnd, "machinery", title);
    const hours = this._randInt(rnd, 2, 6);
    const target = this._pick(rnd, ["combine", "sprayer", "tractor"]);
    const action = `Schedule quick service (${hours}h) before workload peak; check belts/filters.`;
    return {
      title,
      message: this._finalizeMsg("machinery", { target, windowH: hours }, action),
    };
  }

  _buildLivestock(rnd) {
    if (!this.profile.livestock.length) return null;
    const sp = this._pick(rnd, this.profile.livestock);
    const thi = this._randInt(rnd, 68, 82); // Temperature Humidity Index
    let title = thi >= 78 ? "Heat Stress Risk (Livestock)" : "Livestock Comfort Advisory";
    title = this._pickAltTitle(rnd, "livestock", title);
    const action =
      thi >= 78 ? "Boost airflow & shade; add water points; adjust feeding times." : "Monitor THI; ensure steady water supply.";
    return {
      title,
      message: this._finalizeMsg("livestock", { species: sp, THI: thi }, action),
    };
  }

  _buildLogistics(rnd) {
    const issue = this._pick(rnd, ["muddy field access", "wind drift risk", "low visibility fog"]);
    let title = "Operations Logistics Notice";
    title = this._pickAltTitle(rnd, "logistics", title);
    const action = {
      "muddy field access": "Use lighter rigs; avoid center lanes; wait 12h after peak rain.",
      "wind drift risk": "Delay spraying; buffer edges near roads/streams.",
      "low visibility fog": "Avoid dawn traffic with wide headers; use beacons.",
    }[issue];
    return { title, message: this._finalizeMsg("logistics", { issue }, action) };
  }

  _buildMarket(rnd) {
    const commodity = this._pick(rnd, ["wheat", "corn", "rapeseed", "potato"]);
    const delta = this._randInt(rnd, -3, 3) / 10; // +/- 0.3
    let title = "Local Commodity Signal";
    title = this._pickAltTitle(rnd, "market", title);
    const action = delta > 0 ? "Consider partial forward sale." : "Consider holding if storage OK.";
    return {
      title,
      message: this._finalizeMsg("market", { commodity, dayDeltaPct: this._formatNumber(delta, 1) + "%" }, action),
    };
  }

  _finalizeMsgOld(category, details, action) {
    const region = this.profile.region;
    return `${category.toUpperCase()} | ${JSON.stringify(details)} | Action: ${action} | Region: ${region}`;
  }

  _finalizeMsgOld2(category, details, action) {
    const region = this.profile.region;
    // turn key: value into a readable string
    const detailsText = Object.entries(details)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    return `${category.toUpperCase()} – ${detailsText}. ${action} (Region: ${region})`;
  }

  _finalizeMsg(category, details, action) {
    const region = this.profile.region;

    // turn key/value details into readable text
    const detailParts = Object.entries(details)
      .map(([k, v]) => `${this._humanizeKey(k)} ${v}`)
      .join(", ");

    // Compose a nicer sentence
    return `${category.toUpperCase()} alert for ${region}: ${action}${detailParts ? " (Details: " + detailParts + ")" : ""}`;
  }

  // helper to make keys nicer
  _humanizeKey(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize words
  }

  // ---------- main generation ----------
  generateAlertsForDate(dateStr) {
    try {
      const date = this._parseDate(dateStr);
      const monthIdx = date.getUTCMonth(); // 0..11
      const month = monthIdx + 1; // 1..12

      // keep deterministic seed
      const strForSeed = `alerts:${dateStr}:${this.profile.region}:${(this.profile.crops || []).join(",")}`;
      const seed = this._hash32(strForSeed);
      const rnd = this._mulberry32(seed);
      logDebug(`generateAlertsForDate ${dateStr} seed=${seed}`);

      // ---- (A) alert count per day, driven by config.countsDistribution
      const countKey = this._pickWeightedObj(rnd, this.config.countsDistribution);
      const count = Number(countKey);
      logDebug(`Alert count for ${dateStr}: ${count} (distribution: ${JSON.stringify(this.config.countsDistribution)})`);

      // ---- (B) category weights (global + optional month override)
      const base = this.config.categoryWeights || {};
      const monthOverride = (this.config.categoryWeightsByMonth && this.config.categoryWeightsByMonth[month]) || {};
      // build final weights object for this month
      const catWeights = {};
      for (const cat of this.categories) {
        const w = monthOverride[cat] ?? base[cat] ?? 1;
        if (w > 0) catWeights[cat] = w;
      }

      const alerts = [];
      for (let i = 0; i < count; i++) {
        // pick category using configured weights
        const cat = this._pickWeightedObj(rnd, catWeights);

        // ... keep your existing per-category builders & severity logic ...
        let built;
        switch (cat) {
          case "weather":
            built = this._buildWeather(rnd, monthIdx);
            break;
          case "irrigation":
            built = this._buildIrrigation(rnd, monthIdx);
            break;
          case "disease":
            built = this._buildDisease(rnd, monthIdx);
            break;
          case "pest":
            built = this._buildPest(rnd);
            break;
          case "soil":
            built = this._buildSoil(rnd);
            break;
          case "machinery":
            built = this._buildMachinery(rnd, monthIdx);
            break;
          case "livestock":
            built = this._buildLivestock(rnd);
            break;
          case "logistics":
            built = this._buildLogistics(rnd);
            break;
          case "market":
            built = this._buildMarket(rnd);
            break;
          default:
            built = { title: "General Notice", message: "Informational." };
        }
        if (!built) continue;

        const baseRisk =
          cat === "weather"
            ? 0.6
            : cat === "disease" || cat === "pest"
            ? 0.5
            : cat === "irrigation"
            ? 0.45
            : cat === "livestock"
            ? 0.4
            : cat === "soil"
            ? 0.35
            : cat === "logistics"
            ? 0.3
            : cat === "machinery"
            ? 0.25
            : 0.2;
        const sev = this._severityFromRisk(rnd, baseRisk);

        const hour = this._weighted(rnd, [
          { value: this._randInt(rnd, 5, 10), w: 4 },
          { value: this._randInt(rnd, 11, 15), w: 2 },
          { value: this._randInt(rnd, 16, 20), w: 2 },
          { value: this._randInt(rnd, 0, 4), w: 1 },
          { value: this._randInt(rnd, 21, 23), w: 1 },
        ]);
        const minute = this._randInt(rnd, 0, 59);
        const ts = new Date(date.getTime());
        ts.setUTCHours(hour, minute, 0, 0);

        const affected = {};
        if (["disease", "pest", "irrigation", "market"].includes(cat)) {
          affected.crops = [this._pick(rnd, this.profile.crops)];
        }
        if (cat === "livestock" && this.profile.livestock?.length) {
          affected.livestock = [this._pick(rnd, this.profile.livestock)];
        }

        alerts.push({
          id: `${dateStr.replace(/-/g, "")}-${cat}-${i + 1}`,
          date: dateStr,
          timestamp: ts.toISOString(),
          category: cat,
          severity: sev,
          title: built.title,
          message: built.message,
          location: this.profile.region,
          affected,
          tags: [cat].concat(affected.crops || [], affected.livestock || []),
          read: false,
        });
      }

      // ---- (C) Special bizarre alerts with low probability
      if (rnd() < this.config.specialAlertsProbability) {
        const specialAlert = this._pick(rnd, SPECIAL_ALERTS);
        const specialHour = this._randInt(rnd, 0, 23);
        const specialMinute = this._randInt(rnd, 0, 59);
        const specialTs = new Date(date.getTime());
        specialTs.setUTCHours(specialHour, specialMinute, 0, 0);

        const specialId = `${dateStr.replace(/-/g, "")}-special-${Math.floor(rnd() * 1000)}`;

        alerts.push({
          id: specialId,
          date: dateStr,
          timestamp: specialTs.toISOString(),
          category: specialAlert.category,
          severity: specialAlert.severity,
          title: specialAlert.title,
          message: specialAlert.message.replace("PL-MA", this.profile.region), // Update region in message
          location: this.profile.region,
          affected: {},
          tags: ["special", specialAlert.category],
          read: false,
        });

        logDebug(`Special alert generated for ${dateStr}: ${specialAlert.title}`);
      }

      alerts.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
      return alerts;
    } catch (err) {
      logError("generateAlertsForDate failed", { err: String(err), dateStr });
      throw err;
    }
  }

  // history/upcoming unchanged
  getHistory(dateStr, days = 7) {
    const seedDate = this._parseDate(dateStr);
    const out = [];
    for (let i = 1; i <= days; i++) {
      const d = new Date(seedDate.getTime());
      d.setUTCDate(d.getUTCDate() - i);
      const ds = this._toISODate(d);
      out.push({ date: ds, alerts: this.generateAlertsForDate(ds) });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  getUpcoming(dateStr) {
    const seedDate = this._parseDate(dateStr);
    const d = new Date(seedDate.getTime());
    d.setUTCDate(d.getUTCDate() + 1);
    const ds = this._toISODate(d);
    return { date: ds, alerts: this.generateAlertsForDate(ds) };
  }
}

module.exports = (region = "PL-24") =>
  new AlertsService({
    region,
    farmName: "Farm",
    crops: ["wheat", "corn", "rapeseed", "potato", "soybean"],
    livestock: ["cattle", "sheep", "pigs", "goats", "chickens"],
    soils: ["loam", "sandy_loam", "clay_loam", "silt_loam"],
  });
