import { beforeEach, describe, expect, it, vi } from "vitest";

const WIDGET_MODULE_PATH = "../../public/js/pages/alerts-ai-widget.js";

function loadWidgetModule() {
  delete require.cache[require.resolve(WIDGET_MODULE_PATH)];
  require(WIDGET_MODULE_PATH);
}

describe("alerts AI widget feature flag gating", () => {
  let widget;
  let documentStub;

  beforeEach(() => {
    widget = { hidden: false };

    documentStub = {
      getElementById: vi.fn((id) => {
        if (id === "alerts-ai-widget") {
          return widget;
        }

        return null;
      }),
    };

    global.window = global.window || {};
    global.document = documentStub;
    global.apiRequest = vi.fn();
    global.getApiUrl = vi.fn(() => "/api/v1/alerts-chat/messages");

    loadWidgetModule();
  });

  it("keeps the widget hidden when alertsAiAssistantEnabled is false", async () => {
    await window.setupAlertsAiWidget({
      getFeatureFlagValue: vi.fn(async () => false),
    });

    expect(widget.hidden).toBe(true);
    expect(documentStub.getElementById).toHaveBeenCalledTimes(1);
    expect(documentStub.getElementById).toHaveBeenCalledWith("alerts-ai-widget");
  });
});
