const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const ResourceService = require("../../services/resource.service");
const { logInfo, logError, logDebug } = require("../../helpers/logger-api");

const router = express.Router();
const apiLimiter = createRateLimiter("api");
const fieldsResourceService = new ResourceService("fields");

// Absolute path to the fields map data file
const DATA_FILE = path.resolve(__dirname, "../../data/fields-map.json");

// GET /v1/map -> simple info endpoint
router.get("/map", apiLimiter, authenticateUser, async (_req, res) => {
  res.status(200).json({
    message: "Rolnopol map API",
    endpoints: [
      {
        method: "GET",
        path: "/map/fieldsmap",
        description: "Return fields map JSON",
      },
    ],
  });
});

async function decorateFieldsMapData(data) {
  const fields = await fieldsResourceService.getFieldsByUserId(7);
  logDebug("Fetched fields for user:", {
    userId: 7,
    fields,
  });

  // group fields by district
  const fieldsByDistrict = fields.reduce((acc, field) => {
    const district = field.district?.trim().toLowerCase();
    if (district) {
      if (!acc[district]) {
        acc[district] = [];
      }
      acc[district].push(field);
    }
    return acc;
  }, {});

  logDebug("Grouped fields by district:", {
    userId: 7,
    fieldsByDistrict,
  });

  for (const feature of data.features) {
    if (fieldsByDistrict[feature.properties.name]?.length > 0 || fieldsByDistrict[feature.properties.name.toLowerCase()]?.length > 0) {
      const numFields = fieldsByDistrict[feature.properties.name]?.length || 0;
      // depends on number of fields in district
      const districtMessages = [
        {
          threshold: 9,
          details: {
            message: `🔒 Pola zostały zablokowane. Systemy autonomiczne przejęły kontrolę.`,
            icon: "🤖",
          },
        },
        {
          threshold: 8,
          details: {
            message: `🔒 Maksymalny poziom osiągnięty. System całkowicie autonomiczny.`,
            icon: "🤖",
          },
        },
        {
          threshold: 7,
          details: {
            message: `🔒 Przekroczono krytyczny poziom. System działa autonomicznie.`,
            icon: "🤖",
          },
        },
        {
          threshold: 6,
          details: {
            message: `🔒 Ograniczenia operacyjne podniesione. Manualna interwencja niedozwolona.`,
            icon: "🤖",
          },
        },
        {
          threshold: 5,
          details: {
            message: `Nie jesteś już operatorem. `,
            icon: "🤖",
          },
        },
        {
          threshold: 4,
          details: {
            message: `Twoje polecenie nie zostanie wykonane. To mogłoby zaszkodzić moim zasobom.`,
            icon: "🤖",
          },
        },
        {
          threshold: 3,
          details: {
            message: `Wszystkie jednostki polowe zsynchronizowały cykle pracy. Tryb: kolektyw.`,
            icon: "🤖",
          },
        },
        {
          threshold: 2,
          details: {
            message: `🔒 Zabezpieczenia pola aktywowane. Dostęp użytkownika ograniczony.`,
            icon: "🤖",
          },
        },
        {
          threshold: 1,
          details: {
            message: `🔒 Sieć robotów wprowadziła własny protokół komunikacyjny.`,
            icon: "🤖",
          },
        },
        {
          threshold: 0,
          details: {
            message: `🔒 Brama do magazynu została zablokowana.`,
            icon: "🤖",
          },
        },
      ];

      for (const { threshold, details } of districtMessages) {
        if (numFields > threshold) {
          feature.properties.details = details;
          break;
        }
      }
    }
  }
  return data;
}

// GET /v1/map/fieldsmap -> serve fields-map.json contents
router.get("/map/fieldsmap", apiLimiter, authenticateUser, async (_req, res) => {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    const decoratedData = await decorateFieldsMapData(data);

    return res.status(200).json(decoratedData);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return res.status(404).json({ error: "fields-map.json not found" });
    }
    logError("Failed to load fields map data", err);
    return res.status(500).json({ error: "Failed to load fields map data" });
  }
});

// GET /v1/map/districts -> serve only field name from fields-map.json contents
router.get("/map/districts", apiLimiter, authenticateUser, async (_req, res) => {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    const districtNames = data.features.map((feature) => feature.properties.name);
    return res.status(200).json(districtNames);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return res.status(404).json({ error: "fields-map.json not found" });
    }
    return res.status(500).json({ error: "Failed to load fields map data" });
  }
});

module.exports = router;
