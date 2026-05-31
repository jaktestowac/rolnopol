import { beforeEach, describe, expect, it, vi } from "vitest";

const TAPE_RECORDER_PAGE_PATH = "../../public/js/pages/farmer-tape-recorder.js";

function loadTapeRecorderPageModule() {
  delete require.cache[require.resolve(TAPE_RECORDER_PAGE_PATH)];
  return require(TAPE_RECORDER_PAGE_PATH);
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
    _innerHTML: "",
    textContent: "",
    disabled: false,
    hidden: false,
    value: "",
    dataset: {},
    attributes: {},
    children: [],
    parentNode: null,
    listeners: {},
    style: {},
    classList: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
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
    getAttribute(name) {
      return this.attributes[name];
    },
    addEventListener(eventName, handler) {
      this.listeners[eventName] = handler;
    },
    querySelector: vi.fn(() => null),
  };

  element.classList = createClassList(element);
  Object.defineProperty(element, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = String(value ?? "");
      this.children = [];
      if (this._innerHTML === "") {
        this.textContent = "";
      }
    },
    configurable: true,
    enumerable: true,
  });
  return element;
}

function collectTextContent(node) {
  if (!node || node.hidden) {
    return "";
  }

  const ownText = typeof node.textContent === "string" ? node.textContent : "";
  const childText = Array.isArray(node.children) ? node.children.map((child) => collectTextContent(child)).join(" ") : "";
  return `${ownText} ${childText}`.trim();
}

function findNode(node, predicate) {
  if (!node) {
    return null;
  }

  if (predicate(node)) {
    return node;
  }

  for (const child of node.children || []) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
}

function createPageControls() {
  const advanceLabel = createMockElement("span");
  const advanceBtn = createMockElement("button");
  advanceBtn.querySelector = vi.fn((selector) => (selector === "span" ? advanceLabel : null));

  const speakLabel = createMockElement("span");
  const speakIcon = createMockElement("i");
  const speakBtn = createMockElement("button");
  speakBtn.querySelector = vi.fn((selector) => {
    if (selector === "span") return speakLabel;
    if (selector === "i") return speakIcon;
    return null;
  });

  return {
    shell: createMockElement("main"),
    status: createMockElement("p"),
    sortSelect: createMockElement("select"),
    resetBtn: createMockElement("button"),
    cabinetCount: createMockElement("span"),
    cabinetList: createMockElement("div"),
    detailTitle: createMockElement("h2"),
    detailMeta: createMockElement("p"),
    detailSummary: createMockElement("p"),
    statusBadge: createMockElement("span"),
    advanceBtn,
    advanceLabel,
    speakBtn,
    speakLabel,
    speakIcon,
    speechStatus: createMockElement("p"),
    transcriptView: createMockElement("div"),
    fragmentCounter: createMockElement("span"),
    fragmentList: createMockElement("div"),
    activityList: createMockElement("ol"),
  };
}

function createSnapshot(canAdvance = true, options = {}) {
  const withSelection = options.withSelection !== false;

  return {
    page: {
      title: "Farmer's Tape Recorder",
      subtitle: "Investigate one fragment at a time.",
    },
    cabinet: {
      sort: "story",
      sortOptions: [{ name: "story", label: "Story order" }],
      totalTapes: 1,
      unlockedTapes: 1,
      totalDirectories: 3,
      entries: [
        {
          type: "folder",
          id: "folder-field-archive",
          label: "Field Archive",
          path: ["Field Archive"],
          tapeCount: 1,
          unlockedTapes: 1,
          discoveredFragments: 0,
          totalFragments: 4,
          folderCount: 1,
          depth: 0,
          children: [
            {
              type: "folder",
              id: "folder-field-archive/field-notes",
              label: "Field Notes",
              path: ["Field Archive", "Field Notes"],
              tapeCount: 1,
              unlockedTapes: 1,
              discoveredFragments: 0,
              totalFragments: 4,
              folderCount: 1,
              depth: 1,
              children: [
                {
                  type: "folder",
                  id: "folder-field-archive/field-notes/north-field",
                  label: "North Field",
                  path: ["Field Archive", "Field Notes", "North Field"],
                  tapeCount: 1,
                  unlockedTapes: 1,
                  discoveredFragments: 0,
                  totalFragments: 4,
                  folderCount: 0,
                  depth: 2,
                  children: [
                    {
                      type: "tape",
                      id: "tape-01",
                      title: "Tape 01",
                      recordedAt: "1987-09-14T05:12:00.000Z",
                      location: "North field pump shed",
                      summary: "Summary",
                      hook: "Hook",
                      locked: false,
                      status: "unopened",
                      discoveredFragments: 0,
                      totalFragments: 4,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      tapes: [
        {
          id: "tape-01",
          title: "Tape 01",
          recordedAt: "1987-09-14T05:12:00.000Z",
          location: "North field pump shed",
          summary: "Summary",
          hook: "Hook",
          locked: false,
          status: "unopened",
          discoveredFragments: 0,
          totalFragments: 4,
        },
      ],
    },
    currentTape: withSelection
      ? {
          id: "tape-01",
          title: "Tape 01",
          cabinetPath: ["Field Archive", "Field Notes", "North Field"],
          recordedAt: "1987-09-14T05:12:00.000Z",
          season: "Late harvest",
          location: "North field pump shed",
          summary: "Summary",
          progress: {
            discoveredFragments: 0,
            totalFragments: 4,
            completed: canAdvance !== true,
          },
          currentFragment: null,
          discoveredFragments: [],
          controls: {
            canAdvance,
            advanceToken: canAdvance ? "token-1" : null,
          },
        }
      : null,
    activity: [],
  };
}

describe("FarmerTapeRecorderPage button state", () => {
  let FarmerTapeRecorderPage;
  let speechSynthesisMock;
  let speechUtteranceMock;

  beforeEach(() => {
    speechSynthesisMock = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };

    speechUtteranceMock = vi.fn(function MockSpeechSynthesisUtterance(text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.onend = null;
      this.onerror = null;
    });

    global.window = {
      sessionStorage: {
        getItem: vi.fn(() => "session-1"),
        setItem: vi.fn(),
      },
      speechSynthesis: speechSynthesisMock,
    };

    global.SpeechSynthesisUtterance = speechUtteranceMock;

    global.document = {
      readyState: "loading",
      addEventListener: vi.fn(),
      getElementById: vi.fn(() => null),
      createElement: vi.fn((tagName) => createMockElement(tagName)),
    };

    FarmerTapeRecorderPage = loadTapeRecorderPageModule();
  });

  it("re-enables the investigate button after busy state clears when the tape can still advance", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;
    page.state = createSnapshot(true);

    page.renderCurrentTape();
    expect(controls.advanceBtn.disabled).toBe(false);

    page._setBusy(true);
    expect(controls.advanceBtn.disabled).toBe(true);

    page._setBusy(false);
    expect(controls.advanceBtn.disabled).toBe(false);
  });

  it("keeps the investigate button disabled when the tape is complete", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;
    page.state = createSnapshot(false);

    page.renderCurrentTape();
    expect(controls.advanceBtn.disabled).toBe(true);

    page._setBusy(true);
    page._setBusy(false);

    expect(controls.advanceBtn.disabled).toBe(true);
  });

  it("renders nested cabinet folders with tapes inside", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;
    page.applySnapshot(createSnapshot(true));

    const renderedText = collectTextContent(controls.cabinetList);
    expect(renderedText).toContain("Field Archive");
    expect(renderedText).toContain("Field Notes");
    expect(renderedText).toContain("North Field");
    expect(renderedText).toContain("Tape 01");
  });

  it("starts with all cabinet folders collapsed and no recording selected", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;

    page.applySnapshot(createSnapshot(true, { withSelection: false }));

    const rootToggle = findNode(controls.cabinetList, (node) => node.attributes?.["data-folder-id"] === "folder-field-archive");

    expect(rootToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(collectTextContent(controls.cabinetList)).not.toContain("Tape 01");
    expect(controls.detailTitle.textContent).toBe("Choose a recording");
    expect(controls.statusBadge.textContent).toBe("Awaiting selection");
    expect(controls.advanceBtn.disabled).toBe(true);
  });

  it("collapses nested folders when toggled", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;

    page.applySnapshot(createSnapshot(true));
    page.toggleFolder("folder-field-archive/field-notes");

    const fieldNotesToggle = findNode(
      controls.cabinetList,
      (node) => node.attributes?.["data-folder-id"] === "folder-field-archive/field-notes",
    );
    const nestedChildren = findNode(controls.cabinetList, (node) => node.className === "tape-folder__children" && node.hidden === true);

    expect(fieldNotesToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(nestedChildren).toBeTruthy();
    expect(collectTextContent(controls.cabinetList)).not.toContain("Tape 01");
  });

  it("renders recovered fragment part numbers in the index", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;
    page.state = createSnapshot(true);
    page.state.currentTape.discoveredFragments = [
      {
        id: "fragment-1",
        title: "Warm motor, cold dawn",
        excerpt: "The pump is cold, but the recorder body feels like it has been held all night.",
        marker: "00:11",
        current: true,
        partNumber: 1,
        totalParts: 4,
      },
    ];

    page._renderFragmentList(page.state.currentTape);

    const renderedText = collectTextContent(controls.fragmentList);
    expect(renderedText).toContain("Part 1 of 4");
    expect(renderedText).toContain("00:11");
  });

  it("reads the active fragment using browser-native speech synthesis", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;
    page.state = createSnapshot(true);
    page.state.currentTape.currentFragment = {
      id: "fragment-1",
      title: "Warm motor, cold dawn",
      excerpt: "The pump is cold, but the recorder body feels like it has been held all night.",
      marker: "00:11",
      mood: "uneasy",
      transcript: ["I came out before sunrise to check the north pump."],
      note: "The first tape establishes the recorder as an object that reacts early.",
    };

    page.renderCurrentTape();
    page.toggleSpeechPlayback();

    expect(speechUtteranceMock).toHaveBeenCalledTimes(1);
    expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(1);
    expect(speechSynthesisMock.speak.mock.calls[0][0].text).toContain("Warm motor, cold dawn");
    expect(controls.speakLabel.textContent).toBe("Stop reading");
    expect(controls.speechStatus.textContent).toContain("Reading current fragment aloud");
  });

  it("stops speech playback when toggled again", () => {
    const page = new FarmerTapeRecorderPage();
    const controls = createPageControls();
    page.controls = controls;
    page.state = createSnapshot(true);
    page.state.currentTape.currentFragment = {
      id: "fragment-1",
      title: "Warm motor, cold dawn",
      excerpt: "The pump is cold, but the recorder body feels like it has been held all night.",
      transcript: ["I came out before sunrise to check the north pump."],
    };

    page.renderCurrentTape();
    page.toggleSpeechPlayback();
    page.toggleSpeechPlayback();

    expect(speechSynthesisMock.cancel).toHaveBeenCalled();
    expect(controls.speakLabel.textContent).toBe("Read fragment");
    expect(controls.speechStatus.textContent).toContain("Playback stopped");
  });
});
