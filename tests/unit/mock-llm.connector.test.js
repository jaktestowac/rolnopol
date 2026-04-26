import { describe, it, expect } from "vitest";

const MockLlmConnector = require("../../services/chatbot/connectors/mock-llm.connector");

describe("MockLlmConnector conversation modes", () => {
  const connector = new MockLlmConnector();
  const context = {
    summary: {
      fieldsCount: 3,
      totalFieldAreaHa: 41.5,
      staffCount: 2,
      animalRecordsCount: 4,
      totalAnimals: 42,
    },
    samples: {
      fields: [
        { name: "North Field", area: 12.5 },
        { name: "South Field", area: 29 },
      ],
      staff: [{ name: "Anna", surname: "Kowalska", position: "Agronomist" }],
      animals: [{ type: "cow", amount: 42 }],
    },
  };

  it("returns a pirate-flavored summary mode", async () => {
    const reply = await connector.generateResponse({ prompt: "pirate mode summary", context });

    expect(reply).toContain("Ahoy! Pirate mode active.");
    expect(reply).toContain("Fields: 3");
    expect(reply).toContain("Total animals: 42");
  });

  it("offers mode help when asked about modes", async () => {
    const reply = await connector.generateResponse({ prompt: "what modes do you have?", context });

    expect(reply).toContain("pirate mode");
    expect(reply).toContain("coach mode");
    expect(reply).toContain("zen mode");
  });

  it("returns a poetic bard response", async () => {
    const reply = await connector.generateResponse({ prompt: "bard mode", context });

    expect(reply).toContain("Bard mode active.");
    expect(reply).toContain("On 3 fields");
    expect(reply).toContain("42 hearts");
  });
});
