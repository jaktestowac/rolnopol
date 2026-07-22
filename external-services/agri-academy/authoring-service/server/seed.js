/**
 * Self-seed content for the authoring service.
 *
 * A built-in demo unit plus two published exams whose ids match the question
 * bank's self-seeded demo pools ("pesticide-basics", "tractor-safety"), and a
 * further catalogue of four real-looking certification units (owned by Rolnopol
 * users) with eight published exams — a mix of free and paid — whose ids match
 * the question bank's seeded pools ("exam-5" … "exam-12"). This makes a freshly
 * booted ecosystem takeable end to end AND gives a populated directory to browse.
 * Real units register and author their own exams at runtime.
 *
 * Sessions and certificates are NOT seeded here: they are runtime artefacts
 * (see exam-center + certificate-issuer, which both boot empty).
 *
 * NOTE: keep this in sync with the `agriAcademyAuthoring` snapshot in
 * data/database-base-state.json — the debug "restore base state" endpoint and
 * the test bootstrap restore from that file, so the seed and the snapshot must
 * describe the same initial state.
 */
const { nowIso } = require("../../shared/clock");

function buildSeed() {
  const at = nowIso();
  const demoUnitId = "unit-demo";
  const demoExam = (id, title, description, questionCount, durationSec, accessWindowDays, passPct, certTemplate) => ({
    id,
    ownerUnitId: demoUnitId,
    title,
    description,
    questionCount,
    durationSec,
    accessWindowDays,
    passPct,
    attemptsAllowed: 3,
    certValidMonths: 24,
    certTemplate: certTemplate || "classic-green",
    pricing: { mode: "free", priceRol: 0 },
    status: "published",
    createdAt: at,
    updatedAt: at,
  });

  // A published exam owned by one of the seeded catalogue units.
  const exam = (id, ownerUnitId, title, description, questionCount, durationSec, accessWindowDays, passPct, attemptsAllowed, certValidMonths, certTemplate, pricing, createdAt) => ({
    id,
    ownerUnitId,
    title,
    description,
    questionCount,
    durationSec,
    accessWindowDays,
    passPct,
    attemptsAllowed,
    certValidMonths,
    certTemplate,
    pricing,
    status: "published",
    createdAt,
    updatedAt: createdAt,
  });

  return {
    version: 1,
    seq: 12,
    units: {
      [demoUnitId]: {
        unitId: demoUnitId,
        ownerUserId: "demo-owner",
        name: "Rolnopol Demo Certification Unit",
        description: "A built-in demo unit showcasing free farm-skill certifications. Register your own unit to author exams.",
        contactEmail: "demo@agri-academy.example",
        tags: ["pesticides", "tractors", "safety"],
        color: "#3fae6b",
        icon: "wheat-awn",
        payoutUserId: "demo-owner",
        createdAt: at,
        status: "active",
      },
      "unit-1": {
        unitId: "unit-1",
        ownerUserId: "2",
        name: "Green Acres Training Co-op",
        description: "Farmer-led co-operative delivering practical certifications in soil health, nutrient management, and organic production.",
        contactEmail: "training@greenacres.coop",
        tags: ["soil", "crops", "organic", "nutrients"],
        color: "#2e8f55",
        icon: "seedling",
        payoutUserId: "2",
        createdAt: "2026-04-12T09:15:00.000Z",
        status: "active",
      },
      "unit-2": {
        unitId: "unit-2",
        ownerUserId: "3",
        name: "Ironfield Machinery School",
        description: "Hands-on operator training and safety certification for tractors, combines, and powered farm equipment.",
        contactEmail: "enrol@ironfield-machinery.example",
        tags: ["machinery", "tractors", "safety", "maintenance"],
        color: "#c9743a",
        icon: "tractor",
        payoutUserId: "3",
        createdAt: "2026-04-28T13:40:00.000Z",
        status: "active",
      },
      "unit-3": {
        unitId: "unit-3",
        ownerUserId: "4",
        name: "Meadowbrook Livestock & Welfare",
        description: "Animal-welfare and husbandry certifications for dairy, beef, and mixed livestock holdings.",
        contactEmail: "welfare@meadowbrook.example",
        tags: ["livestock", "dairy", "welfare", "animals"],
        color: "#4a90d9",
        icon: "cow",
        payoutUserId: "4",
        createdAt: "2026-05-06T08:05:00.000Z",
        status: "active",
      },
      "unit-4": {
        unitId: "unit-4",
        ownerUserId: "5",
        name: "Orchard & Vine Guild",
        description: "Horticulture certifications covering fruit-tree management, pruning, and vineyard pest control.",
        contactEmail: "guild@orchardandvine.example",
        tags: ["orchard", "vineyard", "pruning", "horticulture"],
        color: "#8b5cf6",
        icon: "apple-whole",
        payoutUserId: "5",
        createdAt: "2026-05-19T15:22:00.000Z",
        status: "active",
      },
    },
    exams: {
      "pesticide-basics": demoExam(
        "pesticide-basics",
        "Pesticide Handling Basics",
        "Core safety rules for storing, mixing, and applying agricultural pesticides.",
        3,
        1800,
        7,
        60,
        "botanical",
      ),
      "tractor-safety": demoExam(
        "tractor-safety",
        "Tractor Safety",
        "Safe operation, maintenance checks, and hazard awareness for farm tractors.",
        3,
        1200,
        14,
        70,
        "gold-formal",
      ),
      "exam-5": exam("exam-5", "unit-1", "Soil Health & Nutrient Management", "Understanding soil structure, testing, organic matter, and balanced nutrient application.", 6, 1800, 14, 60, 3, 24, "botanical", { mode: "free", priceRol: 0 }, "2026-04-15T10:00:00.000Z"),
      "exam-6": exam("exam-6", "unit-1", "Organic Farming Certification", "Standards, record-keeping, and prohibited inputs for certified organic crop production.", 8, 2400, 30, 75, 2, 36, "classic-green", { mode: "paid", priceRol: 25 }, "2026-04-20T11:30:00.000Z"),
      "exam-7": exam("exam-7", "unit-2", "Combine Harvester Operation", "Safe set-up, in-field operation, and settings for grain and oilseed harvesting.", 7, 2100, 21, 75, 3, 24, "rustic-kraft", { mode: "paid", priceRol: 40 }, "2026-05-01T09:00:00.000Z"),
      "exam-8": exam("exam-8", "unit-2", "Farm Machinery Maintenance", "Routine servicing, lubrication, and pre-season checks for common farm machinery.", 6, 1500, 14, 70, 3, 18, "slate-minimal", { mode: "free", priceRol: 0 }, "2026-05-03T14:10:00.000Z"),
      "exam-9": exam("exam-9", "unit-3", "Livestock Welfare & Handling", "Low-stress handling, the five freedoms, and recognising signs of ill health.", 7, 1800, 21, 70, 3, 24, "modern-teal", { mode: "paid", priceRol: 30 }, "2026-05-08T09:45:00.000Z"),
      "exam-10": exam("exam-10", "unit-3", "Dairy Hygiene & Milk Quality", "Milking routine, udder health, cleaning-in-place, and cold-chain basics.", 6, 1500, 14, 65, 3, 18, "midnight", { mode: "free", priceRol: 0 }, "2026-05-11T08:20:00.000Z"),
      "exam-11": exam("exam-11", "unit-4", "Fruit Tree Pruning Fundamentals", "Timing, cut types, and shaping for healthy, productive fruit trees.", 5, 1200, 14, 60, 3, 24, "sunrise", { mode: "free", priceRol: 0 }, "2026-05-21T10:30:00.000Z"),
      "exam-12": exam("exam-12", "unit-4", "Vineyard Pest & Disease Management", "Identifying and managing common vine pests and fungal diseases with an IPM approach.", 6, 1800, 21, 70, 2, 24, "royal-purple", { mode: "paid", priceRol: 20 }, "2026-05-25T13:00:00.000Z"),
    },
  };
}

module.exports = { buildSeed };
