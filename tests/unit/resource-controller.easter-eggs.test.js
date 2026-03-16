import { describe, it, expect, vi, afterEach } from "vitest";

const ResourceController = require("../../controllers/resource.controller");

describe("ResourceController easter eggs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds Sunday Soil Poem meta for fields list on Sunday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00")); // Sunday

    const controller = new ResourceController("fields");
    controller.service.list = vi.fn().mockResolvedValue([{ id: 1, name: "Field 1" }]);

    const req = {
      query: {},
      user: { userId: 123 },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await controller.list(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.meta).toBeDefined();
    expect(payload.meta.easeterEgg).toBeUndefined();
    expect(payload.meta.easterEgg).toBeDefined();
    expect(payload.meta.easterEgg.id).toBe("sunday-soil-poem");
  });
});
