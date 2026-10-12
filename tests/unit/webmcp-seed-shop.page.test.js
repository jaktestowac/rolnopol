import { describe, expect, it, vi } from "vitest";

const seedShop = require("../../public/js/pages/webmcp-seed-shop.js");

const ALWAYS = ["practice.seedShop.listSeeds", "practice.seedShop.addToCart"];
const WITH_ITEMS = [...ALWAYS, "practice.seedShop.removeFromCart", "practice.seedShop.placeOrder"];

function setup({ confirm = vi.fn(async () => true) } = {}) {
  const shop = seedShop.createShop();
  const context = seedShop.createModelContextPolyfill();
  const toolChanges = vi.fn();
  context.addEventListener("toolchange", toolChanges);

  let toolSync;
  const definitions = seedShop.createTools({ shop, confirm, onChange: () => toolSync.sync() });
  toolSync = seedShop.createToolSync({ context, definitions, shop });

  const names = async () => (await context.getTools()).map((tool) => tool.name);
  const run = async (name, input = {}) => JSON.parse(await context.executeTool(name, input));
  // onChange triggers an async sync; let it finish before asserting.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return { shop, context, toolSync, toolChanges, names, run, settle, confirm };
}

describe("WebMCP seed shop: dynamic tools", () => {
  it("starts with only the two always-available tools", async () => {
    const { toolSync, names } = setup();
    await toolSync.sync();

    expect(await names()).toEqual(ALWAYS);
  });

  it("registers removeFromCart and placeOrder once the cart has items, and drops them when it empties", async () => {
    const { toolSync, names, run, settle, toolChanges } = setup();
    await toolSync.sync();
    toolChanges.mockClear();

    expect(await run("practice.seedShop.addToCart", { seedId: "carrot", kg: 2 })).toMatchObject({ ok: true, cart: { total: 76 } });
    await settle();
    expect(await names()).toEqual(WITH_ITEMS);
    expect(toolChanges).toHaveBeenCalledTimes(2);

    expect(await run("practice.seedShop.removeFromCart", { seedId: "carrot" })).toMatchObject({ ok: true, cart: { lines: [] } });
    await settle();
    expect(await names()).toEqual(ALWAYS);
    await expect(run("practice.seedShop.placeOrder")).rejects.toThrow(/Unknown tool/);
  });

  it("places an order after the user confirms and empties the cart", async () => {
    const { toolSync, names, run, settle, shop, confirm } = setup();
    await toolSync.sync();
    await run("practice.seedShop.addToCart", { seedId: "wheat", kg: 10 });
    await run("practice.seedShop.addToCart", { seedId: "beet", kg: 1 });
    await settle();

    const result = await run("practice.seedShop.placeOrder");
    await settle();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: "An AI agent wants to order seeds for 62 ROL." }));
    expect(result).toMatchObject({ ok: true, order: { id: "ORD-001", total: 62 } });
    expect(shop.isCartEmpty()).toBe(true);
    expect(await names()).toEqual(ALWAYS);
  });

  it("keeps the cart when the user cancels the order", async () => {
    const { toolSync, run, settle, shop } = setup({ confirm: vi.fn(async () => false) });
    await toolSync.sync();
    await run("practice.seedShop.addToCart", { seedId: "rye", kg: 3 });
    await settle();

    expect(await run("practice.seedShop.placeOrder")).toEqual({ ok: false, error: "user_cancelled" });
    expect(shop.cart().lines).toHaveLength(1);
    expect(shop.orders()).toEqual([]);
  });

  it("stop() unregisters every tool", async () => {
    const { toolSync, names, run, settle } = setup();
    await toolSync.sync();
    await run("practice.seedShop.addToCart", { seedId: "rye", kg: 1 });
    await settle();

    toolSync.stop();
    expect(await names()).toEqual([]);
  });
});

describe("WebMCP seed shop: shop rules", () => {
  it("rejects unknown seeds, bad amounts and more than the per-seed limit", () => {
    const shop = seedShop.createShop();

    expect(shop.add("tomato", 1)).toMatchObject({ ok: false, error: "unknown_seed" });
    expect(shop.add("rye", 0).ok).toBe(false);
    expect(shop.add("rye", 1.5).ok).toBe(false);
    expect(shop.add("rye", seedShop.MAX_KG_PER_SEED).ok).toBe(true);
    expect(shop.add("rye", 1)).toMatchObject({ ok: false, inCartKg: seedShop.MAX_KG_PER_SEED });
  });

  it("numbers orders and keeps the newest first", () => {
    const shop = seedShop.createShop();
    shop.add("rye", 1);
    shop.placeOrder();
    shop.add("wheat", 1);
    shop.placeOrder();

    expect(shop.orders().map((order) => order.id)).toEqual(["ORD-002", "ORD-001"]);
    expect(shop.placeOrder()).toEqual({ ok: false, error: "cart_empty" });
  });

  it("defines valid tools with closed schemas and example inputs", () => {
    const definitions = seedShop.createTools({ shop: seedShop.createShop(), confirm: vi.fn() });

    expect(definitions.map((tool) => tool.name)).toEqual(WITH_ITEMS);
    expect(Object.keys(seedShop.EXAMPLE_INPUTS)).toEqual(WITH_ITEMS);
    for (const tool of definitions) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    expect(definitions.find((tool) => tool.name.endsWith("placeOrder")).annotations).toEqual({ consequentialHint: true });
    expect(definitions.find((tool) => tool.name.endsWith("listSeeds")).annotations).toEqual({ readOnlyHint: true });
  });
});
