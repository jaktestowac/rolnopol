import { beforeEach, describe, expect, it, vi } from "vitest";

const FD_PAGE_PATH = "../../public/js/pages/fd.js";

function loadFdPageModule() {
  delete require.cache[require.resolve(FD_PAGE_PATH)];
  return require(FD_PAGE_PATH);
}

describe("FarmDefencePage", () => {
  let FarmDefencePage;
  let page;
  let elements;

  beforeEach(() => {
    elements = {};

    // Mock minimal DOM
    global.document = {
      body: { innerHTML: "", children: [], dataset: {}, appendChild: vi.fn(), querySelectorAll: vi.fn(() => []) },
      getElementById: vi.fn((id) => elements[id] || null),
      querySelectorAll: vi.fn(() => []),
      addEventListener: vi.fn(),
      readyState: "complete",
      hidden: false,
      createElement: vi.fn((tag) => ({
        className: "",
        innerHTML: "",
        textContent: "",
        title: "",
        dataset: {},
        style: { setProperty: vi.fn(), width: "" },
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(), toggle: vi.fn() },
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
        prepend: vi.fn(),
        addEventListener: vi.fn(),
        children: [],
      })),
      createDocumentFragment: vi.fn(() => ({
        appendChild: vi.fn(),
        children: [],
      })),
    };

    global.sessionStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };

    global.fetch = vi.fn();
    global.window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    global.setTimeout = vi.fn(() => 1);
    global.clearTimeout = vi.fn();
    global.setInterval = vi.fn(() => 1);
    global.clearInterval = vi.fn();

    const mockEl = (id) => {
      const el = {
        id,
        className: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        style: { setProperty: vi.fn(), width: "" },
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn((c) => id === "fdSizeModal" && c === "is-open"), toggle: vi.fn() },
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
        prepend: vi.fn(),
        addEventListener: vi.fn(),
        querySelectorAll: vi.fn(() => []),
        children: [],
        options: [],
        value: "",
        disabled: false,
      };
      elements[id] = el;
      return el;
    };

    [
      "fdGrid",
      "fdSizeModal",
      "fdVictoryModal",
      "fdDefeatModal",
      "fdVictoryMessage",
      "fdDefeatMessage",
      "fdVictoryNewGame",
      "fdVictoryStay",
      "fdDefeatRestart",
      "fdDefeatMenu",
      "fdThemeSelect",
      "fdNewGameBtn",
      "fdRefreshBtn",
      "fdResetBtn",
      "fdStartWaveBtn",
      "fdTowerPicker",
      "fdWavePill",
      "fdRevisionBadge",
      "fdGoldStat",
      "fdLivesStat",
      "fdTowersStat",
      "fdKillsStat",
      "fdLeakedStat",
      "fdScoreStat",
      "fdWaveStat",
      "fdSizeStat",
      "fdUpdatedStat",
      "fdEventList",
    ].forEach(mockEl);

    const mod = loadFdPageModule();
    FarmDefencePage = mod.FarmDefencePage;
    page = new FarmDefencePage();
  });

  it("initializes and caches DOM", () => {
    page.init();
    expect(page.controls.fdGrid).toBeDefined();
  });

  it("normalizes compact cells for rendering", () => {
    expect(page._normalizeGridCell({ t: "path" }).icon).toBe("fa-road");
    expect(page._normalizeGridCell({ t: "buildable" }).icon).toBe("fa-plus");
    expect(page._normalizeGridCell({ t: "tower", s: "archer", icon: "fa-bullseye" }).icon).toBe("fa-bullseye");
    expect(page._normalizeGridCell({ t: "enemy", s: "grunt", icon: "fa-bug", hp: 0.7 }).hp).toBe(0.7);
    expect(page._normalizeGridCell({ t: "blocked" }).icon).toBe("fa-mountain");
    expect(page._normalizeGridCell({ t: "spawn" }).icon).toBe("fa-dungeon");
    expect(page._normalizeGridCell({ t: "exit" }).icon).toBe("fa-home");
  });

  it("normalizes null/undefined cell as blocked", () => {
    expect(page._normalizeGridCell(null).className).toContain("is-blocked");
  });

  it("selects tower type", () => {
    page._selectTowerType("cannon");
    expect(page.selectedTowerType).toBe("cannon");
  });

  it("renders stats from snapshot", () => {
    page.init();
    page._applySnapshot({
      revision: 1,
      theme: "obsidian",
      grid: [],
      wave: { status: "active", current: 3, total: 10 },
      resources: { gold: 150, lives: 18, score: 500 },
      stats: { towersPlaced: 5, enemiesKilled: 12, enemiesLeaked: 2 },
      capabilities: { towerTypes: [], towerDefs: {}, themes: [] },
    });
    expect(page.controls.goldStat.textContent).toBe(150);
    expect(page.controls.livesStat.textContent).toBe(18);
    expect(page.controls.killsStat.textContent).toBe(12);
  });

  it("opens victory modal on victory event", () => {
    page.init();
    page._handleDefenceEvents([{ type: "victory", message: "All waves cleared!" }]);
    expect(page.controls.victoryModal.classList.add).toHaveBeenCalledWith("is-open");
  });

  it("opens defeat modal on gameOver event", () => {
    page.init();
    page._handleDefenceEvents([{ type: "gameOver", message: "All lives lost!" }]);
    expect(page.controls.defeatModal.classList.add).toHaveBeenCalledWith("is-open");
  });

  it("starts auto-tick on active wave", () => {
    page._renderWaveControls({ wave: { status: "active", current: 1 }, stats: {} });
    expect(global.setInterval).toHaveBeenCalled();
  });

  it("stops auto-tick when wave becomes preparing after being active", () => {
    // Start tick first
    page._renderWaveControls({ wave: { status: "active", current: 1 }, stats: {} });
    expect(page.tickTimer).toBe(1); // setInterval mock returns 1
    // Now stop
    page._renderWaveControls({ wave: { status: "preparing", current: 1 }, stats: {} });
    expect(global.clearInterval).toHaveBeenCalled();
  });
});
