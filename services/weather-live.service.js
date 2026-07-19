const createWeatherService = require("./weather.service");

/**
 * WeatherLiveService — turns the deterministic daily weather (from
 * services/weather.service.js) into a live "current conditions" feed that can be
 * streamed over Server-Sent Events (SSE).
 *
 * Design goals:
 *  - Consistency: every frame is anchored to the SAME base day the rest of the
 *    weather module reports (getDaily), so the live page never contradicts the
 *    daily/forecast data. The stream only adds sub-daily variation on top.
 *  - Streaming variation: each frame nudges the base values by a small, bounded,
 *    DETERMINISTIC amount (seeded by region+date+seed+tick), so the numbers move
 *    like a live sensor while staying reproducible for tests (variance = 0 yields
 *    exactly the base values).
 *  - Alerts: severe-weather thresholds are evaluated per frame; the SSE layer is
 *    responsible for de-duplicating alerts across frames (emit on first activation).
 *
 * The class is intentionally pure (no timers, no res handles, no Date.now unless
 * a caller omits `observedAt`) so it can be unit-tested in isolation.
 */
class WeatherLiveService {
  constructor(options = {}) {
    this.region = options.region || "PL-14";
    this.weatherService = createWeatherService(this.region);
  }

  getSupportedRegions() {
    return this.weatherService.getSupportedRegions();
  }

  normalizeRegion(regionCode) {
    return this.weatherService.normalizeRegion(regionCode);
  }

  _hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  _mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  _round1(value) {
    return Math.round(value * 10) / 10;
  }

  _liveCondition(temperatureC, precipitationMmH, cloudPct, windKmh) {
    if (precipitationMmH >= 6) return "Storm";
    if (precipitationMmH >= 2.5) return "Heavy rain";
    if (precipitationMmH >= 0.6) return temperatureC <= 1 ? "Sleet" : "Rain";
    if (temperatureC <= 0 && precipitationMmH >= 0.1) return "Snow";
    if (cloudPct > 84) return "Overcast";
    if (cloudPct > 64) return "Cloudy";
    if (windKmh > 36) return "Windy";
    return "Sunny";
  }

  _feelsLike(temperatureC, windKmh, humidityPct) {
    // Simple wind-chill / heat-index blend, good enough for a simulated feed.
    if (temperatureC <= 10 && windKmh >= 5) {
      const v = Math.pow(windKmh, 0.16);
      return this._round1(13.12 + 0.6215 * temperatureC - 11.37 * v + 0.3965 * temperatureC * v);
    }
    if (temperatureC >= 27) {
      return this._round1(temperatureC + 0.05 * Math.max(0, humidityPct - 40));
    }
    return this._round1(temperatureC);
  }

  /**
   * Base day the whole weather module agrees on (deterministic, no variation).
   */
  getBaseDay(dateStr, region) {
    return this.weatherService.getDaily(dateStr, { region });
  }

  /**
   * Produce one live-conditions frame anchored to the base day.
   *
   * @param {Object} options
   * @param {string} options.region     region code (normalized internally)
   * @param {string} options.date       YYYY-MM-DD base day
   * @param {number} [options.tick=0]   monotonic frame counter (drives variation)
   * @param {string} [options.seed=""]  extra seed so different streams differ
   * @param {number} [options.variance=1] 0..3 amplitude of sub-daily variation (0 = base values verbatim)
   * @param {string} [options.observedAt] ISO timestamp (defaults to now if omitted)
   */
  deriveConditions(options = {}) {
    const region = this.normalizeRegion(options.region || this.region);
    const date = options.date;
    const tick = Number.isFinite(Number(options.tick)) ? Number(options.tick) : 0;
    const seed = typeof options.seed === "string" ? options.seed : "";
    const amp = this._clamp(Number.isFinite(Number(options.variance)) ? Number(options.variance) : 1, 0, 3);

    const day = this.getBaseDay(date, region);
    const rnd = this._mulberry32(this._hash32(`weather-live:${region}:${date}:${seed}:${tick}`));

    const baseTempAvg = (day.temperatureMinC + day.temperatureMaxC) / 2;
    const temperatureC = this._round1(this._clamp(baseTempAvg + (rnd() - 0.5) * 3 * amp, -45, 55));
    const windKmh = Math.round(this._clamp(day.windKmh + (rnd() - 0.5) * 10 * amp, 0, 130));
    const gustKmh = Math.round(this._clamp(windKmh + rnd() * 16 * amp, windKmh, 170));
    const precipitationMmH = this._round1(this._clamp(day.precipitationMm / 24 + (rnd() - 0.5) * 0.9 * amp, 0, 60));
    const humidityPct = Math.round(this._clamp(day.humidityPct + (rnd() - 0.5) * 8 * amp, 5, 100));
    const pressureHpa = Math.round(this._clamp(day.pressureHpa + (rnd() - 0.5) * 4 * amp, 950, 1060));
    const cloudCoverPct = Math.round(this._clamp(day.cloudCoverPct + (rnd() - 0.5) * 14 * amp, 0, 100));

    const condition = this._liveCondition(temperatureC, precipitationMmH, cloudCoverPct, windKmh);
    const feelsLikeC = this._feelsLike(temperatureC, windKmh, humidityPct);

    return {
      region,
      date,
      tick,
      observedAt: typeof options.observedAt === "string" ? options.observedAt : new Date().toISOString(),
      condition,
      temperatureC,
      feelsLikeC,
      windKmh,
      gustKmh,
      precipitationMmH,
      humidityPct,
      pressureHpa,
      cloudCoverPct,
      // Reference to the consistent daily data so the UI can show the day envelope.
      base: {
        condition: day.condition,
        temperatureMinC: day.temperatureMinC,
        temperatureMaxC: day.temperatureMaxC,
        precipitationMm: day.precipitationMm,
        spellType: day.spellType,
        advisory: day.advisory,
      },
    };
  }

  /**
   * Evaluate severe-weather thresholds for a single conditions frame.
   * Returns zero or more alert objects. Callers streaming frames should
   * de-duplicate by `key` so an alert is emitted once per activation.
   */
  evaluateAlerts(conditions) {
    const alerts = [];
    const at = conditions.observedAt || new Date().toISOString();
    const base = conditions.base || {};
    const dailyPrecip = Number(base.precipitationMm) || 0;
    const baseCondition = String(base.condition || "");
    const push = (key, severity, title, message) => {
      alerts.push({ key, severity, title, message, region: conditions.region, ts: at });
    };

    if (conditions.gustKmh >= 90) {
      push(
        "damaging-gusts",
        "severe",
        "Damaging wind gusts",
        `Gusts up to ${conditions.gustKmh} km/h — secure equipment and stay clear of structures.`,
      );
    } else if (conditions.windKmh >= 50) {
      push("high-wind", "severe", "High wind", `Sustained wind ${conditions.windKmh} km/h — suspend spraying and greenhouse venting.`);
    } else if (conditions.windKmh >= 38) {
      push("strong-wind", "warning", "Strong wind", `Wind ${conditions.windKmh} km/h — field spraying accuracy is reduced.`);
    }

    // Rain/storm alerting keys off both the instantaneous rate and the base day's
    // daily envelope, so a stormy day surfaces on the stream (the hourly rate
    // alone dilutes the daily total across 24h) while staying consistent with the
    // rest of the weather module.
    if (conditions.precipitationMmH >= 6 || dailyPrecip >= 20 || /storm/i.test(conditions.condition) || /storm/i.test(baseCondition)) {
      push(
        "storm",
        "severe",
        "Thunderstorm / torrential rain",
        `Heavy precipitation expected (${dailyPrecip} mm today) — flooding and drainage risk.`,
      );
    } else if (conditions.precipitationMmH >= 2.5 || dailyPrecip >= 9 || /heavy rain/i.test(baseCondition)) {
      push("heavy-rain", "warning", "Heavy rain", `Rain expected (${dailyPrecip} mm today) — delay heavy machinery on soft ground.`);
    }

    if (conditions.temperatureC >= 36) {
      push(
        "extreme-heat",
        "severe",
        "Extreme heat",
        `Temperature ${conditions.temperatureC}°C — heat stress risk for crops and livestock.`,
      );
    } else if (conditions.temperatureC >= 32) {
      push("heat", "warning", "Heat advisory", `Temperature ${conditions.temperatureC}°C — increase watering cadence.`);
    }

    if (conditions.temperatureC <= -15) {
      push("extreme-cold", "severe", "Extreme cold", `Temperature ${conditions.temperatureC}°C — protect sensitive stock and water lines.`);
    } else if (conditions.temperatureC <= -8) {
      push("hard-freeze", "warning", "Hard freeze", `Temperature ${conditions.temperatureC}°C — freeze risk for exposed crops.`);
    }

    return alerts;
  }

  /**
   * Convenience: derive conditions and evaluate alerts in one call.
   */
  generateFrame(options = {}) {
    const conditions = this.deriveConditions(options);
    const alerts = this.evaluateAlerts(conditions);
    return { conditions, alerts };
  }
}

module.exports = (region = "PL-14") => new WeatherLiveService({ region });
module.exports.WeatherLiveService = WeatherLiveService;
