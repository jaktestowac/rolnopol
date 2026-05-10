import { beforeEach, describe, expect, it, vi } from "vitest";

const LABYRINTH_PAGE_PATH = "../../public/js/pages/labyrinth.js";

function loadLabyrinthPageModule() {
  delete require.cache[require.resolve(LABYRINTH_PAGE_PATH)];
  return require(LABYRINTH_PAGE_PATH);
}

function createCell(type, visible = true) {
  return {
    t: type,
    v: visible ? 1 : 0,
  };
}

function buildGrid(width, height, startX = 0, startY = 0) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 && y === 0) {
        return createCell("player", true);
      }
      if ((x + y) % 11 === 0) {
        return createCell("fog", true);
      }
      if (x % 5 === 0) {
        return createCell("wall", x % 3 !== 0);
      }
      return createCell("path", x % 3 !== 0);
    }),
  );
}

function createClassList(element) {
  return {
    add(...values) {
      const classes = new Set(
        String(element.className || "")
          .split(/\s+/)
          .filter(Boolean),
      );
      values.filter(Boolean).forEach((value) => classes.add(value));
      element.className = Array.from(classes).join(" ");
    },
    remove(...values) {
      const classes = new Set(
        String(element.className || "")
          .split(/\s+/)
          .filter(Boolean),
      );
      values.filter(Boolean).forEach((value) => classes.delete(value));
      element.className = Array.from(classes).join(" ");
    },
    contains(value) {
      return String(element.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .includes(value);
    },
  };
}

function createMockElement(tagName = "div") {
  const element = {
    tagName: String(tagName).toUpperCase(),
    type: "",
    className: "",
    title: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    attributes: {},
    children: [],
    parentNode: null,
    listeners: {},
    style: {
      setProperty: vi.fn(),
      transform: "",
    },
    classList: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      if (child && typeof child.textContent === "string" && child.textContent.length > 0) {
        this.textContent = `${this.textContent || ""}${child.textContent}`;
      }
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      if (child) {
        child.parentNode = null;
      }
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(eventName, handler) {
      this.listeners[eventName] = handler;
    },
    click() {
      if (typeof this.listeners.click === "function") {
        this.listeners.click({ preventDefault: vi.fn() });
      }
    },
    focus: vi.fn(),
    remove: vi.fn(function remove() {
      if (this.parentNode && typeof this.parentNode.removeChild === "function") {
        this.parentNode.removeChild(this);
      }
    }),
  };

  element.classList = createClassList(element);
  return element;
}

describe("Labyrinth page viewport rendering", () => {
  let mazeGrid;
  let LabyrinthPage;

  beforeEach(() => {
    const mazeSizeModal = createMockElement("div");
    const mazeExitModal = createMockElement("div");
    const mazeExitMessage = createMockElement("p");
    const mazeExitNewMazeBtn = createMockElement("button");
    const mazeExitCancelBtn = createMockElement("button");
    const mazeExitCloseBtn = createMockElement("button");
    const mazeGameOverModal = createMockElement("div");
    const mazeGameOverMessage = createMockElement("p");
    const mazeGameOverRestartBtn = createMockElement("button");
    const mazeGameOverMenuBtn = createMockElement("button");
    const eventList = createMockElement("ol");
    const newMazeBtn = createMockElement("button");
    const refreshBtn = createMockElement("button");
    const resetBtn = createMockElement("button");
    const revealBtn = createMockElement("button");

    mazeGrid = {
      style: {
        setProperty: vi.fn(),
        transform: "",
      },
      innerHTML: "",
      children: [],
      appendChild: vi.fn((node) => {
        if (Array.isArray(node?.children)) {
          mazeGrid.children = node.children.slice();
        } else if (node) {
          mazeGrid.children.push(node);
        }
        return node;
      }),
    };

    const body = createMockElement("body");
    body.classList = createClassList(body);

    global.window = {
      addEventListener: vi.fn(),
      clearInterval: vi.fn(),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(),
      setTimeout: vi.fn(),
      requestAnimationFrame: vi.fn((callback) => {
        callback();
        return 1;
      }),
      showNotification: vi.fn(),
    };

    global.document = {
      readyState: "loading",
      body,
      addEventListener: vi.fn(),
      getElementById: vi.fn((id) => {
        switch (id) {
          case "mazeGrid":
            return mazeGrid;
          case "mazeSizeModal":
            return mazeSizeModal;
          case "mazeExitModal":
            return mazeExitModal;
          case "mazeExitMessage":
            return mazeExitMessage;
          case "mazeExitNewMazeBtn":
            return mazeExitNewMazeBtn;
          case "mazeExitCancelBtn":
            return mazeExitCancelBtn;
          case "mazeExitCloseBtn":
            return mazeExitCloseBtn;
          case "mazeGameOverModal":
            return mazeGameOverModal;
          case "mazeGameOverMessage":
            return mazeGameOverMessage;
          case "mazeGameOverRestartBtn":
            return mazeGameOverRestartBtn;
          case "mazeGameOverMenuBtn":
            return mazeGameOverMenuBtn;
          case "eventList":
            return eventList;
          case "newMazeBtn":
            return newMazeBtn;
          case "refreshBtn":
            return refreshBtn;
          case "resetBtn":
            return resetBtn;
          case "revealBtn":
            return revealBtn;
          default:
            return null;
        }
      }),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      createDocumentFragment: vi.fn(() => ({
        children: [],
        appendChild(node) {
          this.children.push(node);
          return node;
        },
      })),
      createElement: vi.fn((tagName) => createMockElement(tagName)),
    };

    LabyrinthPage = loadLabyrinthPageModule();
  });

  it("renders only a 20x20 window for large mazes", () => {
    const page = new LabyrinthPage();
    page.controls = { mazeGrid };

    page._renderGrid({
      maze: { width: 61, height: 61 },
      viewport: { startX: 20, startY: 20, width: 20, height: 20 },
      player: { x: 30, y: 30 },
      grid: buildGrid(20, 20, 20, 20),
    });

    expect(mazeGrid.style.setProperty).toHaveBeenCalledWith("--maze-width", "20");
    expect(mazeGrid.style.setProperty).toHaveBeenCalledWith("--maze-height", "20");
    expect(mazeGrid.children).toHaveLength(400);
    expect(mazeGrid.children[0].dataset).toMatchObject({ x: "20", y: "20" });
    expect(mazeGrid.children[399].dataset).toMatchObject({ x: "39", y: "39" });
    expect(mazeGrid.children.some((cell) => cell.title === "Fog")).toBe(true);
  });

  it("shows a toast when a scroll is picked up", async () => {
    const page = new LabyrinthPage();
    page.controls = { mazeGrid };
    page._applySnapshot = vi.fn();
    page._request = vi.fn(async () => ({
      data: {
        snapshot: {
          grid: [[{ t: "path", v: 1 }]],
          viewport: { startX: 0, startY: 0, width: 1, height: 1 },
          theme: { name: "obsidian", palette: {} },
          capabilities: { themes: [] },
          player: { x: 0, y: 0 },
          maze: { exit: { x: 0, y: 0 } },
          stats: { moves: 1, reveals: 0, explored: 0, solved: false },
          updatedAt: null,
          revision: 1,
        },
        event: {
          type: "scrollPickedUp",
          details: {
            scroll: {
              text: "The roots remember every footstep, even when the maze does not.",
            },
          },
        },
      },
    }));

    await page._applyAction("move", { direction: "right" });

    const notificationsContainer = document.body.children.find((child) => child.className.includes("labyrinth-toast-stack"));
    expect(notificationsContainer).toBeTruthy();
    expect(
      notificationsContainer.children.some(
        (child) => child.className.includes("labyrinth-toast") && child.textContent.includes("The roots remember every footstep"),
      ),
    ).toBe(true);
  });

  it("sends a stable labyrinth session id with requests", async () => {
    const page = new LabyrinthPage();
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));

    global.fetch = fetchSpy;

    try {
      await page._request("/updates");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, requestInit] = fetchSpy.mock.calls[0];
      expect(requestInit.headers["x-labyrinth-session-id"]).toBe(page.sessionId);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("renders concise event summaries", () => {
    const page = new LabyrinthPage();
    page.controls = { eventList: document.getElementById("eventList") };

    page._renderEvents(
      [
        {
          type: "scrollPickedUp",
          revision: 7,
          details: {
            scroll: {
              text: "The roots remember every footstep, even when the maze does not.",
            },
          },
        },
      ],
      true,
    );

    const [fragment] = page.controls.eventList.children;
    const [item] = fragment.children;
    const [, details] = item.children;

    expect(item.children[0].children[0].textContent).toBe("Scroll");
    expect(item.children[0].children[1].textContent).toBe("7");
    expect(details.textContent).toContain("Found:");
    expect(details.textContent).not.toContain("{");
    expect(details.textContent).not.toContain("}");
  });

  it("renders advanced maze entities", () => {
    const page = new LabyrinthPage();

    expect(page._normalizeGridCell({ t: "key", v: 1 })).toMatchObject({ icon: "fa-key", label: "Key" });
    expect(page._normalizeGridCell({ t: "door", v: 1, locked: true })).toMatchObject({ icon: "fa-door-closed", label: "Locked door" });
    expect(page._normalizeGridCell({ t: "monster", v: 1 })).toMatchObject({ icon: "fa-ghost", label: "Monster" });
  });

  it("opens the size modal from the new maze button", () => {
    const page = new LabyrinthPage();
    const openSizeModalSpy = vi.spyOn(page, "_openSizeModal");

    page.init();
    openSizeModalSpy.mockClear();

    const newMazeBtn = document.getElementById("newMazeBtn");
    expect(newMazeBtn).toBeTruthy();

    newMazeBtn.click();

    expect(openSizeModalSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the exit modal and starts a new maze when confirmed", () => {
    const page = new LabyrinthPage();
    const bootstrapSpy = vi.spyOn(page, "_bootstrapSession").mockImplementation(() => {});

    page.init();

    page._handleLabyrinthEvents([
      {
        type: "exitReached",
        details: {
          message: "You reached the exit! A new maze is ready. If every maze is a question, what answer were you looking for?",
        },
      },
    ]);

    expect(page.controls.exitModal.classList.contains("is-open")).toBe(true);
    expect(page.controls.exitModalMessage.textContent).toContain("You reached the exit");
    expect(page.controls.exitModalMessage.textContent).toContain("?");

    page.controls.exitModalConfirm.click();

    expect(bootstrapSpy).toHaveBeenCalledWith({ renewSeed: true });
    expect(page.controls.exitModal.classList.contains("is-open")).toBe(false);
  });

  it("opens the game over modal and supports restart and menu actions", () => {
    const page = new LabyrinthPage();
    const restartSpy = vi.spyOn(page, "_restartAfterGameOver").mockImplementation(() => {});
    const menuSpy = vi.spyOn(page, "_returnToMenuAfterGameOver").mockImplementation(() => {});

    page.init();

    page._handleLabyrinthEvents([
      {
        type: "gameOver",
        details: {
          message: "The monster caught you. Game over.",
        },
      },
    ]);

    expect(page.controls.gameOverModal.classList.contains("is-open")).toBe(true);
    expect(page.controls.gameOverMessage.textContent).toContain("monster caught you");

    page.controls.gameOverRestart.click();
    page.controls.gameOverMenu.click();

    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(menuSpy).toHaveBeenCalledTimes(1);
  });
});
