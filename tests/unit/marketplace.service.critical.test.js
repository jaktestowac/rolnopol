import { describe, it, expect, vi, beforeEach } from "vitest";
import marketplaceService from "../../services/marketplace.service.js";

describe("marketplace.service critical", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("_getUserBalance matches account for numeric and string userId", async () => {
    vi.spyOn(marketplaceService.financialDb, "read").mockResolvedValue({
      accounts: [{ userId: 7, balance: 155.5 }],
    });

    await expect(marketplaceService._getUserBalance(7)).resolves.toBe(155.5);
    await expect(marketplaceService._getUserBalance("7")).resolves.toBe(155.5);
  });

  it("createOffer initializes lastOfferId from fallback counter when missing", async () => {
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([{ id: 1 }]);
    vi.spyOn(marketplaceService, "_verifyItemOwnership").mockResolvedValue({ id: 50, userId: 1 });

    const writeSpy = vi.spyOn(marketplaceService.marketplaceDb, "write").mockResolvedValue();
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      offers: [],
      counters: { lastListingId: 10 },
    });

    const result = await marketplaceService.createOffer(1, {
      itemType: "animal",
      itemId: 50,
      price: 99,
    });

    expect(result.newOffer.id).toBe(11);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        counters: expect.objectContaining({
          lastOfferId: 11,
          lastListingId: 10,
        }),
      }),
    );
  });
});
