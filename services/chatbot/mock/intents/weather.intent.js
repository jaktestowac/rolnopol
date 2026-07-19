const { POOLS, pick } = require("../phrases");

/**
 * Weather intent — a genuine tool user. It resolves an English/Polish region
 * name to a voivodeship code, calls the real `get_weather_forecast` tool
 * (backed by the weather service), and phrases the result naturally. This is the
 * clearest demonstration of the mock actually using tools.
 */

// English / common aliases → voivodeship code (the weather service only knows
// the Polish names/codes, so we translate before calling the tool).
const REGION_ALIASES = {
  silesia: "PL-24", silesian: "PL-24", "śląsk": "PL-24", slask: "PL-24", "śląskie": "PL-24", slaskie: "PL-24", katowice: "PL-24",
  mazovia: "PL-14", masovia: "PL-14", masovian: "PL-14", mazowsze: "PL-14", mazowieckie: "PL-14", warsaw: "PL-14", warszawa: "PL-14",
  "lesser poland": "PL-12", malopolska: "PL-12", "małopolska": "PL-12", malopolskie: "PL-12", "małopolskie": "PL-12", krakow: "PL-12", cracow: "PL-12", "kraków": "PL-12",
  "greater poland": "PL-30", wielkopolska: "PL-30", wielkopolskie: "PL-30", poznan: "PL-30", "poznań": "PL-30",
  "lower silesia": "PL-02", "dolny śląsk": "PL-02", "dolnośląskie": "PL-02", dolnoslaskie: "PL-02", wroclaw: "PL-02", "wrocław": "PL-02",
  pomerania: "PL-22", pomeranian: "PL-22", pomorskie: "PL-22", gdansk: "PL-22", "gdańsk": "PL-22",
  "west pomerania": "PL-32", zachodniopomorskie: "PL-32", szczecin: "PL-32",
  kuyavia: "PL-04", "kujawsko-pomorskie": "PL-04", kujawy: "PL-04", bydgoszcz: "PL-04",
  lublin: "PL-06", lubelskie: "PL-06",
  lubusz: "PL-08", lubuskie: "PL-08",
  lodz: "PL-10", "łódź": "PL-10", "łódzkie": "PL-10", lodzkie: "PL-10",
  opole: "PL-16", opolskie: "PL-16",
  subcarpathia: "PL-18", podkarpackie: "PL-18", rzeszow: "PL-18", "rzeszów": "PL-18",
  podlasie: "PL-20", podlaskie: "PL-20", bialystok: "PL-20", "białystok": "PL-20",
  "holy cross": "PL-26", "świętokrzyskie": "PL-26", swietokrzyskie: "PL-26", kielce: "PL-26",
  warmia: "PL-28", masuria: "PL-28", "warmińsko-mazurskie": "PL-28", "warminsko-mazurskie": "PL-28", olsztyn: "PL-28",
  poland: "PL-00", polska: "PL-00", nationwide: "PL-00", country: "PL-00",
};

function resolveRegionCode(normalizedPrompt) {
  // Longest alias first so "lower silesia" beats "silesia".
  const keys = Object.keys(REGION_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalizedPrompt.includes(key)) {
      return REGION_ALIASES[key];
    }
  }
  return null;
}

function num(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "?";
}

function describeForecast(data) {
  const name = data.name || data.region || "that region";
  const condition = (data.condition || "mixed").toString();
  const high = data.temperatureMaxC != null ? `${num(data.temperatureMaxC, 1)}°C` : data.temperature != null ? `${num(data.temperature, 1)}°C` : null;
  const low = data.temperatureMinC != null ? `${num(data.temperatureMinC, 1)}°C` : null;
  const precip = data.precipitationMm != null ? data.precipitationMm : data.precipitation;
  const humidity = data.humidityPct != null ? data.humidityPct : data.humidity;
  const wind = data.windKmh != null ? data.windKmh : data.windSpeed;

  var lines = [`${pick(POOLS.weatherIntros)} ${name}:`];
  var headline = `- ${condition}`;
  if (high) {
    headline += pick([`, high ${high}`, `, highs near ${high}`, `, up to ${high}`]);
    if (low) {
      headline += pick([` / low ${low}`, ` (overnight low ${low})`, `, dipping to ${low}`]);
    }
  }
  lines.push(headline);
  if (precip != null) {
    lines.push(`- Precipitation: ${num(precip, 1)} mm`);
  }
  if (humidity != null) {
    lines.push(`- Humidity: ${num(humidity, 0)}%`);
  }
  if (wind != null) {
    lines.push(`- Wind: ${num(wind, 0)} km/h`);
  }
  if (data.advisory) {
    lines.push(`\n${data.advisory}`);
  }
  if (data.recommendation) {
    lines.push(data.advisory ? data.recommendation : `\n${data.recommendation}`);
  }
  const tip = pick([
    "",
    "",
    "\nWant the forecast for another region?",
    "\nAsk again anytime for an updated reading.",
    "\nI can compare this with a neighbouring region if helpful.",
  ]);
  if (tip) {
    lines.push(tip);
  }
  return lines.join("\n");
}

module.exports = {
  id: "weather",
  match(normalizedPrompt) {
    return /\b(weather|forecast|temperature|temp|rain|raining|humidity|wind|sunny|drought|irrigation|climate)\b/.test(normalizedPrompt);
  },
  async respond({ normalizedPrompt, tools }) {
    const code = resolveRegionCode(normalizedPrompt);

    // No region mentioned → give a short nationwide snapshot and offer detail.
    if (!code || code === "PL-00") {
      const all = await tools.call("get_weather_all_regions", { days: 1 });
      const regions = (all && all.regions) || [];
      if (!regions.length) {
        return "I couldn't reach the weather service just now. Please try again, or name a region (e.g. \"weather in Silesia\").";
      }
      const sample = regions.slice(0, 3).map((r) => `- ${r.name}: ${r.today?.condition || "—"}, ${num(r.today?.temperatureMaxC, 0)}°C`).join("\n");
      return [
        pick(POOLS.nationwideIntros),
        sample,
        pick([
          '\nTell me a region (e.g. "weather in Silesia") for a detailed forecast.',
          '\nName a region or city and I\'ll give you the full picture.',
          "\nWant details for a specific voivodeship? Just say which.",
        ]),
      ].join("\n");
    }

    const forecast = await tools.call("get_weather_forecast", { region: code });
    if (!forecast || forecast.error) {
      return `I couldn't fetch the forecast for that region${forecast && forecast.error ? ` (${forecast.error})` : ""}. Try naming a Polish voivodeship or a city.`;
    }
    return describeForecast(forecast);
  },
};
