import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies that the owning services self-register their user-lifecycle handlers
// on import (refactor #2). This is what keeps the cascade behavior working
// while the data layer no longer depends on the services.

describe("service-owned user-lifecycle handlers self-register on import", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("financial.service registers a create handler that initializes an account", async () => {
    const lifecycle = require("../../data/user-lifecycle");
    const financialService = require("../../services/financial.service");

    const initSpy = vi.spyOn(financialService, "initializeAccount").mockResolvedValue({ id: 123 });

    await lifecycle.notifyUserCreated({ id: 123 });

    expect(initSpy).toHaveBeenCalledWith(123);
  });

  it("resource.service registers a delete handler that cascade-deletes user resources", async () => {
    const lifecycle = require("../../data/user-lifecycle");
    const ResourceService = require("../../services/resource.service");

    const cascadeSpy = vi.spyOn(ResourceService, "cascadeDelete").mockResolvedValue();

    await lifecycle.notifyUserDeleted({ id: 55 });

    expect(cascadeSpy).toHaveBeenCalledWith({ type: "user", userId: 55 });
  });
});
