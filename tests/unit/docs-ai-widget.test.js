import { beforeEach, describe, expect, it, vi } from "vitest";

const WIDGET_MODULE_PATH = "../../public/js/pages/docs-ai-widget.js";

function loadWidgetModule() {
  delete require.cache[require.resolve(WIDGET_MODULE_PATH)];
  require(WIDGET_MODULE_PATH);
}

describe("docs AI widget feature flag gating", () => {
  let widget;
  let documentStub;

  beforeEach(() => {
    widget = { hidden: false };

    documentStub = {
      getElementById: vi.fn((id) => {
        if (id === "docs-ai-widget") {
          return widget;
        }

        return null;
      }),
    };

    global.window = global.window || {};
    global.document = documentStub;
    global.apiRequest = vi.fn();
    global.getApiUrl = vi.fn(() => "/api/v1/docs-chat/messages");

    loadWidgetModule();
  });

  it("keeps the widget hidden when docsAiAssistantEnabled is false", async () => {
    await window.setupDocsAiWidget({
      getFeatureFlagValue: vi.fn(async () => false),
    });

    expect(widget.hidden).toBe(true);
    expect(documentStub.getElementById).toHaveBeenCalledTimes(1);
    expect(documentStub.getElementById).toHaveBeenCalledWith("docs-ai-widget");
  });
});
