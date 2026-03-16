const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");

class WeatherController {
  _escapeCsv(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  _toCsv(rows) {
    return rows.map((row) => row.map((cell) => this._escapeCsv(cell)).join(",")).join("\n");
  }

  _escapePdfText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  _buildSimplePdf(lines) {
    const contentLines = [
      "BT",
      "/F1 10 Tf",
      "50 780 Td",
      "14 TL",
      ...lines.map((line, index) => `${index === 0 ? "" : "T* "}(${this._escapePdfText(line)}) Tj`),
      "ET",
    ].join("\n");

    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(contentLines, "utf8")} >>\nstream\n${contentLines}\nendstream`,
    ];

    let pdf = "%PDF-1.4\n";
    const offsets = [0];

    objects.forEach((obj, index) => {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";

    for (let i = 1; i <= objects.length; i += 1) {
      const offset = String(offsets[i]).padStart(10, "0");
      pdf += `${offset} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, "utf8");
  }

  _collectWeatherExportData(req) {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const requestedRegion = req.query.region || "PL-14";
    const requestedDays = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(requestedDays) ? Math.min(7, Math.max(1, requestedDays)) : 7;

    const weatherService = require("../services/weather.service")("PL-14");
    const region = weatherService.normalizeRegion(requestedRegion);

    const daily = weatherService.getDaily(date, { region });
    const selectedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(selectedDate.getTime())) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }

    const tomorrow = new Date(selectedDate.getTime() + 86400000).toISOString().slice(0, 10);
    const forecastPayload = weatherService.getForecast({
      baseDate: tomorrow,
      days,
      region,
    });

    const forecast = Array.isArray(forecastPayload?.forecast) ? forecastPayload.forecast : [];

    return {
      seed: date,
      region,
      forecastDays: Number(forecastPayload?.days || days),
      constraints: forecastPayload?.constraints,
      rows: [daily, ...forecast],
    };
  }

  async getRegions(req, res) {
    try {
      const weatherService = require("../services/weather.service")("PL-14");
      const regions = weatherService.getSupportedRegions();

      return res.status(200).json(
        formatResponseBody({
          data: {
            regions,
            defaultRegion: "PL-14",
          },
        }),
      );
    } catch (error) {
      logError("Error getting weather regions", { error });
      return res.status(500).json(
        formatResponseBody({
          error: error?.message || "Failed to get weather regions",
        }),
      );
    }
  }

  async getDaily(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const requestedRegion = req.query.region || "PL-14";
      const weatherService = require("../services/weather.service")("PL-14");
      const region = weatherService.normalizeRegion(requestedRegion);

      const weather = weatherService.getDaily(date, { region });
      return res.status(200).json(
        formatResponseBody({
          data: {
            seed: date,
            weather,
          },
        }),
      );
    } catch (error) {
      logError("Error getting daily weather", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to get daily weather",
        }),
      );
    }
  }

  async getForecast(req, res) {
    try {
      const baseDate = req.query.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const days = req.query.days || 7;
      const requestedRegion = req.query.region || "PL-14";
      const weatherService = require("../services/weather.service")("PL-14");
      const region = weatherService.normalizeRegion(requestedRegion);

      const payload = weatherService.getForecast({ baseDate, days, region });

      return res.status(200).json(
        formatResponseBody({
          data: {
            seed: baseDate,
            ...payload,
          },
          message: payload?.forecast?.length === 0 ? payload?.constraints?.message : undefined,
        }),
      );
    } catch (error) {
      logError("Error getting weather forecast", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to get weather forecast",
        }),
      );
    }
  }

  async getUserInsights(req, res) {
    try {
      const userId = Number(req?.user?.userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(401).json(
          formatResponseBody({
            error: "Access token required",
          }),
        );
      }

      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const requestedRegion = req.query.region || "PL-14";

      const dbManager = require("../data/database-manager");
      const [fields, staff, animals, userProfile] = await Promise.all([
        dbManager.getFieldsDatabase().find((item) => Number(item?.userId) === userId),
        dbManager.getStaffDatabase().find((item) => Number(item?.userId) === userId),
        dbManager.getAnimalsDatabase().find((item) => Number(item?.userId) === userId),
        dbManager.getUsersDatabase().find((u) => Number(u?.userId) === userId),
      ]);

      const fieldsCount = Array.isArray(fields) ? fields.length : 0;
      const staffCount = Array.isArray(staff) ? staff.length : 0;
      const animalsCount = Array.isArray(animals)
        ? animals.reduce((acc, animal) => acc + (Number(animal?.amount) > 0 ? Number(animal.amount) : 0), 0)
        : 0;
      const totalAreaHa = Array.isArray(fields) ? fields.reduce((acc, field) => acc + (Number(field?.area) || 0), 0) : 0;

      // Extract crop types from fields
      const cropTypes = Array.isArray(fields) ? [...new Set(fields.map((f) => f?.cropType || f?.type).filter(Boolean))] : [];

      // Extract livestock types from animals
      const livestockTypes = Array.isArray(animals) ? [...new Set(animals.map((a) => a?.type || a?.animalType).filter(Boolean))] : [];

      // Get user infrastructure info
      const hasGreenhouse = userProfile?.hasGreenhouse === true || userProfile?.infrastructure?.includes?.("greenhouse");
      const hasIrrigation = userProfile?.hasIrrigation === true || userProfile?.infrastructure?.includes?.("irrigation");
      const soilType = userProfile?.soilType || "loam";
      const equipment = Array.isArray(userProfile?.equipment) ? userProfile.equipment : [];

      const weatherService = require("../services/weather.service")("PL-14");
      const region = weatherService.normalizeRegion(requestedRegion);
      const insights = weatherService.getUserInsights({
        date,
        region,
        userContext: {
          fieldsCount,
          totalAreaHa,
          staffCount,
          animalsCount,
          cropTypes,
          livestockTypes,
          hasGreenhouse,
          hasIrrigation,
          soilType,
          equipment,
        },
      });

      return res.status(200).json(
        formatResponseBody({
          data: {
            seed: date,
            insights,
          },
        }),
      );
    } catch (error) {
      logError("Error getting personalized weather insights", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to get personalized weather insights",
        }),
      );
    }
  }

  async exportWeatherCsv(req, res) {
    try {
      const payload = this._collectWeatherExportData(req);

      const rows = [
        [
          "date",
          "region",
          "condition",
          "temperatureMinC",
          "temperatureMaxC",
          "precipitationMm",
          "humidityPct",
          "windKmh",
          "pressureHpa",
          "cloudCoverPct",
          "droughtIndex",
          "soilMoisturePct",
          "spellType",
          "advisory",
        ],
      ];

      for (const day of payload.rows) {
        rows.push([
          day?.date ?? "",
          day?.region ?? payload.region,
          day?.condition ?? "",
          Number(day?.temperatureMinC || 0).toFixed(1),
          Number(day?.temperatureMaxC || 0).toFixed(1),
          Number(day?.precipitationMm || 0).toFixed(1),
          Number(day?.humidityPct || 0),
          Number(day?.windKmh || 0),
          Number(day?.pressureHpa || 0),
          Number(day?.cloudCoverPct || 0),
          Number(day?.droughtIndex || 0),
          Number(day?.soilMoisturePct || 0),
          day?.spellType ?? "",
          day?.advisory ?? "",
        ]);
      }

      const csv = this._toCsv(rows);
      const regionSafe = String(payload.region || "PL-14").replace(/[^A-Za-z0-9-]/g, "-");
      const filename = `weather-data-${regionSafe}-${payload.seed}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    } catch (error) {
      logError("Error exporting weather CSV", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to export weather CSV",
        }),
      );
    }
  }

  async exportWeatherPdf(req, res) {
    try {
      const payload = this._collectWeatherExportData(req);

      const lines = [
        "Rolnopol - Weather Data Export",
        `Seed date: ${payload.seed}`,
        `Region: ${payload.region}`,
        `Forecast days included: ${payload.forecastDays}`,
        "",
      ];

      for (const day of payload.rows) {
        lines.push(
          `${day?.date || "-"} | ${day?.condition || "-"} | Tmin ${Number(day?.temperatureMinC || 0).toFixed(1)}C | Tmax ${Number(day?.temperatureMaxC || 0).toFixed(1)}C | Rain ${Number(day?.precipitationMm || 0).toFixed(1)}mm | Hum ${Number(day?.humidityPct || 0)}% | Wind ${Number(day?.windKmh || 0)}km/h`,
        );
      }

      if (payload?.constraints?.message) {
        lines.push("");
        lines.push(`Note: ${payload.constraints.message}`);
      }

      const pdfBuffer = this._buildSimplePdf(lines.slice(0, 45));
      const regionSafe = String(payload.region || "PL-14").replace(/[^A-Za-z0-9-]/g, "-");
      const filename = `weather-data-${regionSafe}-${payload.seed}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(pdfBuffer);
    } catch (error) {
      logError("Error exporting weather PDF", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to export weather PDF",
        }),
      );
    }
  }
}

module.exports = new WeatherController();
