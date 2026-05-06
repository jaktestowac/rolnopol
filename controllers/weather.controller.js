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
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\r?\n|\r/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  _truncatePdfText(value, maxLength = 48) {
    const text = this._escapePdfText(value);
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  _hexToRgb(hex) {
    const normalized = String(hex || "#000000").replace(/^#/, "");
    const expanded =
      normalized.length === 3
        ? normalized
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
        : normalized.padEnd(6, "0").slice(0, 6);
    const channels = [0, 2, 4].map((start) => Number.parseInt(expanded.slice(start, start + 2), 16));
    return channels.map((channel) => (Number.isFinite(channel) ? channel / 255 : 0));
  }

  _pdfColor(hex, stroke = false) {
    const [r, g, b] = this._hexToRgb(hex).map((value) => value.toFixed(3));
    return `${r} ${g} ${b} ${stroke ? "RG" : "rg"}`;
  }

  _pdfRect({ x, y, w, h, fill, stroke, strokeWidth = 1 }) {
    const commands = ["q"];

    if (stroke) {
      commands.push(this._pdfColor(stroke, true));
      commands.push(`${strokeWidth} w`);
    }

    if (fill) {
      commands.push(this._pdfColor(fill));
    }

    commands.push(`${x} ${y} ${w} ${h} re`);
    if (fill && stroke) {
      commands.push("B");
    } else if (fill) {
      commands.push("f");
    } else {
      commands.push("S");
    }

    commands.push("Q");
    return commands.join("\n");
  }

  _pdfText({ x, y, text, size = 12, font = "F1", color = "#111827" }) {
    return ["BT", `/${font} ${size} Tf`, this._pdfColor(color), `${x} ${y} Td`, `(${this._escapePdfText(text)}) Tj`, "ET"].join("\n");
  }

  _conditionAccentColor(condition) {
    const label = String(condition || "").toLowerCase();

    if (label.includes("storm")) return "#7C3AED";
    if (label.includes("heavy rain") || label.includes("rain")) return "#2563EB";
    if (label.includes("sleet") || label.includes("snow")) return "#0EA5E9";
    if (label.includes("wind")) return "#0F766E";
    if (label.includes("cloud")) return "#64748B";
    return "#16A34A";
  }

  _buildPdfBuffer(commands) {
    const content = commands.join("\n");

    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
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

  _buildSimplePdf(lines) {
    const commands = [
      this._pdfRect({ x: 0, y: 0, w: 595, h: 842, fill: "#FFFFFF" }),
      this._pdfText({
        x: 50,
        y: 782,
        text: this._truncatePdfText(lines[0] || "Weather export", 44),
        size: 20,
        font: "F2",
        color: "#0F172A",
      }),
    ];

    lines.slice(1).forEach((line, index) => {
      const y = 758 - index * 16;
      commands.push(this._pdfText({ x: 50, y, text: this._truncatePdfText(line, 74), size: 10, font: "F1", color: "#334155" }));
    });

    return this._buildPdfBuffer(commands);
  }

  _buildWeatherExportPdf(payload) {
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    const headerHeight = 132;
    const cardGap = 12;
    const cardWidth = (contentWidth - cardGap * 3) / 4;
    const cardY = 596;
    const cardHeight = 76;
    const tableTop = 506;
    const tableHeaderHeight = 26;
    const rowHeight = 30;
    const tableColumns = [
      { key: "date", label: "Date", width: 64 },
      { key: "condition", label: "Condition", width: 78 },
      { key: "temperature", label: "Temp", width: 92 },
      { key: "weatherLoad", label: "Rain / wind", width: 94 },
      { key: "humidity", label: "Humidity", width: 58 },
      { key: "advisory", label: "Advisory", width: 129 },
    ];

    const commands = [
      this._pdfRect({ x: 0, y: 0, w: pageWidth, h: pageHeight, fill: "#F5F7FB" }),
      this._pdfRect({ x: 0, y: pageHeight - headerHeight, w: pageWidth, h: headerHeight, fill: "#0F172A" }),
      this._pdfRect({ x: 0, y: pageHeight - headerHeight - 6, w: pageWidth, h: 6, fill: "#38BDF8" }),
      this._pdfText({ x: margin, y: 792, text: "Weather Data Export", size: 24, font: "F2", color: "#FFFFFF" }),
      this._pdfText({ x: margin, y: 770, text: "Rolnopol weather snapshot", size: 10, font: "F1", color: "#D6E4FF" }),
      this._pdfRect({ x: margin, y: 728, w: 168, h: 24, fill: "#14B8A6" }),
      this._pdfText({ x: margin + 11, y: 736, text: "Warning:", size: 9, font: "F2", color: "#FFFFFF" }),
      this._pdfText({
        x: margin + 184,
        y: 736,
        text: this._truncatePdfText(payload?.constraints?.message || "", 64),
        size: 8,
        font: "F1",
        color: "#E2E8F0",
      }),
    ];

    const cards = [
      { label: "Seed date", value: payload.seed, note: "snapshot anchor", accent: "#2563EB" },
      { label: "Region", value: payload.region, note: "normalized code", accent: "#0F766E" },
      { label: "Forecast days", value: String(payload.forecastDays + 1), note: "days in export", accent: "#7C3AED" },
      { label: "Rows", value: String(payload.rows.length), note: "daily + forecast", accent: "#F59E0B" },
    ];

    cards.forEach((card, index) => {
      const x = margin + index * (cardWidth + cardGap);
      commands.push(this._pdfRect({ x, y: cardY, w: cardWidth, h: cardHeight, fill: "#FFFFFF", stroke: "#D8E1EE" }));
      commands.push(this._pdfRect({ x, y: cardY + cardHeight - 5, w: cardWidth, h: 5, fill: card.accent }));
      commands.push(this._pdfText({ x: x + 10, y: cardY + 50, text: card.label.toUpperCase(), size: 7, font: "F2", color: "#64748B" }));
      commands.push(
        this._pdfText({ x: x + 10, y: cardY + 30, text: this._truncatePdfText(card.value, 22), size: 14, font: "F2", color: "#0F172A" }),
      );
      commands.push(this._pdfText({ x: x + 10, y: cardY + 14, text: card.note, size: 7, font: "F1", color: "#64748B" }));
    });

    commands.push(this._pdfText({ x: margin, y: 558, text: "Forecast details", size: 14, font: "F2", color: "#0F172A" }));
    commands.push(
      this._pdfText({
        x: margin,
        y: 542,
        text: "Weather forecast for the selected region and period.",
        size: 9,
        font: "F1",
        color: "#64748B",
      }),
    );
    commands.push(this._pdfRect({ x: margin, y: 534, w: contentWidth, h: 1, fill: "#D8E1EE" }));

    commands.push(this._pdfRect({ x: margin, y: tableTop, w: contentWidth, h: tableHeaderHeight, fill: "#1E293B" }));

    let columnX = margin;
    tableColumns.forEach((column) => {
      commands.push(
        this._pdfText({ x: columnX + 8, y: tableTop + 8, text: column.label.toUpperCase(), size: 7, font: "F2", color: "#FFFFFF" }),
      );
      columnX += column.width;
    });

    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 8) : [];
    const tableStartY = tableTop - tableHeaderHeight;

    rows.forEach((day, index) => {
      const rowTop = tableStartY - index * rowHeight;
      const rowBottom = rowTop - rowHeight;
      const rowFill = index % 2 === 0 ? "#FFFFFF" : "#F8FAFF";
      const accent = this._conditionAccentColor(day?.condition);
      commands.push(this._pdfRect({ x: margin, y: rowBottom, w: contentWidth, h: rowHeight, fill: rowFill, stroke: "#E5ECF6" }));
      commands.push(this._pdfRect({ x: margin, y: rowBottom, w: 4, h: rowHeight, fill: accent }));

      const dateText = this._truncatePdfText(day?.date || "-", 12);
      const conditionText = this._truncatePdfText(day?.condition || "-", 18);
      const temperatureText = `${Number(day?.temperatureMinC || 0).toFixed(1)} / ${Number(day?.temperatureMaxC || 0).toFixed(1)} C`;
      const loadText = `${Number(day?.precipitationMm || 0).toFixed(1)} mm / ${Number(day?.windKmh || 0)} km/h`;
      const humidityText = `${Number(day?.humidityPct || 0)}%`;
      const advisoryText = this._truncatePdfText(day?.advisory || "", 42);

      let cellX = margin;
      commands.push(this._pdfText({ x: cellX + 10, y: rowBottom + 18, text: dateText, size: 8, font: "F2", color: "#0F172A" }));
      cellX += tableColumns[0].width;

      commands.push(this._pdfRect({ x: cellX + 8, y: rowBottom + 8, w: 68, h: 14, fill: accent }));
      commands.push(this._pdfText({ x: cellX + 12, y: rowBottom + 12, text: conditionText, size: 7, font: "F2", color: "#FFFFFF" }));
      cellX += tableColumns[1].width;

      commands.push(this._pdfText({ x: cellX + 8, y: rowBottom + 18, text: temperatureText, size: 8, font: "F1", color: "#334155" }));
      cellX += tableColumns[2].width;

      commands.push(this._pdfText({ x: cellX + 8, y: rowBottom + 18, text: loadText, size: 8, font: "F1", color: "#334155" }));
      cellX += tableColumns[3].width;

      commands.push(this._pdfText({ x: cellX + 8, y: rowBottom + 18, text: humidityText, size: 8, font: "F2", color: "#0F172A" }));
      cellX += tableColumns[4].width;

      commands.push(this._pdfText({ x: cellX + 8, y: rowBottom + 18, text: advisoryText || "-", size: 7, font: "F1", color: "#475569" }));
    });

    const footerY = 34;
    commands.push(this._pdfRect({ x: margin, y: footerY + 10, w: contentWidth, h: 1, fill: "#D8E1EE" }));
    commands.push(
      this._pdfText({
        x: margin,
        y: footerY - 2,
        text: "Prepared for offline sharing and quick agricultural planning.",
        size: 8,
        font: "F1",
        color: "#64748B",
      }),
    );

    return this._buildPdfBuffer(commands);
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

      const pdfBuffer = this._buildWeatherExportPdf(payload);
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
