import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ResourceService from "../../services/resource.service.js";

const FIELDS = [
  { id: 1, userId: 1, districtName: "Krakow ", area: 10 },
  { id: 2, userId: 2, districtName: "krakow", area: 5 },
  { id: 3, userId: 1, districtName: "Warszawa", area: 20 },
];

describe("resource.service districts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("respects userId filtering when listing districts", async () => {
    const service = new ResourceService("fields");
    vi.spyOn(service.db, "find").mockImplementation(async (predicate) => FIELDS.filter(predicate));

    const result = await service.listDistricts(1);

    expect(result).toEqual({
      Krakow: { fieldsCount: 1, fieldsAreaHa: 10 },
      Warszawa: { fieldsCount: 1, fieldsAreaHa: 20 },
    });
  });

  it("aggregates districts case-insensitively and trims name for single-district lookup", async () => {
    const service = new ResourceService("fields");
    vi.spyOn(service.db, "find").mockImplementation(async (predicate) => FIELDS.filter(predicate));

    const result = await service.listDistricts(undefined, "krakow");

    expect(result).toEqual({ districtName: "krakow", fieldsCount: 2, fieldsAreaHa: 15 });
  });
});
