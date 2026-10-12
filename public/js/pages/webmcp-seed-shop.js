/**
 * WebMCP seed shop practice page (/practice/webmcp-seed-shop.html).
 *
 * Shows tools that come and go with page state. listSeeds and addToCart are
 * always registered. removeFromCart and placeOrder exist only while the cart has
 * items: the page registers them when the first item goes in and aborts their
 * AbortSignal when the cart empties, so the browser fires `toolchange`.
 *
 * Everything runs in the browser. There is no API behind this page, and the shop
 * resets on reload. Self-contained on purpose: no shared Rolnopol scripts, and
 * its own copy of the polyfill so changes here cannot affect any other page.
 */
(function (root) {
  "use strict";

  const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
  const MAX_KG_PER_SEED = 100;

  const SEEDS = Object.freeze([
    Object.freeze({ id: "wheat", name: "Winter wheat", pricePerKg: 4 }),
    Object.freeze({ id: "rye", name: "Rye", pricePerKg: 3 }),
    Object.freeze({ id: "carrot", name: "Carrot", pricePerKg: 38 }),
    Object.freeze({ id: "beet", name: "Sugar beet", pricePerKg: 22 }),
    Object.freeze({ id: "sunflower", name: "Sunflower", pricePerKg: 15 }),
  ]);
  const SEED_IDS = SEEDS.map((seed) => seed.id);

  // ---------------------------------------------------------------------------
  // Polyfill: the part of the WebMCP ModelContext API this page uses.
  // ---------------------------------------------------------------------------

  function createModelContextPolyfill() {
    const tools = new Map();
    const target = new EventTarget();

    const emit = (type, toolName) => {
      const event = new Event(type);
      if (toolName) event.toolName = toolName;
      target.dispatchEvent(event);
    };

    return {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),

      async registerTool(tool, { signal } = {}) {
        if (!tool || !TOOL_NAME_PATTERN.test(tool.name || "")) throw new TypeError("Invalid tool name");
        if (!tool.description) throw new TypeError("Tool description is required");
        if (typeof tool.execute !== "function") throw new TypeError("Tool execute must be a function");
        if (tools.has(tool.name)) throw new DOMException(`Tool ${tool.name} is already registered`, "InvalidStateError");
        if (signal?.aborted) return;

        tools.set(tool.name, tool);
        signal?.addEventListener("abort", () => {
          tools.delete(tool.name);
          emit("toolchange");
        });
        emit("toolchange");
      },

      async getTools() {
        return [...tools.values()].map(({ execute, ...metadata }) => metadata);
      },

      async executeTool(tool, input = {}, { signal } = {}) {
        const name = typeof tool === "string" ? tool : tool?.name;
        const registered = tools.get(name);
        if (!registered) throw new DOMException(`Unknown tool ${name}`, "NotFoundError");

        emit("toolactivated", name);
        return JSON.stringify(await registered.execute(input, { signal }));
      },
    };
  }

  function ensureModelContext(doc, nav) {
    if (doc.modelContext) return { context: doc.modelContext, native: true };
    if (nav?.modelContext) return { context: nav.modelContext, native: true };

    const context = createModelContextPolyfill();
    Object.defineProperty(doc, "modelContext", { configurable: true, value: context });
    return { context, native: false };
  }

  // ---------------------------------------------------------------------------
  // Shop state
  // ---------------------------------------------------------------------------

  function createShop() {
    const cart = new Map(); // seedId -> kg
    const orders = [];

    const findSeed = (seedId) => SEEDS.find((seed) => seed.id === seedId);

    const cartView = () => {
      const lines = [...cart.entries()].map(([seedId, kg]) => {
        const seed = findSeed(seedId);
        return { seedId, name: seed.name, kg, pricePerKg: seed.pricePerKg, total: kg * seed.pricePerKg };
      });
      return { lines, total: lines.reduce((sum, line) => sum + line.total, 0) };
    };

    return {
      listSeeds: () => SEEDS.map((seed) => ({ ...seed, inCartKg: cart.get(seed.id) || 0 })),
      cart: cartView,
      orders: () => orders.map((order) => ({ ...order, lines: order.lines.map((line) => ({ ...line })) })),
      isCartEmpty: () => cart.size === 0,

      add(seedId, kg) {
        const seed = findSeed(seedId);
        if (!seed) return { ok: false, error: "unknown_seed", availableSeeds: SEED_IDS };
        if (!Number.isInteger(kg) || kg < 1) return { ok: false, error: "kg must be a whole number of at least 1" };

        const next = (cart.get(seedId) || 0) + kg;
        if (next > MAX_KG_PER_SEED) {
          return { ok: false, error: `The shop sells at most ${MAX_KG_PER_SEED} kg of each seed per order`, inCartKg: cart.get(seedId) || 0 };
        }
        cart.set(seedId, next);
        return { ok: true, cart: cartView() };
      },

      remove(seedId) {
        if (!cart.has(seedId)) return { ok: false, error: "not_in_cart" };
        cart.delete(seedId);
        return { ok: true, cart: cartView() };
      },

      placeOrder() {
        if (cart.size === 0) return { ok: false, error: "cart_empty" };
        const { lines, total } = cartView();
        const order = { id: `ORD-${String(orders.length + 1).padStart(3, "0")}`, lines, total, placedAt: new Date().toISOString() };
        orders.unshift(order);
        cart.clear();
        return { ok: true, order: { ...order } };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} deps
   * @param {Object} deps.shop - From createShop()
   * @param {Function} deps.confirm - ({ title, message, details, signal }) => Promise<boolean>
   * @param {Function} [deps.onChange] - Called after the cart or orders change
   * @returns {Array<Object>} Tool definitions; `whenCartHasItems` marks the dynamic ones
   */
  function createTools({ shop, confirm, onChange = () => {} }) {
    const changed = (result) => {
      if (result.ok) onChange();
      return result;
    };

    return [
      {
        name: "practice.seedShop.listSeeds",
        title: "List seeds",
        description: "List the seeds the shop sells, with the price per kg in ROL and how many kg of each are in the cart.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: async () => ({ ok: true, seeds: shop.listSeeds(), cart: shop.cart() }),
      },
      {
        name: "practice.seedShop.addToCart",
        title: "Add seeds to the cart",
        description: `Add kilograms of one seed to the cart. The shop sells at most ${MAX_KG_PER_SEED} kg of each seed per order.`,
        inputSchema: {
          type: "object",
          properties: {
            seedId: { type: "string", enum: SEED_IDS },
            kg: { type: "integer", minimum: 1, maximum: MAX_KG_PER_SEED },
          },
          required: ["seedId", "kg"],
          additionalProperties: false,
        },
        annotations: {},
        execute: async ({ seedId, kg } = {}) => changed(shop.add(seedId, kg)),
      },
      {
        name: "practice.seedShop.removeFromCart",
        title: "Remove a seed from the cart",
        description: "Remove one seed from the cart. This tool exists only while the cart has items.",
        whenCartHasItems: true,
        inputSchema: {
          type: "object",
          properties: { seedId: { type: "string", enum: SEED_IDS } },
          required: ["seedId"],
          additionalProperties: false,
        },
        annotations: {},
        execute: async ({ seedId } = {}) => changed(shop.remove(seedId)),
      },
      {
        name: "practice.seedShop.placeOrder",
        title: "Place the order",
        description:
          "Order everything in the cart and empty it. The user must confirm the order in the page. " +
          "This tool exists only while the cart has items.",
        whenCartHasItems: true,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { consequentialHint: true },
        execute: async (_input, { signal } = {}) => {
          const { lines, total } = shop.cart();
          if (lines.length === 0) return { ok: false, error: "cart_empty" };

          const confirmed = await confirm({
            title: "Place this order?",
            message: `An AI agent wants to order seeds for ${total} ROL.`,
            details: lines.map((line) => `${line.name}: ${line.kg} kg, ${line.total} ROL`),
            signal,
          });
          if (!confirmed) return { ok: false, error: "user_cancelled" };

          return changed(shop.placeOrder());
        },
      },
    ];
  }

  /** Names of the tools that should be registered for the current cart. */
  function availableToolNames(definitions, shop) {
    return definitions.filter((tool) => !tool.whenCartHasItems || !shop.isCartEmpty()).map((tool) => tool.name);
  }

  /**
   * Keep the registered tools in step with the shop: register what became
   * available, abort the signal of what no longer is.
   */
  function createToolSync({ context, definitions, shop, wrap = (tool) => tool, onSync = () => {} }) {
    const controllers = new Map();

    const stop = () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };

    const sync = async function sync() {
      const wanted = new Set(availableToolNames(definitions, shop));
      const added = [];
      const removed = [];

      for (const [name, controller] of controllers) {
        if (!wanted.has(name)) {
          controller.abort();
          controllers.delete(name);
          removed.push(name);
        }
      }

      for (const definition of definitions) {
        if (!wanted.has(definition.name) || controllers.has(definition.name)) continue;
        const controller = new AbortController();
        controllers.set(definition.name, controller);
        const { whenCartHasItems, ...tool } = definition;
        await context.registerTool(wrap(tool), { signal: controller.signal });
        added.push(definition.name);
      }

      onSync({ added, removed, registered: [...controllers.keys()] });
      return { added, removed };
    };

    return { sync, stop };
  }

  const EXAMPLE_INPUTS = {
    "practice.seedShop.listSeeds": {},
    "practice.seedShop.addToCart": { seedId: "carrot", kg: 2 },
    "practice.seedShop.removeFromCart": { seedId: "carrot" },
    "practice.seedShop.placeOrder": {},
  };

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  function el(tag, attrs = {}, children = []) {
    const node = root.document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else node.setAttribute(key, value);
    });
    children.forEach((child) => node.appendChild(typeof child === "string" ? root.document.createTextNode(child) : child));
    return node;
  }

  function confirmInPage({ title, message, details = [], signal }) {
    const doc = root.document;
    const dialog = doc.getElementById("confirmDialog");
    doc.getElementById("confirmTitle").textContent = title;
    doc.getElementById("confirmMessage").textContent = message;
    doc.getElementById("confirmDetails").replaceChildren(...details.map((detail) => el("li", { text: detail })));

    return new Promise((resolve) => {
      const finish = (value) => {
        dialog.removeEventListener("close", onClose);
        signal?.removeEventListener?.("abort", onAbort);
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onClose = () => finish(dialog.returnValue === "confirm");
      const onAbort = () => finish(false);

      dialog.returnValue = "";
      dialog.addEventListener("close", onClose);
      signal?.addEventListener?.("abort", onAbort);
      dialog.showModal();
    });
  }

  async function initPage() {
    const doc = root.document;
    const shop = createShop();
    const { context, native } = ensureModelContext(doc, root.navigator);

    const modeBadge = doc.getElementById("contextMode");
    modeBadge.textContent = native ? "Native WebMCP" : "No native WebMCP, using the polyfill";
    modeBadge.classList.add(native ? "badge--native" : "badge--polyfill");
    root.RolnopolWebMcpExplainer?.attach(modeBadge, {
      native,
      example: {
        prompt: "Order 2 kg of carrot seeds.",
        calls: [
          { tool: "practice.seedShop.addToCart", input: { seedId: "carrot", kg: 2 }, note: "The cart now has an item, so placeOrder appears." },
          { tool: "practice.seedShop.placeOrder", input: {}, note: "The page asks you to confirm before the order goes through." },
        ],
        reply: "Your order ORD-001 is in: 2 kg of carrot seeds for 76 ROL.",
      },
    });

    const logList = doc.getElementById("activityLog");
    const log = (text, type = "info") => {
      logList.prepend(el("li", { className: `log log--${type}`, text: `${new Date().toLocaleTimeString()}  ${text}` }));
      while (logList.children.length > 40) logList.lastElementChild.remove();
    };

    const renderShop = () => {
      doc.getElementById("seeds").replaceChildren(
        ...shop.listSeeds().map((seed) =>
          el("li", { className: "seed", "data-testid": `seed-${seed.id}` }, [
            el("span", { className: "seed__name", text: seed.name }),
            el("span", { className: "seed__price", text: `${seed.pricePerKg} ROL/kg` }),
            el("button", { type: "button", className: "btn", "data-add": seed.id, text: "Add 1 kg" }),
          ]),
        ),
      );

      const { lines, total } = shop.cart();
      doc.getElementById("cart").replaceChildren(
        ...(lines.length
          ? lines.map((line) =>
              el("li", { className: "cart-line", "data-testid": `cart-${line.seedId}` }, [
                el("span", { text: `${line.name}, ${line.kg} kg` }),
                el("span", { className: "cart-line__total", text: `${line.total} ROL` }),
                el("button", { type: "button", className: "btn btn--link", "data-remove": line.seedId, text: "Remove" }),
              ]),
            )
          : [el("li", { className: "muted", text: "The cart is empty." })]),
      );
      doc.getElementById("cartTotal").textContent = `${total} ROL`;
      doc.getElementById("placeOrder").disabled = lines.length === 0;

      const orders = shop.orders();
      doc.getElementById("orders").replaceChildren(
        ...(orders.length
          ? orders.map((order) =>
              el("li", { "data-testid": `order-${order.id}` }, [
                el("strong", { text: order.id }),
                ` ${order.lines.map((line) => `${line.kg} kg ${line.name.toLowerCase()}`).join(", ")}, ${order.total} ROL`,
              ]),
            )
          : [el("li", { className: "muted", text: "No orders yet." })]),
      );
    };

    const renderRegistered = (names) => {
      doc.getElementById("registeredTools").replaceChildren(
        ...names.map((name) => el("li", { "data-testid": `registered-${name}` }, [el("code", { text: name })])),
      );
    };

    let toolSync = null;
    const onChange = () => {
      renderShop();
      toolSync?.sync().catch((error) => log(`Could not update the tools: ${error.message}`, "error"));
    };

    const definitions = createTools({ shop, confirm: confirmInPage, onChange });
    toolSync = createToolSync({
      context,
      definitions,
      shop,
      wrap: (tool) => ({
        ...tool,
        execute: async (input, options) => {
          log(`Tool ${tool.name} called with ${JSON.stringify(input ?? {})}`, "call");
          const result = await tool.execute(input, options);
          log(`Tool ${tool.name} → ${JSON.stringify(result)}`, result?.ok ? "ok" : "error");
          return result;
        },
      }),
      onSync: ({ added, removed, registered }) => {
        added.forEach((name) => log(`Registered ${name}`, "tool"));
        removed.forEach((name) => log(`Unregistered ${name}`, "tool"));
        renderRegistered(registered);
        refreshConsole();
      },
    });

    context.addEventListener?.("toolchange", () => log("toolchange event", "event"));

    // Manual controls: the same shop, driven by the user.
    doc.getElementById("seeds").addEventListener("click", (event) => {
      const button = event.target.closest("[data-add]");
      if (!button) return;
      const result = shop.add(button.dataset.add, 1);
      log(result.ok ? `You added 1 kg of ${button.dataset.add}` : result.error, result.ok ? "ok" : "error");
      if (result.ok) onChange();
    });
    doc.getElementById("cart").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove]");
      if (!button) return;
      shop.remove(button.dataset.remove);
      log(`You removed ${button.dataset.remove}`, "ok");
      onChange();
    });
    doc.getElementById("placeOrder").addEventListener("click", () => {
      const result = shop.placeOrder();
      log(result.ok ? `You placed order ${result.order.id}` : result.error, result.ok ? "ok" : "error");
      if (result.ok) onChange();
    });

    // Tool console: lists what document.modelContext holds right now.
    const select = doc.getElementById("toolSelect");
    const input = doc.getElementById("toolInput");
    const output = doc.getElementById("toolOutput");
    const descriptionEl = doc.getElementById("toolDescription");
    let consoleTools = [];

    async function refreshConsole() {
      try {
        consoleTools = (await context.getTools()).filter((tool) => tool.name.startsWith("practice.seedShop."));
      } catch (error) {
        consoleTools = availableToolNames(definitions, shop).map((name) => definitions.find((tool) => tool.name === name));
      }
      const previous = select.value;
      select.replaceChildren(...consoleTools.map((tool) => el("option", { value: tool.name, text: tool.name })));
      if (consoleTools.some((tool) => tool.name === previous)) select.value = previous;
      showTool(previous !== select.value);
    }

    function showTool(resetInput = true) {
      const tool = consoleTools.find((entry) => entry.name === select.value);
      if (!tool) return;
      descriptionEl.textContent = tool.description;
      if (resetInput) input.value = JSON.stringify(EXAMPLE_INPUTS[tool.name] || {}, null, 2);
    }
    select.addEventListener("change", () => showTool(true));

    doc.getElementById("runTool").addEventListener("click", async () => {
      let args;
      try {
        args = JSON.parse(input.value || "{}");
      } catch (error) {
        output.textContent = `Input is not valid JSON: ${error.message}`;
        return;
      }
      const tool = consoleTools.find((entry) => entry.name === select.value);
      if (!tool) {
        output.textContent = "That tool is not registered right now.";
        return;
      }
      output.textContent = "Running…";
      try {
        const raw = await context.executeTool(tool, args);
        output.textContent = JSON.stringify(typeof raw === "string" ? JSON.parse(raw) : raw, null, 2);
      } catch (error) {
        output.textContent = `Tool failed: ${error.message}`;
      }
    });

    root.addEventListener("pagehide", () => toolSync.stop());

    renderShop();
    await toolSync.sync();
  }

  const api = { SEEDS, MAX_KG_PER_SEED, EXAMPLE_INPUTS, createModelContextPolyfill, ensureModelContext, createShop, createTools, availableToolNames, createToolSync };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RolnopolWebMcpSeedShop = api;
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => initPage());
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
