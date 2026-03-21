import { describe, test, expect, vi } from "vitest";
import fc from "fast-check";
const ResourceService = require("../../services/resource.service");
const ALLOWED_ANIMAL_TYPES = require("../../data/animal-types").ALLOWED_ANIMAL_TYPES;

const resource = new ResourceService("fields");

describe("ResourceService property-based tests", () => {
  test("_matchesSearch returns false for non-object input", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined), fc.boolean()), (value) => {
        expect(resource._matchesSearch(value, "x")).toBe(false);
      }),
    );
  });

  test("_matchesSearch returns true when any string field includes search term", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (name, district, cropType) => {
        const item = { name, district, cropType };
        const search = name.substr(0, 1).toLowerCase();
        const result = resource._matchesSearch(item, search);
        expect(result).toBe(true);
      }),
    );
  });

  test("validateAnimal enforces core rules", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom("cow", "pig", "sheep", "chicken", "horse"), { nil: undefined }),
        fc.float({ min: -1000, max: 1000, noNaN: true }),
        fc.oneof(fc.constant(null), fc.integer(), fc.string(), fc.float({ noNaN: true })),
        (type, amount, fieldId) => {
          const validator = resource.validateAnimal({ type, amount, fieldId });
          const typeValid = type && ALLOWED_ANIMAL_TYPES[type];
          const amountValid = !isNaN(Number(amount)) && Number(amount) > 0;
          const fieldIdValid = fieldId === undefined || fieldId === null || !isNaN(Number(fieldId));

          if (typeValid && amountValid && fieldIdValid) {
            expect(validator).toEqual([]);
          } else {
            expect(validator.length).toBeGreaterThan(0);
          }
        },
      ),
    );
  });

  test("listDistricts aggregates districts case-insensitively and area sums match", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.integer({ min: 1, max: 5 }),
            districtName: fc.string({ minLength: 1, maxLength: 20 }),
            area: fc.float({ min: 0, max: 100, noNaN: true }),
          }),
        ),
        fc.integer({ min: 1, max: 5 }),
        async (fields, userId) => {
          const service = new ResourceService("fields");
          vi.spyOn(service.db, "find").mockImplementation(async (predicate) => fields.filter(predicate));

          const rawSelected = fields.filter((f) => Number(f.userId) === userId);
          const result = await service.listDistricts(userId);

          const byNorm = rawSelected.reduce((acc, f) => {
            const name = (f.districtName || "").trim();
            if (!name) return acc;
            const norm = name.toLowerCase();
            acc[norm] = acc[norm] || { fieldsCount: 0, fieldsAreaHa: 0, displayName: name };
            acc[norm].fieldsCount += 1;
            acc[norm].fieldsAreaHa += Number(f.area) || 0;
            return acc;
          }, {});

          Object.values(byNorm).forEach((agg) => {
            expect(result[agg.displayName]).toBeDefined();
            expect(result[agg.displayName].fieldsCount).toBe(agg.fieldsCount);
            expect(result[agg.displayName].fieldsAreaHa).toBeCloseTo(agg.fieldsAreaHa, 4);
          });

          service.db.find.mockRestore();
        },
      ),
    );
  });

  test("list with pagination returns stable boundaries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.integer({ min: 1, max: 5 }),
            name: fc.string({ minLength: 1, maxLength: 10 }),
          }),
          { minLength: 1, maxLength: 70 },
        ),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 100 }),
        async (items, userId, page, limit) => {
          const service = new ResourceService("fields");
          vi.spyOn(service.db, "find").mockImplementation(async (predicate) => items.filter(predicate));

          const filtered = items.filter((item) => item.userId === Number(userId));
          const result = await service.list(userId, { paginate: true, page, limit });
          const expectedTotal = filtered.length;

          expect(result.pagination.totalItems).toBe(expectedTotal);
          expect(result.pagination.limit).toBe(Math.min(100, Math.max(1, limit)));
          expect(result.pagination.page).toBeLessThanOrEqual(result.pagination.totalPages);
          expect(result.items.length).toBeLessThanOrEqual(result.pagination.limit);

          service.db.find.mockRestore();
        },
      ),
    );
  });
});
