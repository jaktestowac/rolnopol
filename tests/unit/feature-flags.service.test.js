import { describe, it, expect, vi } from "vitest";
const featureFlagsService = require("../../services/feature-flags.service");

describe("feature-flags.service", () => {
  it("populates defaults when database is empty", async () => {
    const now = new Date("2026-02-07T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const getSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(null);
    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();

    const result = await featureFlagsService.getFeatureFlags();

    expect(result).toEqual({
      flags: {
        alertsEnabled: true,
        alertsSeverityFilterEnabled: true,
        rolnopolMapEnabled: true,
        docsSearchEnabled: false,
        docsAdvancedSearchEnabled: false,
        registrationStrongPasswordEnabled: false,
        contactFormEnabled: true,
        staffFieldsExportEnabled: false,
        financialReportsEnabled: false,
        financialCsvExportEnabled: false,
        prometheusMetricsEnabled: false,
        homeWelcomeVideoEnabled: false,
      },
      updatedAt: now.toISOString(),
    });

    expect(getSpy).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();

    getSpy.mockRestore();
    replaceSpy.mockRestore();
    vi.useRealTimers();
  });

  it("populates defaults when database data is an array", async () => {
    const now = new Date("2026-02-07T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const getSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue([]);
    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();

    const result = await featureFlagsService.getFeatureFlags();

    expect(result).toEqual({
      flags: {
        alertsEnabled: true,
        alertsSeverityFilterEnabled: true,
        rolnopolMapEnabled: true,
        docsSearchEnabled: false,
        docsAdvancedSearchEnabled: false,
        registrationStrongPasswordEnabled: false,
        contactFormEnabled: true,
        staffFieldsExportEnabled: false,
        financialReportsEnabled: false,
        financialCsvExportEnabled: false,
        prometheusMetricsEnabled: false,
        homeWelcomeVideoEnabled: false,
      },
      updatedAt: now.toISOString(),
    });

    expect(getSpy).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();

    getSpy.mockRestore();
    replaceSpy.mockRestore();
    vi.useRealTimers();
  });

  it("populates missing keys when data is incomplete", async () => {
    const now = new Date("2026-02-07T01:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const existing = {
      flags: { alertsEnabled: false },
      updatedAt: null,
    };

    const getSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(existing);
    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();

    const result = await featureFlagsService.getFeatureFlags();

    expect(result).toEqual({
      flags: {
        alertsEnabled: false,
        alertsSeverityFilterEnabled: true,
        rolnopolMapEnabled: true,
        docsSearchEnabled: false,
        docsAdvancedSearchEnabled: false,
        registrationStrongPasswordEnabled: false,
        contactFormEnabled: true,
        staffFieldsExportEnabled: false,
        financialReportsEnabled: false,
        financialCsvExportEnabled: false,
        prometheusMetricsEnabled: false,
        homeWelcomeVideoEnabled: false,
      },
      updatedAt: now.toISOString(),
    });

    expect(getSpy).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();

    getSpy.mockRestore();
    replaceSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns data when database is populated with all predefined keys", async () => {
    const payload = {
      flags: {
        alertsEnabled: true,
        alertsSeverityFilterEnabled: true,
        rolnopolMapEnabled: true,
        docsSearchEnabled: false,
        docsAdvancedSearchEnabled: false,
        registrationStrongPasswordEnabled: false,
        contactFormEnabled: true,
        staffFieldsExportEnabled: false,
        financialReportsEnabled: true,
        financialCsvExportEnabled: false,
        prometheusMetricsEnabled: false,
        homeWelcomeVideoEnabled: false,
      },
      updatedAt: "2026-02-07T00:00:00.000Z",
    };
    const getSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(payload);
    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();

    const result = await featureFlagsService.getFeatureFlags();

    expect(result).toEqual(payload);
    expect(getSpy).toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();

    getSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("updates flags and sets updatedAt on patch", async () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const existing = {
      flags: { alertsEnabled: false, constructor: true, prototype: true, invalid: "no" },
      updatedAt: null,
    };

    const updateSpy = vi.spyOn(featureFlagsService.db, "update").mockImplementation(async (updateFn) => updateFn(existing));

    const result = await featureFlagsService.updateFlags({
      alertsEnabled: true,
      experimentalDashboard: false,
    });

    expect(result).toEqual({
      flags: {
        alertsEnabled: true,
        experimentalDashboard: false,
      },
      updatedAt: now.toISOString(),
    });
    expect(updateSpy).toHaveBeenCalled();

    updateSpy.mockRestore();
    vi.useRealTimers();
  });

  it("replaces all flags and sets updatedAt on put", async () => {
    const now = new Date("2026-02-07T13:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const next = {
      flags: { marketplaceEnabled: true },
      updatedAt: now.toISOString(),
    };

    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();
    const getAllSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(next);

    const result = await featureFlagsService.replaceAllFlags({
      marketplaceEnabled: true,
    });

    expect(result).toEqual(next);
    expect(replaceSpy).toHaveBeenCalled();
    expect(getAllSpy).toHaveBeenCalled();

    replaceSpy.mockRestore();
    getAllSpy.mockRestore();
    vi.useRealTimers();
  });

  it("allows replacing flags with an empty object", async () => {
    const now = new Date("2026-02-07T14:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const next = {
      flags: {},
      updatedAt: now.toISOString(),
    };

    const replaceSpy = vi.spyOn(featureFlagsService.db, "replaceAll").mockResolvedValue();
    const getAllSpy = vi.spyOn(featureFlagsService.db, "getAll").mockResolvedValue(next);

    const result = await featureFlagsService.replaceAllFlags({});

    expect(result).toEqual(next);
    expect(replaceSpy).toHaveBeenCalled();
    expect(getAllSpy).toHaveBeenCalled();

    replaceSpy.mockRestore();
    getAllSpy.mockRestore();
    vi.useRealTimers();
  });

  it("rejects patch with invalid flag values", async () => {
    await expect(featureFlagsService.updateFlags({ alertsEnabled: "yes" })).rejects.toThrow("Validation failed");
  });

  it("rejects patch with unsafe flag keys", async () => {
    await expect(featureFlagsService.updateFlags({ __proto__: true })).rejects.toThrow("Validation failed");
  });

  it("rejects put with missing flags object", async () => {
    await expect(featureFlagsService.replaceAllFlags(null)).rejects.toThrow("Validation failed");
  });
});
