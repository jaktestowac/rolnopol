import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTerminalOutputRenderer } = require("../../public/js/pages/terminal-output-renderer.js");

function createFakeElement(tagName = "div") {
  return {
    tagName: String(tagName).toUpperCase(),
    children: [],
    className: "",
    dataset: {},
    attributes: {},
    innerHTML: "",
    textContent: "",
    scrollTop: 0,
    scrollHeight: 0,
    parentNode: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      this.scrollHeight = this.children.length;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

function createFakeDocument() {
  return {
    createElement: (tagName) => createFakeElement(tagName),
    createDocumentFragment: () => createFakeElement("fragment"),
    createTreeWalker: () => ({ nextNode: () => null }),
  };
}

describe("terminal output renderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("honors metadata delayMs and typingEffect for script steps", async () => {
    const outputElement = createFakeElement("div");
    const renderer = createTerminalOutputRenderer(outputElement, {
      documentRef: createFakeDocument(),
      typingSpeed: 5,
      autoScroll: false,
    });

    const renderPromise = renderer.render({
      type: "script",
      items: [
        {
          type: "text",
          content: "hello",
          metadata: {
            delayMs: 20,
            typingEffect: true,
          },
        },
      ],
    });

    expect(outputElement.children).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(20);
    expect(outputElement.children).toHaveLength(1);

    const shell = outputElement.children[0];
    const pre = shell.children[0];
    expect(pre.innerHTML).toBe("h");

    await vi.advanceTimersByTimeAsync(5);
    expect(pre.innerHTML).toBe("he");

    await vi.runAllTimersAsync();
    await renderPromise;

    expect(pre.innerHTML).toBe("hello");
    expect(shell.dataset.outputType).toBe("text");
  });

  it("maps warning metadata to warning presentation", async () => {
    const outputElement = createFakeElement("div");
    const renderer = createTerminalOutputRenderer(outputElement, {
      documentRef: createFakeDocument(),
      autoScroll: false,
    });

    await renderer.render({
      type: "text",
      content: "Integrity: 113%",
      metadata: {
        warn: true,
      },
    });

    expect(outputElement.children).toHaveLength(1);
    expect(outputElement.children[0].className).toContain("terminal-output-item--warning");
    expect(outputElement.children[0].dataset.outputType).toBe("warning");
  });

  it("delays plain text steps without typing when typingEffect is not set", async () => {
    const outputElement = createFakeElement("div");
    const renderer = createTerminalOutputRenderer(outputElement, {
      documentRef: createFakeDocument(),
      typingSpeed: 5,
      autoScroll: false,
    });

    const renderPromise = renderer.render({
      type: "script",
      items: [
        {
          type: "text",
          content: "Integrity: 113%",
          delayMs: 20,
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(outputElement.children).toHaveLength(1);

    const pre = outputElement.children[0].children[0];
    expect(pre.innerHTML).toBe("Integrity: 113%");

    await vi.runAllTimersAsync();
    await renderPromise;

    expect(pre.innerHTML).toBe("Integrity: 113%");
  });
});
