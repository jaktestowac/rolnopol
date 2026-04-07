import { describe, it, expect, vi } from "vitest";
const featureFlagsService = require("../../services/feature-flags.service");

describe("rolnopolFarmlogEnabled feature flag", () => {
  it("is defined in predefined feature flags and defaults to false when the store is empty", async () => {
    const now = new Date("2026-04-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const getSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(null);
    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();

    const result = await featureFlagsService.getFeatureFlags();

    expect(result.flags).toHaveProperty("rolnopolFarmlogEnabled", false);
    expect(result.updatedAt).toBe(now.toISOString());
    expect(getSpy).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();

    getSpy.mockRestore();
    replaceSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns a description for rolnopolFarmlogEnabled via getFeaturesWithDescriptions", async () => {
    const dbData = {
      flags: { rolnopolFarmlogEnabled: false },
      updatedAt: "2026-04-06T00:00:00.000Z",
    };

    const getSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(dbData);
    const result = await featureFlagsService.getFeaturesWithDescriptions();

    expect(result.flags).toHaveProperty("rolnopolFarmlogEnabled");
    expect(result.flags.rolnopolFarmlogEnabled).toEqual({
      value: false,
      description: "Enable or disable the Rolnopol Blog Space (Farmlog) feature",
    });

    getSpy.mockRestore();
  });
});
