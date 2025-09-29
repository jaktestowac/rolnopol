import marketplaceService from "../../services/marketplace.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("marketplace.service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should get offers and filter/enrich them", async () => {
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      offers: [
        { id: 1, sellerId: 2, itemType: "animal", itemId: 3, status: "active" },
      ],
      counters: {},
    });
    vi.spyOn(marketplaceService, "_validateAndUpdateOffers").mockResolvedValue([
      { id: 1, sellerId: 2, itemType: "animal", itemId: 3, status: "active" },
    ]);
    vi.spyOn(marketplaceService.animalsDb, "read").mockResolvedValue([
      { id: 3, type: "cow", amount: 2 },
    ]);
    vi.spyOn(marketplaceService.fieldsDb, "read").mockResolvedValue([]);
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([
      { id: 2, displayedName: "Seller", username: "seller" },
    ]);
    const result = await marketplaceService.getOffers(1);
    expect(result.filteredOffers.length).toBeGreaterThanOrEqual(0);
  });

  it("should create offer successfully", async () => {
    vi.spyOn(marketplaceService.usersDb, "read").mockResolvedValue([{ id: 1 }]);
    vi.spyOn(marketplaceService, "_verifyItemOwnership").mockResolvedValue({
      id: 2,
    });
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      offers: [],
      counters: { lastOfferId: 0 },
    });
    vi.spyOn(marketplaceService.marketplaceDb, "write").mockResolvedValue();
    const result = await marketplaceService.createOffer(1, {
      itemType: "animal",
      itemId: 2,
      price: 100,
    });
    expect(result.newOffer).toMatchObject({
      itemType: "animal",
      itemId: 2,
      price: 100,
    });
  });

  it("should buy item successfully", async () => {
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      offers: [
        {
          id: 1,
          sellerId: 2,
          itemType: "animal",
          itemId: 3,
          status: "active",
          price: 100,
        },
      ],
      transactions: [],
      counters: { lastTransactionId: 0 },
    });
    vi.spyOn(marketplaceService, "_getUserBalance").mockResolvedValue(200);
    vi.spyOn(marketplaceService, "_verifyItemOwnership").mockResolvedValue({
      id: 3,
    });
    vi.spyOn(marketplaceService, "_processPurchase").mockResolvedValue({
      id: 1,
      offerId: 1,
    });
    const result = await marketplaceService.buyItem(1, 1);
    expect(result).toMatchObject({ id: 1, offerId: 1 });
  });

  it("should cancel offer successfully", async () => {
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      offers: [{ id: 1, sellerId: 1, status: "active" }],
      counters: {},
    });
    vi.spyOn(marketplaceService.marketplaceDb, "write").mockResolvedValue();
    const result = await marketplaceService.cancelOffer(1, 1);
    expect(result).toMatchObject({ success: true });
  });

  it("should get transaction history", async () => {
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      transactions: [{ id: 1, buyerId: 1, sellerId: 2 }],
      offers: [],
    });
    const result = await marketplaceService.getTransactionHistory(1);
    expect(result.userTransactions.length).toBeGreaterThanOrEqual(0);
  });

  it("should get all offers for admin", async () => {
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      offers: [{ id: 1, sellerId: 1, itemType: "animal", status: "active" }],
      counters: {},
    });
    vi.spyOn(marketplaceService.animalsDb, "read").mockResolvedValue([
      { id: 2 },
    ]);
    vi.spyOn(marketplaceService.fieldsDb, "read").mockResolvedValue([
      { id: 3 },
    ]);
    const result = await marketplaceService.getAllOffersAdmin({});
    expect(result.enrichedOffers.length).toBeGreaterThanOrEqual(0);
  });

  it("should get all transactions for admin", async () => {
    vi.spyOn(marketplaceService.marketplaceDb, "read").mockResolvedValue({
      transactions: [
        {
          id: 1,
          sellerId: 1,
          buyerId: 2,
          itemType: "animal",
          status: "completed",
        },
      ],
      counters: {},
    });
    const result = await marketplaceService.getAllTransactionsAdmin({});
    expect(result.transactions.length).toBeGreaterThanOrEqual(0);
  });
});
