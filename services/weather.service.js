class WeatherService {
  constructor(options = {}) {
    this.region = options.region || "PL-14";
  }

  _supportedRegions() {
    return [
      { code: "PL-02", name: "dolnośląskie" },
      { code: "PL-04", name: "kujawsko-pomorskie" },
      { code: "PL-08", name: "lubuskie" },
      { code: "PL-10", name: "łódzkie" },
      { code: "PL-06", name: "lubelskie" },
      { code: "PL-12", name: "małopolskie" },
      { code: "PL-14", name: "mazowieckie" },
      { code: "PL-16", name: "opolskie" },
      { code: "PL-20", name: "podlaskie" },
      { code: "PL-18", name: "podkarpackie" },
      { code: "PL-22", name: "pomorskie" },
      { code: "PL-26", name: "świętokrzyskie" },
      { code: "PL-24", name: "śląskie" },
      { code: "PL-28", name: "warmińsko-mazurskie" },
      { code: "PL-30", name: "wielkopolskie" },
      { code: "PL-32", name: "zachodniopomorskie" },
    ];
  }

  getSupportedRegions() {
    return this._supportedRegions().map((item) => ({ ...item }));
  }

  normalizeRegion(regionCode) {
    const regions = this._supportedRegions();
    const candidate = String(regionCode || "").trim();
    const known = regions.find((item) => item.code === candidate);
    return known ? known.code : this.region;
  }

  _parseISODate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }

    const [y, m, d] = dateStr.split("-").map((v) => Number(v));
    const date = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid date value");
    }

    return date;
  }

  _toISODate(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
  }

  _addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  _diffDaysUTC(fromDate, toDate) {
    const fromUtc = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate());
    const toUtc = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
    return Math.round((toUtc - fromUtc) / 86400000);
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

  _pickWeighted(rnd, items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let marker = rnd() * total;
    for (const item of items) {
      marker -= item.weight;
      if (marker <= 0) {
        return item.value;
      }
    }
    return items[items.length - 1].value;
  }

  _seasonProfile(monthIndex) {
    const data = [
      { avg: -1, swing: 5, precipBase: 2.2, humidity: 84, pressure: 1018 },
      { avg: 0, swing: 5, precipBase: 2.0, humidity: 81, pressure: 1017 },
      { avg: 4, swing: 6, precipBase: 2.3, humidity: 76, pressure: 1014 },
      { avg: 9, swing: 7, precipBase: 2.4, humidity: 72, pressure: 1013 },
      { avg: 14, swing: 8, precipBase: 2.8, humidity: 70, pressure: 1012 },
      { avg: 18, swing: 8, precipBase: 3.3, humidity: 68, pressure: 1011 },
      { avg: 20, swing: 7, precipBase: 3.5, humidity: 69, pressure: 1010 },
      { avg: 20, swing: 7, precipBase: 2.9, humidity: 68, pressure: 1011 },
      { avg: 15, swing: 7, precipBase: 2.7, humidity: 74, pressure: 1013 },
      { avg: 10, swing: 6, precipBase: 2.5, humidity: 80, pressure: 1015 },
      { avg: 5, swing: 5, precipBase: 2.8, humidity: 85, pressure: 1017 },
      { avg: 1, swing: 5, precipBase: 2.6, humidity: 87, pressure: 1019 },
    ];
    return data[monthIndex] || data[0];
  }

  _regimeForDate(date, region) {
    // 5-day blocks create realistic multi-day weather spells.
    const block = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / (86400000 * 5));
    const seed = this._hash32(`weather-spell:${region}:${block}`);
    const rnd = this._mulberry32(seed);
    const regime = this._pickWeighted(rnd, [
      { value: "stable", weight: 46 },
      { value: "rainy", weight: 24 },
      { value: "dry", weight: 18 },
      { value: "cold", weight: 6 },
      { value: "warm", weight: 6 },
    ]);

    return {
      regime,
      intensity: 0.55 + rnd() * 0.9,
      windBias: rnd() * 2,
    };
  }

  _conditionLabel(tempAvgC, rainMm, cloudPct, windKmh) {
    if (rainMm > 20) return "Storm";
    if (rainMm > 9) return "Heavy rain";
    if (rainMm > 2.5) return tempAvgC <= 1 ? "Sleet" : "Rain";
    if (tempAvgC <= 0 && rainMm > 0.5) return "Snow";
    if (cloudPct > 84) return "Overcast";
    if (cloudPct > 64) return "Cloudy";
    if (windKmh > 36) return "Windy";
    return "Sunny";
  }

  _advisory(day) {
    if (day.precipitationMm >= 14) return "Delay heavy field operations and check drainage channels.";
    if (day.droughtIndex >= 72) return "Irrigation is recommended — soil moisture deficit is elevated.";
    if (day.temperatureMaxC >= 30) return "Heat stress risk for crops and livestock — increase watering cadence.";
    if (day.temperatureMinC <= -2) return "Night frost risk — protect sensitive crops and seedlings.";
    if (day.windKmh >= 38) return "High wind may impact spraying precision and greenhouse safety.";
    return "Weather conditions are generally favorable for standard farm operations.";
  }

  generateDay(dateStr, options = {}) {
    const date = this._parseISODate(dateStr);
    const region = options.region || this.region;

    const season = this._seasonProfile(date.getUTCMonth());
    const regime = this._regimeForDate(date, region);
    const seed = this._hash32(`weather-day:${dateStr}:${region}`);
    const rnd = this._mulberry32(seed);

    let tempShift = (rnd() - 0.5) * (season.swing * 0.9);
    let rainShift = (rnd() - 0.5) * 3.6;
    let humidityShift = (rnd() - 0.5) * 10;
    let windShift = (rnd() - 0.5) * 14 + regime.windBias;

    if (regime.regime === "rainy") {
      rainShift += 5.2 * regime.intensity;
      humidityShift += 10 + 12 * regime.intensity;
      tempShift -= 0.8 * regime.intensity;
      windShift += 5.5 * regime.intensity;
    } else if (regime.regime === "dry") {
      rainShift -= 2.2 * regime.intensity;
      humidityShift -= 13 * regime.intensity;
      tempShift += 1.2 * regime.intensity;
    } else if (regime.regime === "cold") {
      tempShift -= 4.6 * regime.intensity;
      humidityShift += 4;
      windShift += 3;
    } else if (regime.regime === "warm") {
      tempShift += 4.3 * regime.intensity;
      rainShift -= 0.5;
      humidityShift -= 5;
    }

    const avgTemp = season.avg + tempShift;
    const diurnalSpread = 5 + rnd() * 5;
    const temperatureMinC = Math.round((avgTemp - diurnalSpread / 2) * 10) / 10;
    const temperatureMaxC = Math.round((avgTemp + diurnalSpread / 2) * 10) / 10;

    const precipitationMm = Math.round(this._clamp(season.precipBase + rainShift, 0, 40) * 10) / 10;
    const humidityPct = Math.round(this._clamp(season.humidity + humidityShift, 26, 99));
    const windKmh = Math.round(this._clamp(9 + windShift, 2, 58));
    const pressureHpa = Math.round(this._clamp(season.pressure + (rnd() - 0.5) * 8 - precipitationMm * 0.24, 985, 1038));

    const cloudPct = Math.round(this._clamp(18 + precipitationMm * 3 + (humidityPct - 55) * 0.65 + (rnd() - 0.5) * 10, 4, 100));
    const droughtIndex = Math.round(
      this._clamp(100 - precipitationMm * 2.2 - humidityPct * 0.22 + Math.max(temperatureMaxC - 22, 0) * 1.9, 0, 100),
    );
    const soilMoisturePct = Math.round(this._clamp(42 + precipitationMm * 1.4 - droughtIndex * 0.18 + (rnd() - 0.5) * 8, 12, 96));

    const condition = this._conditionLabel((temperatureMinC + temperatureMaxC) / 2, precipitationMm, cloudPct, windKmh);

    const weather = {
      date: dateStr,
      region,
      condition,
      temperatureMinC,
      temperatureMaxC,
      precipitationMm,
      humidityPct,
      windKmh,
      pressureHpa,
      cloudCoverPct: cloudPct,
      droughtIndex,
      soilMoisturePct,
      spellType: regime.regime,
    };

    return {
      ...weather,
      advisory: this._advisory(weather),
    };
  }

  getDaily(dateStr, options = {}) {
    return this.generateDay(dateStr, options);
  }

  getForecast(options = {}) {
    const baseDate = options.baseDate ? this._parseISODate(options.baseDate) : this._parseISODate(this._toISODate(new Date()));
    const requestedDays = Number.isFinite(Number(options.days)) ? Number(options.days) : 7;
    const days = this._clamp(Math.floor(requestedDays), 1, 7);
    const region = options.region || this.region;

    const today = this._parseISODate(this._toISODate(new Date()));
    const diffFromToday = this._diffDaysUTC(today, baseDate);

    const maxHorizon = 7;
    if (diffFromToday < 1 || diffFromToday > maxHorizon) {
      return {
        baseDate: this._toISODate(baseDate),
        days,
        forecast: [],
        constraints: {
          minDate: this._toISODate(this._addDays(today, 1)),
          maxDate: this._toISODate(this._addDays(today, maxHorizon)),
          message: "Forecast is available only for the next 7 upcoming days.",
        },
      };
    }

    const maxDaysAvailable = maxHorizon - diffFromToday + 1;
    const finalDays = Math.min(days, maxDaysAvailable);
    const forecast = [];

    for (let i = 0; i < finalDays; i += 1) {
      const next = this._addDays(baseDate, i);
      forecast.push(this.generateDay(this._toISODate(next), { region }));
    }

    return {
      baseDate: this._toISODate(baseDate),
      days: finalDays,
      forecast,
      constraints: {
        minDate: this._toISODate(this._addDays(today, 1)),
        maxDate: this._toISODate(this._addDays(today, maxHorizon)),
        message: "Forecast is available only for the next 7 upcoming days.",
      },
    };
  }

  _buildFarmProfile(userContext = {}) {
    return {
      fieldsCount: Number(userContext.fieldsCount || 0),
      animalsCount: Number(userContext.animalsCount || 0),
      staffCount: Number(userContext.staffCount || 0),
      totalAreaHa: Number(userContext.totalAreaHa || 0),
      cropTypes: Array.isArray(userContext.cropTypes) ? userContext.cropTypes : [],
      livestockTypes: Array.isArray(userContext.livestockTypes) ? userContext.livestockTypes : [],
      hasGreenhouse: Boolean(userContext.hasGreenhouse),
      hasIrrigation: Boolean(userContext.hasIrrigation),
      soilType: userContext.soilType || "loam",
      equipment: Array.isArray(userContext.equipment) ? userContext.equipment : [],
    };
  }

  _calculateWeatherMetrics(today, forecast) {
    return {
      today,
      avgRain: forecast.length > 0 ? forecast.reduce((acc, day) => acc + Number(day.precipitationMm || 0), 0) / forecast.length : 0,
      totalRain: forecast.length > 0 ? forecast.reduce((acc, day) => acc + Number(day.precipitationMm || 0), 0) : 0,
      maxWind: forecast.length > 0 ? Math.max(...forecast.map((day) => Number(day.windKmh || 0))) : Number(today.windKmh || 0),
      avgWind:
        forecast.length > 0
          ? forecast.reduce((acc, day) => acc + Number(day.windKmh || 0), 0) / forecast.length
          : Number(today.windKmh || 0),
      maxHeat:
        forecast.length > 0 ? Math.max(...forecast.map((day) => Number(day.temperatureMaxC || 0))) : Number(today.temperatureMaxC || 0),
      minNight:
        forecast.length > 0 ? Math.min(...forecast.map((day) => Number(day.temperatureMinC || 0))) : Number(today.temperatureMinC || 0),
      avgCloud:
        forecast.length > 0
          ? forecast.reduce((acc, day) => acc + Number(day.cloudCoverPct || 0), 0) / forecast.length
          : Number(today.cloudCoverPct || 0),
      avgHumidity:
        forecast.length > 0
          ? forecast.reduce((acc, day) => acc + Number(day.humidityPct || 0), 0) / forecast.length
          : Number(today.humidityPct || 0),
      spellTypes: forecast.map((day) => day.spellType),
    };
  }

  _assessRisks(metrics, farmProfile) {
    const risks = [];
    const { avgRain, maxWind, maxHeat, minNight, avgHumidity, today } = metrics;
    const { fieldsCount, animalsCount, hasGreenhouse, totalAreaHa } = farmProfile;

    // Moisture & drainage risks
    if (avgRain >= 10) {
      const severity = avgRain >= 15 ? "critical" : "high";
      const affectedArea = Math.ceil(totalAreaHa * (avgRain / 20));
      risks.push({
        key: "waterlogging",
        level: severity,
        label: "Waterlogging risk in next 72h",
        details: `Heavy rainfall (${avgRain.toFixed(1)}mm avg) may cause poor drainage. Estimated affected area: ~${affectedArea}ha.`,
        priority: "urgent" + (severity === "critical" ? "-critical" : ""),
      });
    } else if (avgRain <= 1.5) {
      risks.push({
        key: "dryness",
        level: "medium",
        label: "Dry spell likely in next 72h",
        details: `Low precipitation (${avgRain.toFixed(1)}mm avg) combined with ${today.droughtIndex > 60 ? "elevated" : "moderate"} drought index.`,
        priority: "moderate",
      });
    }

    // Wind & spraying risks
    if (maxWind >= 38) {
      risks.push({
        key: "wind",
        level: "high",
        label: "High wind limits field operations",
        details: `Peak wind ${maxWind}km/h may reduce spraying/seeding accuracy below acceptable thresholds.`,
        priority: "urgent",
      });
    } else if (maxWind >= 28) {
      risks.push({
        key: "moderate-wind",
        level: "medium",
        label: "Elevated wind conditions",
        details: `Wind ${maxWind}km/h adequate for careful operations; avoid pesticide spray.`,
        priority: "moderate",
      });
    }

    // Heat stress
    if (maxHeat >= 30) {
      const affectedSectors = [];
      if (animalsCount > 0) affectedSectors.push("livestock");
      if (farmProfile.cropTypes.some((c) => ["maize", "sunflower"].includes(c))) affectedSectors.push("heat-sensitive crops");
      if (hasGreenhouse) affectedSectors.push("greenhouse operations");

      risks.push({
        key: "heat",
        level: "high",
        label: "Heat stress for farm assets",
        details: `Max temp ${maxHeat.toFixed(1)}°C. At-risk sectors: ${affectedSectors.join(", ")}.`,
        priority: "urgent",
      });
    }

    // Frost risk
    if (minNight <= -2) {
      const season = this._seasonProfile(this._parseISODate(today.date).getUTCMonth());
      const isSensitiveSeason = [2, 3, 4, 10, 11].includes(this._parseISODate(today.date).getUTCMonth());
      risks.push({
        key: "frost",
        level: isSensitiveSeason ? "high" : "medium",
        label: "Frost risk at sensitive growth stages",
        details: `Min temp ${minNight.toFixed(1)}°C. Risk severity elevated for spring/autumn planting.`,
        priority: isSensitiveSeason ? "urgent" : "high",
      });
    }

    // Disease pressure risks
    if (avgHumidity > 80 && avgRain > 5) {
      risks.push({
        key: "disease-pressure",
        level: "medium",
        label: "Elevated fungal/pathogen pressure",
        details: `High humidity (${avgHumidity.toFixed(0)}%) + rain creates favorable disease spread conditions.`,
        priority: "high",
      });
    }

    return risks.sort((a, b) => {
      const priorityOrder = { "urgent-critical": 0, urgent: 1, "urgent-": 1, high: 2, moderate: 3, low: 4 };
      return (priorityOrder[a.priority] || 5) - (priorityOrder[b.priority] || 5);
    });
  }

  _calculateFarmImpactScores(metrics, farmProfile) {
    const scores = {};
    const { avgRain, totalRain, maxWind, maxHeat, minNight, avgCloud, avgHumidity } = metrics;
    const { fieldsCount, animalsCount, totalAreaHa, hasIrrigation, soilType } = farmProfile;

    // Spraying/Pest management impact (0-100, inverted: lower is better)
    scores.sprayingFeasibility = Math.max(
      0,
      100 - (maxWind >= 38 ? 50 : maxWind >= 28 ? 25 : 0) - (avgCloud > 80 ? 15 : 0) - (avgHumidity > 85 ? 10 : 0),
    );

    // Soil workability (0-100, higher is better)
    const drainageAdjustment = soilType === "clay" ? 1.5 : soilType === "sandy" ? 0.5 : 1;
    scores.soilWorkability = Math.max(
      0,
      100 -
        (avgRain * 8 * drainageAdjustment + // Heavy rain reduces workability
          (avgRain < 2 ? 0 : avgRain < 5 ? 20 : avgRain < 10 ? 50 : 80)),
    );

    // Irrigation necessity (0-100, higher = more necessary)
    scores.irrigationNeed = hasIrrigation ? Math.min(100, avgRain <= 2 ? 90 : avgRain <= 5 ? 60 : avgRain <= 10 ? 20 : 0) : 0;

    // Crop stress (0-100, lower is better)
    scores.cropStress = Math.max(
      0,
      (maxHeat >= 30 ? 40 : maxHeat >= 25 ? 20 : 0) + (minNight <= 0 ? 30 : minNight <= 5 ? 15 : 0) + (avgRain > 15 ? 20 : 0),
    );

    // Livestock stress (0-100, lower is better)
    scores.livestockStress =
      animalsCount > 0
        ? Math.max(0, (maxHeat >= 28 ? 35 : maxHeat >= 23 ? 15 : 0) + (maxWind >= 40 ? 20 : 0) + (avgRain > 10 ? 15 : 0))
        : 0;

    // Machinery operation risk (0-100, lower is better)
    scores.machineryRisk = Math.max(0, (totalRain > 15 ? 60 : totalRain > 8 ? 30 : 0) + (maxWind >= 40 ? 25 : 0) + (avgRain <= 1 ? 15 : 0));

    return scores;
  }

  _generateRecommendations(metrics, farmProfile, risks, impactScores) {
    const recommendations = [];
    const { avgRain, totalRain, maxWind, maxHeat, minNight, avgCloud } = metrics;
    const { fieldsCount, animalsCount, staffCount, totalAreaHa, cropTypes, livestockTypes, hasIrrigation, hasGreenhouse } = farmProfile;

    // Irrigation & water management
    if (avgRain <= 1.5 && hasIrrigation && totalAreaHa > 0) {
      const zoneCount = Math.max(1, Math.round(totalAreaHa / 8));
      recommendations.push({
        category: "water-management",
        action: "Plan irrigation rotation",
        details: `Schedule rotation for approximately ${zoneCount} field zone(s). Current deficit: ${(5 - avgRain).toFixed(1)}mm below seasonal norm.`,
        urgency: "high",
        affectedArea: totalAreaHa,
      });
    }

    // Spraying windows
    if (maxWind >= 28) {
      const safeWindows = maxWind >= 38 ? "none available" : "early morning (05:00-09:00) and evening (18:00-21:00)";
      recommendations.push({
        category: "field-operations",
        action: "Schedule spraying carefully",
        details: `Peak wind ${maxWind}km/h. Safe windows: ${safeWindows}. Avoid pesticide application if wind > 38km/h.`,
        urgency: "high",
        affectedFields: fieldsCount,
      });
    }

    // Livestock heat management
    if (animalsCount > 0 && maxHeat >= 26) {
      const measures = maxHeat >= 30 ? ["shade structures", "water misters", "ventilation"] : ["increased water access", "shade review"];
      recommendations.push({
        category: "livestock-care",
        action: "Activate heat stress protocols",
        details: `Temp peak ${maxHeat.toFixed(1)}°C. Implement: ${measures.join(", ")}. Monitor water intake closely.`,
        urgency: maxHeat >= 30 ? "urgent" : "high",
        affectedCount: animalsCount,
      });
    }

    // Machinery and field access
    if (totalRain > 10 && fieldsCount > 0) {
      const delayDays = totalRain > 15 ? 2 : 1;
      recommendations.push({
        category: "field-operations",
        action: "Defer heavy machinery operations",
        details: `Total rain ${totalRain.toFixed(1)}mm forecast. Delay operations by ${delayDays}+ days. Verify drainage paths and field condition before entry.`,
        urgency: "urgent",
        affectedFields: fieldsCount,
      });
    }

    // Frost protection
    if (minNight <= 2 && ["potato", "tomato", "bean", "corn"].some((c) => cropTypes.includes(c))) {
      recommendations.push({
        category: "crop-protection",
        action: "Prepare frost protection measures",
        details: `Min temp ${minNight.toFixed(1)}°C. At-risk crops: ${cropTypes.filter((c) => ["potato", "tomato", "bean"].includes(c)).join(", ")}. Deploy heaters/sprinklers if available.`,
        urgency: "high",
        affectedCrops: cropTypes,
      });
    }

    // Disease prevention
    if (impactScores.cropStress > 50 || (avgCloud > 75 && avgRain > 5)) {
      recommendations.push({
        category: "disease-management",
        action: "Increase disease monitoring",
        details: `Conditions favor fungal development (high humidity, rain, cloud cover). Scout fields daily and prepare preventive spray schedule.`,
        urgency: "moderate",
        affectedFields: fieldsCount,
      });
    }

    // Staff scheduling
    if (staffCount > 0 && recommendations.length > 2) {
      recommendations.push({
        category: "staff-management",
        action: "Optimize work schedules",
        details: `Deploy ${Math.ceil(staffCount * 0.6)}-${staffCount} staff to weather-sensitive tasks in morning shifts (05:00-14:00). Reserve afternoon for indoor/covered work.`,
        urgency: "moderate",
        affectedStaff: staffCount,
      });
    }

    // Greenhouse management
    if (hasGreenhouse && maxHeat >= 25) {
      recommendations.push({
        category: "greenhouse-ops",
        action: "Adjust ventilation and cooling",
        details: `Temp peak ${maxHeat.toFixed(1)}°C. Increase ventilation, check cooling systems, monitor humidity to prevent heat stress and condensation issues.`,
        urgency: "moderate",
      });
    }

    // Default stable conditions
    if (recommendations.length === 0) {
      recommendations.push({
        category: "general",
        action: "Conditions are stable",
        details: "Favorable weather for standard farm operations. Monitor forecasts for next update.",
        urgency: "low",
      });
    }

    return recommendations.sort((a, b) => {
      const urgencyOrder = { urgent: 0, high: 1, moderate: 2, low: 3 };
      return (urgencyOrder[a.urgency] || 4) - (urgencyOrder[b.urgency] || 4);
    });
  }

  _getDailyActivitySuggestions(metrics, farmProfile) {
    const activities = [];
    const { maxWind, maxHeat, minNight, avgRain, avgHumidity } = metrics;
    const { hasIrrigation, animalsCount, livestockTypes, hasGreenhouse } = farmProfile;

    const schedule = {
      morning: { timeWindow: "05:00-12:00", tasks: [] },
      afternoon: { timeWindow: "12:00-18:00", tasks: [] },
      evening: { timeWindow: "18:00-21:00", tasks: [] },
    };

    // Morning farming
    if (maxWind < 38 && avgRain < 5) {
      schedule.morning.tasks.push("Pesticide spraying (optimal wind conditions)");
      schedule.morning.tasks.push("Field scouting for pests/disease");
    }
    if (hasIrrigation && avgRain < 2) {
      schedule.morning.tasks.push("Begin irrigation cycles");
    }
    schedule.morning.tasks.push("General crop inspection");

    // Afternoon operations
    if (maxHeat < 25) {
      schedule.afternoon.tasks.push("Machinery operation and cultivation");
      schedule.afternoon.tasks.push("Harvesting (if applicable)");
    } else {
      schedule.afternoon.tasks.push("Indoor/covered work, maintenance");
    }
    if (animalsCount > 0 && maxHeat > 28) {
      schedule.afternoon.tasks.push("Reduce livestock outdoor exposure; increase water access");
    } else if (animalsCount > 0) {
      schedule.afternoon.tasks.push("Livestock feeding and health checks");
    }

    // Evening operations
    if (maxWind < 32 && avgRain < 3) {
      schedule.evening.tasks.push("Final pesticide application window");
    } else {
      schedule.evening.tasks.push("Equipment maintenance and preparation");
    }
    if (hasGreenhouse) {
      schedule.evening.tasks.push("Greenhouse ventilation adjustment and monitoring");
    }
    schedule.evening.tasks.push("Staff debriefing and next-day planning");

    return schedule;
  }

  getUserInsights(options = {}) {
    const date = options.date || this._toISODate(new Date());
    const requestedRegion = options.region || this.region;
    const region = this.normalizeRegion(requestedRegion);
    const userContext = options.userContext || {};

    // Get weather data
    const today = this.getDaily(date, { region });
    const tomorrow = this._addDays(this._parseISODate(date), 1);
    const forecast = this.getForecast({
      baseDate: this._toISODate(tomorrow),
      days: 3,
      region,
    }).forecast;

    // Build farm profile
    const farmProfile = this._buildFarmProfile(userContext);

    // Calculate aggregated weather metrics
    const metrics = this._calculateWeatherMetrics(today, forecast);

    // Generate personalized analysis
    const risks = this._assessRisks(metrics, farmProfile);
    const impactScores = this._calculateFarmImpactScores(metrics, farmProfile);
    const recommendations = this._generateRecommendations(metrics, farmProfile, risks, impactScores);
    const activitySchedule = this._getDailyActivitySuggestions(metrics, farmProfile);

    return {
      date,
      region,
      summary: {
        todayCondition: today.condition,
        averageNext3DaysRainMm: Number(metrics.avgRain.toFixed(1)),
        maxNext3DaysWindKmh: metrics.maxWind,
        maxNext3DaysTempC: Number(metrics.maxHeat.toFixed(1)),
      },
      farmProfile: {
        fieldsCount: farmProfile.fieldsCount,
        totalAreaHa: Number(farmProfile.totalAreaHa.toFixed(2)),
        staffCount: farmProfile.staffCount,
        animalsCount: farmProfile.animalsCount,
        cropTypes: farmProfile.cropTypes,
        livestockTypes: farmProfile.livestockTypes,
        hasIrrigation: farmProfile.hasIrrigation,
        hasGreenhouse: farmProfile.hasGreenhouse,
      },
      impactScores: {
        sprayingFeasibility: Number(impactScores.sprayingFeasibility.toFixed(1)),
        soilWorkability: Number(impactScores.soilWorkability.toFixed(1)),
        irrigationNeed: Number(impactScores.irrigationNeed.toFixed(1)),
        cropStress: Number(impactScores.cropStress.toFixed(1)),
        livestockStress: Number(impactScores.livestockStress.toFixed(1)),
        machineryRisk: Number(impactScores.machineryRisk.toFixed(1)),
      },
      risks,
      recommendations,
      activitySchedule,
      advisory: today.advisory,
    };
  }
}

module.exports = (region = "PL-14") => new WeatherService({ region });
