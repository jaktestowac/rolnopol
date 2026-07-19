import { describe, it, expect } from "vitest";

const mockEngine = require("../../services/chatbot/mock");

const farmContext = {
  summary: {
    fieldsCount: 3,
    totalFieldAreaHa: 41.5,
    staffCount: 2,
    animalRecordsCount: 4,
    totalAnimals: 42,
    accountBalance: 1500,
    accountCurrency: "ROL",
    totalIncome: 3000,
    totalExpense: 1500,
    transactionCount: 12,
  },
  samples: {
    fields: [{ name: "North Field", area: 12.5 }],
    staff: [{ name: "Anna", surname: "Kowalska", position: "Agronomist" }],
    animals: [{ type: "cow", amount: 42 }],
  },
};

describe("mock engine — tool-using intents", () => {
  it("uses the weather tool and resolves an English region name to the Polish voivodeship", async () => {
    const res = await mockEngine.respond({ prompt: "what is the weather today in Silesia?", context: {}, userId: 1 });
    expect(res.intentId).toBe("weather");
    expect(res.toolsUsed).toContain("get_weather_forecast");
    // PL-24 is śląskie (Silesia), NOT mazowieckie (the wrong default).
    expect(res.text).toContain("śląskie");
    expect(res.text).not.toContain("mazowieckie");
  });

  it("gives a nationwide snapshot when no region is named", async () => {
    const res = await mockEngine.respond({ prompt: "how's the weather?", context: {}, userId: 1 });
    expect(res.intentId).toBe("weather");
    expect(res.toolsUsed).toContain("get_weather_all_regions");
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("uses the alerts tool and returns a believable alert readout", async () => {
    const res = await mockEngine.respond({ prompt: "are there any alerts?", context: {}, userId: 1 });
    expect(res.intentId).toBe("alerts");
    expect(res.toolsUsed).toContain("get_recent_alerts");
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("uses the commodity-prices tool for market questions", async () => {
    const res = await mockEngine.respond({ prompt: "what are wheat prices today?", context: {}, userId: 1 });
    expect(res.intentId).toBe("commodities");
    expect(res.toolsUsed).toContain("get_commodity_prices");
    expect(res.text).toContain("Wheat");
    expect(res.text).toContain("ROL");
  });
});

describe("mock engine — grounded farm intents", () => {
  it("answers a summary from context", async () => {
    const res = await mockEngine.respond({ prompt: "give me a summary", context: farmContext, userId: 1 });
    expect(res.intentId).toBe("farm");
    expect(res.text).toContain("Fields: 3");
    expect(res.text).toContain("Total animals: 42");
  });

  it("answers a finance question from context", async () => {
    const res = await mockEngine.respond({ prompt: "what's my balance?", context: farmContext, userId: 1 });
    expect(res.intentId).toBe("farm");
    expect(res.text).toContain("1500 ROL");
  });

  it("still supports personas and easter eggs", async () => {
    const pirate = await mockEngine.respond({ prompt: "pirate mode summary", context: farmContext, userId: 1 });
    expect(pirate.intentId).toBe("personas");
    expect(pirate.text).toContain("Pirate mode active.");

    const egg = await mockEngine.respond({ prompt: "follow-the-red-rain", context: farmContext, userId: 1 });
    expect(egg.intentId).toBe("easter-eggs");
    expect(egg.text).toContain("Red rain protocol acknowledged");
  });

  it("falls back gracefully for unrelated prompts", async () => {
    const res = await mockEngine.respond({ prompt: "xyzzy nonsense token", context: farmContext, userId: 1 });
    expect(res.intentId).toBe("fallback");
    expect(res.text.length).toBeGreaterThan(0);
  });
});
