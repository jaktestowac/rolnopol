import { describe, test, expect } from "vitest";
import fc from "fast-check";
import createWeatherService from "../../services/weather.service";

const weather = createWeatherService();

const conditionLabels = ["Storm", "Heavy rain", "Sleet", "Rain", "Snow", "Overcast", "Cloudy", "Windy", "Sunny"];

describe("WeatherService property-based tests", () => {
  test("_clamp always returns a value within min..max (bound-commutative)", () => {
    fc.assert(
      fc.property(fc.float({ noNaN: true }), fc.float({ noNaN: true }), fc.float({ noNaN: true }), (value, a, b) => {
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        const result = weather._clamp(value, min, max);
        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);
      }),
    );
  });

  test("_toISODate and _parseISODate are round-trip equivalent over valid dates", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date(1900, 0, 1), max: new Date(2100, 11, 30) }), (date) => {
        if (Number.isNaN(date.getTime())) {
          return true;
        }
        const iso = weather._toISODate(date);
        const roundTrip = weather._toISODate(weather._parseISODate(iso));
        expect(roundTrip).toBe(iso);
      }),
    );
  });

  test("_diffDaysUTC works with _addDays", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date(1950, 0, 1), max: new Date(2050, 11, 31) }),
        fc.integer({ min: -3650, max: 3650 }),
        (d, delta) => {
          const d2 = weather._addDays(d, delta);
          expect(weather._diffDaysUTC(d, d2)).toBe(delta);
        },
      ),
    );
  });

  test("_conditionLabel always returns one of the allowed labels", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -100, max: 60 }),
        fc.float({ min: 0, max: 50 }),
        fc.float({ min: 0, max: 100 }),
        fc.float({ min: 0, max: 120 }),
        (tempAvgC, rainMm, cloudPct, windKmh) => {
          const label = weather._conditionLabel(tempAvgC, rainMm, cloudPct, windKmh);
          expect(conditionLabels).toContain(label);
        },
      ),
    );
  });
});
