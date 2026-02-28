import { describe, it, expect, vi, afterEach } from "vitest";

const financialController = require("../../controllers/financial.controller");
const financialService = require("../../services/financial.service");

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("financial.controller contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 500 from getTotalMarketplaceVolume when service method errors", async () => {
    const original = financialService.getTotalMarketplaceVolume;
    financialService.getTotalMarketplaceVolume = vi.fn().mockRejectedValue(new Error("service method missing"));

    const req = { user: { userId: 1 } };
    const res = createRes();

    try {
      await financialController.getTotalMarketplaceVolume(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
    } finally {
      financialService.getTotalMarketplaceVolume = original;
    }
  });

  it("getMarketplaceStats delegates to financialService", async () => {
    const mockStats = { totalVolume: 321 };
    const spy = vi.spyOn(financialService, "getMarketplaceStats").mockResolvedValue(mockStats);

    const req = { user: { userId: 1 } };
    const res = createRes();

    await financialController.getMarketplaceStats(req, res);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
