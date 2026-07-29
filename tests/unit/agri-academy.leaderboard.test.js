import { describe, it, expect } from "vitest";
const path = require("path");
const os = require("os");

// Throwaway DB + silent logs before requiring the service (index.js wires db/config on load).
process.env.EXAM_CENTER_DB_PATH = path.join(os.tmpdir(), `aa-leaderboard-unit-${process.pid}.json`);
process.env.AGRI_ACADEMY_LOG = "silent";

const AA = path.join(__dirname, "..", "..", "external-services", "agri-academy", "exam-center-service");
const { computeLeaderboards, learnerAlias, aggregateRatings } = require(path.join(AA, "server", "index.js"));

// Two learners, one unit with activity + one seeded-only unit, three exams.
const DATA = {
  users: {
    "2": {
      sessions: {
        s1: { examId: "e1", state: "scored", rating: { stars: 5 }, snapshot: { ownerUnitId: "u1", unitName: "Green", title: "Soil", pricing: { mode: "free" } }, result: { scorePct: 90, passed: true, certNo: "C1" } },
        s2: { examId: "e2", state: "scored", rating: { stars: 3 }, snapshot: { ownerUnitId: "u1", title: "Organic", pricing: { mode: "paid", priceRol: 25 } }, result: { scorePct: 80, passed: true, certNo: "C2" } },
      },
    },
    "3": {
      sessions: {
        s3: { examId: "e1", state: "scored", snapshot: { ownerUnitId: "u1", title: "Soil" }, result: { scorePct: 50, passed: false, certNo: null } },
        s4: { examId: "e3", state: "entitled", snapshot: { ownerUnitId: "u2", title: "Combine" } },
      },
    },
  },
};
const UNITS = [
  { unitId: "u1", name: "Green Acres", icon: "seedling", color: "#2e8f55" },
  { unitId: "u2", name: "Ironfield", icon: "tractor", color: "#c9743a" },
];
const EXAMS = [
  { id: "e1", title: "Soil Health", ownerUnitId: "u1", pricing: { mode: "free" } },
  { id: "e2", title: "Organic", ownerUnitId: "u1", pricing: { mode: "paid", priceRol: 25 } },
  { id: "e3", title: "Combine", ownerUnitId: "u2", pricing: { mode: "paid", priceRol: 40 } },
];

describe("computeLeaderboards", () => {
  const boards = computeLeaderboards(DATA, UNITS, EXAMS);

  it("ranks units by certificates and seeds zero-activity units", () => {
    expect(boards.units[0].unitId).toBe("u1");
    const u1 = boards.units.find((u) => u.unitId === "u1");
    expect(u1).toMatchObject({ enrollments: 3, learners: 2, completed: 3, passed: 2, certificates: 2, passRate: 67 });
    expect(u1.avgScore).toBe(73); // (90+80+50)/3
    expect(u1.name).toBe("Green Acres"); // catalog name wins over the session snapshot
    expect(u1.avgRating).toBe(4); // (5 + 3) / 2
    expect(u1.ratings).toBe(2);
    const u2 = boards.units.find((u) => u.unitId === "u2");
    expect(u2).toMatchObject({ enrollments: 1, completed: 0, certificates: 0, avgScore: 0 }); // seeded despite no completions
    expect(boards.units.every((u, i) => u.rank === i + 1)).toBe(true);
  });

  it("carries a stable alias + round-tripped userId for the bridge to anonymize", () => {
    expect(boards.learners[0].certificates).toBe(2); // user "2" leads
    expect(boards.learners[0].bestScore).toBe(90);
    for (const l of boards.learners) {
      expect(l.userId).toBeTruthy(); // the bridge resolves this to a first-name alias, then strips it
      expect(l.alias).toMatch(/^\w+ \w+ #\d+$/);
    }
    // Deterministic + collision-free for these ids.
    expect(learnerAlias("2")).toBe(learnerAlias("2"));
    expect(learnerAlias("2")).not.toBe(learnerAlias("3"));
  });

  it("ranks exams by average star rating, then resolves the owning unit name", () => {
    expect(boards.exams.map((e) => e.examId)).toEqual(["e1", "e2", "e3"]); // avgRating 5, 3, 0
    expect(boards.exams.find((e) => e.examId === "e1")).toMatchObject({ avgRating: 5, ratings: 1, unitName: "Green Acres" });
    expect(boards.exams.find((e) => e.examId === "e2")).toMatchObject({ avgRating: 3, ratings: 1, mode: "paid", priceRol: 25 });
    expect(boards.exams.find((e) => e.examId === "e3")).toMatchObject({ avgRating: 0, ratings: 0 });
  });

  it("reports ecosystem totals", () => {
    expect(boards.totals).toEqual({ units: 2, learners: 2, exams: 3, certificates: 2 });
  });
});

describe("aggregateRatings", () => {
  const r = aggregateRatings(DATA);

  it("averages ratings per exam and omits never-rated exams", () => {
    expect(r.exams["e1"]).toEqual({ rating: 5, ratings: 1 });
    expect(r.exams["e2"]).toEqual({ rating: 3, ratings: 1 });
    expect(r.exams["e3"]).toBeUndefined();
  });

  it("pools every exam rating into the unit average", () => {
    expect(r.units["u1"]).toEqual({ rating: 4, ratings: 2 }); // mean(5, 3)
    expect(r.units["u2"]).toBeUndefined(); // no ratings under this unit
  });
});
