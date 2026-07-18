import { describe, it, expect } from "vitest";
const path = require("path");

process.env.FARM_STAY_LOG = "silent";

const { sortSearchResults, paginate, SEARCH_SORTS } = require(
  path.join(__dirname, "..", "..", "external-services", "farm-stay", "stay-gateway-service", "server", "index.js"),
);

// Result fixtures: id, quote total (null = pricing unavailable), rating, capacity.
const mk = (id, total, avgRating, capacity) => ({
  id,
  quote: total == null ? null : { total },
  score: { avgRating, count: 1 },
  capacity,
});
const results = [
  mk("a", 200, 4.5, 2),
  mk("b", 100, 5.0, 6),
  mk("c", null, 3.0, 4), // unpriced
  mk("d", 150, 4.0, 8),
];

describe("farm-stay search — sortSearchResults()", () => {
  it("exposes the supported sort keys", () => {
    expect(SEARCH_SORTS).toEqual(["price_asc", "price_desc", "rating_desc", "capacity_desc"]);
  });

  it("returns the input order for an unknown/empty sort", () => {
    expect(sortSearchResults(results, "").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(sortSearchResults(results, "bogus").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("price_asc orders by quote total with unpriced listings last", () => {
    expect(sortSearchResults(results, "price_asc").map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("price_desc orders by quote total descending, unpriced still last", () => {
    expect(sortSearchResults(results, "price_desc").map((r) => r.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("rating_desc orders by average rating", () => {
    expect(sortSearchResults(results, "rating_desc").map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("capacity_desc orders by capacity", () => {
    expect(sortSearchResults(results, "capacity_desc").map((r) => r.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const before = results.map((r) => r.id);
    sortSearchResults(results, "price_asc");
    expect(results.map((r) => r.id)).toEqual(before);
  });
});

describe("farm-stay search — paginate()", () => {
  const items = Array.from({ length: 10 }, (_, i) => i + 1);

  it("defaults to a 24-item page (all 10 fit on page 1)", () => {
    const r = paginate(items, undefined, undefined);
    expect(r).toMatchObject({ page: 1, pageSize: 24, total: 10, totalPages: 1 });
    expect(r.slice).toHaveLength(10);
  });

  it("slices the requested page", () => {
    const r = paginate(items, 2, 3);
    expect(r).toMatchObject({ page: 2, pageSize: 3, total: 10, totalPages: 4 });
    expect(r.slice).toEqual([4, 5, 6]);
  });

  it("clamps an out-of-range page to the last page", () => {
    const r = paginate(items, 99, 4);
    expect(r.page).toBe(3); // ceil(10/4) = 3
    expect(r.slice).toEqual([9, 10]);
  });

  it("clamps page size to [1, 100] and page to >= 1", () => {
    expect(paginate(items, 0, 0).pageSize).toBe(24); // 0 → default
    expect(paginate(items, -5, 500).pageSize).toBe(100);
    expect(paginate(items, -5, 500).page).toBe(1);
  });

  it("reports at least one page even when empty", () => {
    const r = paginate([], 1, 10);
    expect(r).toMatchObject({ total: 0, totalPages: 1, page: 1 });
    expect(r.slice).toEqual([]);
  });
});
