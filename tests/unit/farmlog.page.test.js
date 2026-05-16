import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FARmlog_PAGE_PATH = "../../public/js/pages/farmlog.js";

function loadFarmlogPageModule() {
  delete require.cache[require.resolve(FARmlog_PAGE_PATH)];
  require(FARmlog_PAGE_PATH);
}

describe("Farmlog page engagement refresh behavior", () => {
  let previousWindow;
  let previousDocument;
  let previousTestElements;

  beforeEach(() => {
    previousWindow = global.window;
    previousDocument = global.document;
    previousTestElements = global.__farmlogTestElements;

    const matchMediaStub = {
      matches: true,
      addEventListener: vi.fn(),
      addListener: vi.fn(),
    };

    const elementMap = new Map();

    global.window = {
      matchMedia: vi.fn(() => matchMediaStub),
      scrollX: 18,
      scrollY: 420,
      pageXOffset: 18,
      pageYOffset: 420,
      scrollTo: vi.fn(),
      location: {
        replace: vi.fn(),
      },
      requestAnimationFrame: vi.fn((callback) => {
        callback();
        return 1;
      }),
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    };

    global.document = {
      getElementById: vi.fn((id) => elementMap.get(id) || null),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
    };

    global.__farmlogTestElements = elementMap;

    loadFarmlogPageModule();
  });

  afterEach(() => {
    global.window = previousWindow;
    global.document = previousDocument;

    if (previousTestElements === undefined) {
      delete global.__farmlogTestElements;
    } else {
      global.__farmlogTestElements = previousTestElements;
    }
  });

  it("restores the previous scroll position after an async refresh", async () => {
    const page = new window.FarmlogHubPage();
    const refreshTask = vi.fn(async () => {
      window.scrollY = 0;
      window.pageYOffset = 0;
      return "done";
    });

    const result = await page._runWithPreservedScroll(refreshTask);

    expect(result).toBe("done");
    expect(refreshTask).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith(18, 420);
  });

  it("restores nested result-panel scroll after an async refresh", async () => {
    const page = new window.FarmlogHubPage();
    const searchPostsResults = {
      scrollLeft: 0,
      scrollTop: 260,
    };

    global.__farmlogTestElements.set("searchPostsResults", searchPostsResults);

    await page._runWithPreservedScroll(
      async () => {
        searchPostsResults.scrollTop = 0;
      },
      { elementIds: ["searchPostsResults"] },
    );

    expect(searchPostsResults.scrollTop).toBe(260);
  });

  it("keeps scroll position stable when liking from the search panel", async () => {
    const page = new window.FarmlogHubPage();
    const button = { dataset: { action: "toggle-like" } };
    const preventDefault = vi.fn();
    const searchPostsResults = {
      scrollLeft: 0,
      scrollTop: 310,
    };

    global.__farmlogTestElements.set("searchPostsResults", searchPostsResults);

    page._performEngagementRequest = vi.fn(async () => ({ success: true }));
    page._loadInitialData = vi.fn(async () => {
      window.scrollY = 0;
      window.pageYOffset = 0;
      searchPostsResults.scrollTop = 0;
    });

    await page._handleSearchPanelAction({
      preventDefault,
      target: {
        closest: vi.fn(() => button),
      },
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(page._performEngagementRequest).toHaveBeenCalledWith(button);
    expect(page._loadInitialData).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith(18, 420);
    expect(searchPostsResults.scrollTop).toBe(310);
  });
});
