import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";

/**
 * Verifies the Porky Live Chat page shares chat history with the assistant-chat
 * modal by reading/writing the exact same localStorage store and message shape.
 *
 * The project has no DOM test environment (jsdom/happy-dom), so we run the real
 * browser IIFE against a minimal hand-rolled DOM shim that covers only what the
 * page touches. The point of the test is the persistence contract, not layout.
 */
const PAGE_SCRIPT = path.resolve(__dirname, "../../public/js/pages/porky-chat.js");
const USER_ID = "42";
const STORAGE_KEY = `rolnopol.assistantChat.state.v1.${USER_ID}`;

function makeElement(tag) {
  const el = {
    tagName: tag,
    _children: [],
    _text: "",
    className: "",
    _attrs: {},
    style: {},
    hidden: false,
    disabled: false,
    value: "",
    scrollTop: 0,
    scrollHeight: 0,
    _listeners: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    appendChild(child) {
      if (child && child._isFragment) {
        el._children.push(...child._children);
      } else {
        el._children.push(child);
      }
      el._text = "";
      return child;
    },
    setAttribute(name, val) {
      el._attrs[name] = val;
    },
    removeAttribute(name) {
      delete el._attrs[name];
    },
    focus() {},
    addEventListener(type, fn) {
      (el._listeners[type] = el._listeners[type] || []).push(fn);
    },
    dispatchEvent(event) {
      (el._listeners[event.type] || []).forEach((fn) => fn(event));
    },
    get textContent() {
      if (el._children.length) {
        return el._children.map((c) => (c && "textContent" in c ? c.textContent : "")).join("");
      }
      return el._text;
    },
    set textContent(v) {
      el._children = [];
      el._text = String(v);
    },
    set innerHTML(v) {
      el._children = [];
      el._text = String(v).replace(/<[^>]*>/g, "");
    },
  };
  return el;
}

function makeCookieJar() {
  const store = {};
  return {
    get() {
      return Object.entries(store)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    set(str) {
      const [pair] = String(str).split(";");
      const idx = pair.indexOf("=");
      if (idx > -1) {
        store[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
    },
  };
}

function installDom() {
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };

  const elements = {};
  const ids = ["porkyChatConnDot", "porkyChatConnLabel", "porkyChatProvider", "porkyChatMessages", "porkyChatInput", "porkyChatSend", "porkyChatStop"];
  ids.forEach((id) => (elements[id] = makeElement("div")));
  const form = makeElement("form");
  elements.porkyChatForm = form;

  const cookieJar = makeCookieJar();

  const documentObj = {
    readyState: "complete",
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeElement(tag),
    createTextNode: (text) => ({ textContent: String(text) }),
    createDocumentFragment: () => {
      const frag = makeElement("#fragment");
      frag._isFragment = true;
      return frag;
    },
    addEventListener() {},
    get cookie() {
      return cookieJar.get();
    },
    set cookie(v) {
      cookieJar.set(v);
    },
  };

  const windowObj = {
    localStorage,
    location: { origin: "http://localhost", href: "http://localhost/porky-chat.html" },
    addEventListener() {},
    // BroadcastChannel intentionally omitted → page falls back gracefully.
  };

  global.window = windowObj;
  global.document = documentObj;
  global.localStorage = localStorage;
  global.TextDecoder = global.TextDecoder || class {};

  return { elements, localStorage, cookieJar, form };
}

describe("Porky Live Chat shared history", () => {
  let dom;

  // The page is a browser IIFE: it runs its init() as a side effect of being
  // required. Bust the CommonJS cache so each test re-executes it fresh.
  function loadPage() {
    try {
      delete require.cache[require.resolve(PAGE_SCRIPT)];
    } catch (error) {
      /* require.cache may be unavailable; resetModules covers the rest */
    }
    require(PAGE_SCRIPT);
  }

  beforeEach(() => {
    dom = installDom();
    dom.cookieJar.set(`rolnopolUserId=${USER_ID}`);
    vi.resetModules();
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
  });

  it("renders history previously written by the assistant-chat modal", () => {
    dom.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isOpen: false,
        messages: [
          { role: "user", text: "How are my fields?", timestamp: "2026-07-19T10:00:00.000Z" },
          { role: "assistant", text: "You have 3 fields totaling 40 ha.", timestamp: "2026-07-19T10:00:02.000Z" },
        ],
      }),
    );

    loadPage();

    const bubbles = dom.elements.porkyChatMessages._children;
    expect(bubbles.length).toBe(2);
    expect(bubbles[0].className).toContain("porky-chat-message--user");
    expect(bubbles[0].textContent).toContain("How are my fields?");
    expect(bubbles[1].className).toContain("porky-chat-message--assistant");
    expect(bubbles[1].textContent).toContain("40 ha");
  });

  it("seeds a greeting into the shared store when history is empty", () => {
    loadPage();

    const stored = JSON.parse(dom.localStorage.getItem(STORAGE_KEY));
    expect(stored.messages.length).toBe(1);
    expect(stored.messages[0].role).toBe("assistant");
    expect(stored.messages[0].text).toContain("I'm Porky");
    expect(stored.messages[0]).toHaveProperty("timestamp");
    expect(stored).toHaveProperty("isOpen");
  });

  it("appends a sent user message to the shared store in the modal's format", () => {
    loadPage();

    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves; we only check persistence
    dom.cookieJar.set(`rolnopolToken=fake-token`);
    dom.elements.porkyChatInput.value = "tell me about animals";
    dom.form.dispatchEvent({ type: "submit", preventDefault() {} });

    const stored = JSON.parse(dom.localStorage.getItem(STORAGE_KEY));
    const last = stored.messages[stored.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.text).toBe("tell me about animals");
    expect(last).toHaveProperty("timestamp");
  });

  it("preserves the modal's isOpen flag when writing history", () => {
    dom.localStorage.setItem(STORAGE_KEY, JSON.stringify({ isOpen: true, messages: [] }));

    loadPage();

    const stored = JSON.parse(dom.localStorage.getItem(STORAGE_KEY));
    expect(stored.isOpen).toBe(true);
  });
});
