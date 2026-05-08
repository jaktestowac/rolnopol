import { describe, expect, it } from "vitest";

const {
  ALERTS_GUIDE_BOT_ID,
  DEFAULT_BOT_ID,
  DOCS_GUIDE_BOT_ID,
  TERMINAL_PORKY_BOT_ID,
  getBotProfile,
  listBotProfiles,
} = require("../../services/chatbot/bots/bot-registry");

describe("bot registry", () => {
  it("returns the default assistant bot when botId is omitted", () => {
    const profile = getBotProfile(undefined);

    expect(profile.id).toBe(DEFAULT_BOT_ID);
    expect(profile.requiresAuth).toBe(true);
    expect(profile.supportsTools).toBe(true);
  });

  it("returns the terminal Porky profile", () => {
    const profile = getBotProfile(TERMINAL_PORKY_BOT_ID);

    expect(profile.id).toBe(TERMINAL_PORKY_BOT_ID);
    expect(profile.requiresAuth).toBe(false);
    expect(profile.supportsTools).toBe(false);
    expect(profile.systemPrompt).toContain("retro operator terminal");
  });

  it("returns the public docs guide profile", () => {
    const profile = getBotProfile(DOCS_GUIDE_BOT_ID);

    expect(profile.id).toBe(DOCS_GUIDE_BOT_ID);
    expect(profile.name).toBe("Docsy");
    expect(profile.requiresAuth).toBe(false);
    expect(profile.supportsTools).toBe(false);
    expect(profile.featureFlag).toBe("docsAiAssistantEnabled");
  });

  it("returns the public alerts guide profile", () => {
    const profile = getBotProfile(ALERTS_GUIDE_BOT_ID);

    expect(profile.id).toBe(ALERTS_GUIDE_BOT_ID);
    expect(profile.name).toBe("Alerticus");
    expect(profile.requiresAuth).toBe(false);
    expect(profile.supportsTools).toBe(false);
    expect(profile.featureFlag).toBe("alertsAiAssistantEnabled");
  });

  it("lists all registered bot profiles", () => {
    const profiles = listBotProfiles();

    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.map((item) => item.id)).toEqual(
      expect.arrayContaining([DEFAULT_BOT_ID, ALERTS_GUIDE_BOT_ID, DOCS_GUIDE_BOT_ID, TERMINAL_PORKY_BOT_ID]),
    );
  });

  it("rejects unknown bot ids", () => {
    expect(() => getBotProfile("totally-not-a-real-bot")).toThrow(/unknown botId/i);
  });
});
