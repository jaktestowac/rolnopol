import { describe, it, expect } from "vitest";

const BaseLlmConnector = require("../../services/chatbot/connectors/base-llm.connector");

/**
 * A minimal provider whose non-streaming askText() returns a fixed final answer
 * (with no tool calls), so we can exercise BaseLlmConnector.generateResponseStream()'s
 * artifact sanitizer over the resolved answer that gets streamed to the client.
 */
function makeConnector(finalText) {
  const provider = {
    ensureConfigured() {},
    async askText() {
      return { text: finalText, toolCalls: null, raw: null, usage: null };
    },
    getRateLimits() {
      return {};
    },
  };
  return new BaseLlmConnector(provider, "fake", {});
}

async function collect(connector) {
  let streamed = "";
  let done = null;
  for await (const chunk of connector.generateResponseStream({ prompt: "hi", context: {}, promptContext: {}, userId: 1 })) {
    if (chunk.type === "token") {
      streamed += chunk.delta;
    } else if (chunk.type === "done") {
      done = chunk;
    }
  }
  return { streamed, done };
}

describe("streaming artifact sanitizer", () => {
  it("streams clean text unchanged and reconstructs it in done", async () => {
    const { streamed, done } = await collect(makeConnector("Your farm has 3 fields and 10 cows."));
    expect(streamed).toBe("Your farm has 3 fields and 10 cows.");
    expect(done.text).toBe(streamed);
  });

  it("strips a leaked tool-call block", async () => {
    const { streamed } = await collect(
      makeConnector('The weather is <|tool_call>call:get_weather{location: "farm"}<tool_call|> sunny today.'),
    );
    expect(streamed).not.toContain("tool_call");
    expect(streamed).not.toContain("get_weather");
    expect(streamed).toContain("The weather is");
    expect(streamed).toContain("sunny today.");
  });

  it("strips leaked special tokens like <|assistant|>", async () => {
    const { streamed } = await collect(makeConnector("<|assistant|>Hello from Porky."));
    expect(streamed).not.toContain("<|");
    expect(streamed).toContain("Hello from Porky.");
  });

  it("strips a 'User Safety:' label line", async () => {
    const { streamed } = await collect(makeConnector("User Safety: safe\nHere is your summary."));
    expect(streamed).not.toContain("User Safety");
    expect(streamed).toContain("Here is your summary.");
  });

  it("strips a bare call:tool{...} fragment", async () => {
    const { streamed } = await collect(makeConnector('call:get_weather{location: "farm"} It is warm.'));
    expect(streamed).not.toContain("call:get_weather");
    expect(streamed).toContain("It is warm.");
  });
});
