/**
 * A minimal hand-rolled DOM for driving browser page modules under Node.
 *
 * The project has no DOM test environment (jsdom/happy-dom), so pages that are
 * worth testing get injected a `documentRef`/`windowRef` and run against this
 * shim — the same approach tests/unit/observatory.dome.test.js takes, lifted
 * here because the Weather Live scrub window spans two modules plus the shared
 * ChartDeck.
 *
 * It covers only what those modules touch: id lookups, attribute selectors,
 * attributes, listeners, list insertion, and the two browser behaviours the
 * tests actually depend on —
 *
 *   - `history.replaceState` rewrites `location.href`/`location.search`, so a
 *     test can assert the URL a page wrote and then reload from it;
 *   - `stepRange` applies the user agent's own rule for a keyboard step on a
 *     range input (value ± step, clamped to min/max, then an `input` event),
 *     which is what makes "arrow key" and "drag" comparable in a test.
 *
 * `innerHTML` is recorded, not parsed: nodes a page builds from a markup string
 * are invisible to `querySelector` here. That is deliberate — assertions belong
 * on the state a page publishes, not on markup a shim pretended to parse.
 */

function makeElement(spec = {}) {
  const element = {
    tagName: spec.tagName || "div",
    id: spec.id || "",
    type: spec.type || "",
    value: spec.value === undefined ? "" : String(spec.value),
    textContent: spec.textContent || "",
    className: "",
    html: "",
    checked: spec.checked === true,
    disabled: spec.disabled === true,
    hidden: false,
    max: spec.attributes && spec.attributes.max !== undefined ? String(spec.attributes.max) : "",
    children: [],
    parent: null,
    attributes: new Map(),
    listeners: new Map(),
    style: {
      display: "",
      color: "",
      setProperty() {},
    },

    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    },
    insertBefore(child, reference) {
      const index = reference ? this.children.indexOf(reference) : -1;
      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);
      child.parent = this;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parent = null;
      return child;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    },
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    emit(type, event = {}) {
      (this.listeners.get(type) || []).forEach((handler) => handler({ preventDefault() {}, ...event }));
    },
    querySelector() {
      // Cards are written as a markup string; nothing to find here. See above.
      return null;
    },
  };

  Object.entries(spec.attributes || {}).forEach(([name, value]) => element.setAttribute(name, String(value)));

  Object.defineProperty(element, "innerHTML", {
    get() {
      return element.html;
    },
    set(value) {
      element.html = String(value);
      element.children.length = 0;
    },
  });

  Object.defineProperty(element, "firstChild", {
    get() {
      return element.children[0] || null;
    },
  });

  Object.defineProperty(element, "lastChild", {
    get() {
      return element.children[element.children.length - 1] || null;
    },
  });

  return element;
}

function matchesSelector(element, selector) {
  // Enough of the selector grammar for the pages under test: [attr="value"].
  const parsed = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(String(selector).trim());
  if (!parsed) return false;
  const [, name, value] = parsed;
  if (!element.attributes.has(name)) return false;
  return value === undefined || element.attributes.get(name) === value;
}

/**
 * @param {object} config
 * @param {Array} config.elements  element specs — `{ id, tagName, type, value, attributes }`
 * @param {string} config.url      the page's starting URL
 * @param {object} config.globals  extra properties on the fake window (ChartDeck, EventSource, …)
 */
function createDom(config = {}) {
  const registry = [];
  const byId = new Map();
  const store = new Map();

  function register(spec) {
    const element = makeElement(spec);
    registry.push(element);
    if (element.id) byId.set(element.id, element);
    return element;
  }

  (config.elements || []).forEach(register);

  const documentRef = {
    readyState: "complete",
    body: makeElement({ tagName: "body" }),
    getElementById(id) {
      return byId.get(id) || null;
    },
    querySelector(selector) {
      return registry.find((element) => matchesSelector(element, selector)) || null;
    },
    querySelectorAll(selector) {
      return registry.filter((element) => matchesSelector(element, selector));
    },
    createElement(tagName) {
      return makeElement({ tagName });
    },
    addEventListener() {},
  };

  const url = new URL(config.url || "https://rolnopol.test/weather-live.html");
  const location = {
    get href() {
      return url.href;
    },
    get search() {
      return url.search;
    },
    get pathname() {
      return url.pathname;
    },
  };

  const replaced = [];
  const windowRef = {
    location,
    devicePixelRatio: 1,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
    history: {
      replaceState(state, title, next) {
        replaced.push(String(next));
        const parsed = new URL(String(next), url.href);
        url.href = parsed.href;
      },
    },
    addEventListener() {},
    ...(config.globals || {}),
  };

  return {
    documentRef,
    windowRef,
    /** Every URL the page pushed through `replaceState`, in order. */
    replaced,
    storage: store,
    el(id) {
      return byId.get(id) || null;
    },
    add(spec) {
      return register(spec);
    },
    url() {
      return url.href;
    },
    params() {
      return new URL(url.href).searchParams;
    },
    /** Drag: the browser sets the value, then fires `input`. */
    dragRange(id, value) {
      const el = byId.get(id);
      el.value = String(value);
      el.emit("input");
      return el;
    },
    /** Release: `change` follows the final `input` of a drag. */
    releaseRange(id) {
      byId.get(id).emit("change");
    },
    /** Keyboard: the user agent steps the value itself, then fires `input`. */
    stepRange(id, steps = 1) {
      const el = byId.get(id);
      const min = Number(el.getAttribute("min") || 0);
      const max = Number(el.getAttribute("max") || el.max || 0);
      const step = Number(el.getAttribute("step") || 1) || 1;
      const next = Math.min(max, Math.max(min, Number(el.value) + step * steps));
      el.value = String(next);
      el.emit("input");
      return el;
    },
  };
}

module.exports = { createDom, makeElement, matchesSelector };
