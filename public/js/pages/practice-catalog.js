/**
 * Practice catalog page (/practice/).
 *
 * Lists the hidden practice pages from GET /api/v1/practice/catalog with search,
 * category / difficulty / tag filters, sorting and three views (large cards,
 * small cards, compact list). The current filters live in the URL, so a filtered
 * view can be shared or opened directly by a test.
 */
(function (root) {
  "use strict";

  const CATALOG_URL = "/api/v1/practice/catalog";
  const VIEW_STORAGE_KEY = "rolnopol.practice.catalog.view";
  const VIEWS = ["large", "small", "compact"];
  const SORTS = ["title", "newest", "difficulty"];
  const DEFAULT_STATE = Object.freeze({ query: "", category: "all", difficulty: "all", tags: [], sort: "title", view: "small" });

  // ---------------------------------------------------------------------------
  // Pure helpers (exported for unit tests)
  // ---------------------------------------------------------------------------

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l") // the one Polish letter NFD does not decompose
      .trim();
  }

  function searchableText(page) {
    return normalize([page.title, page.summary, page.category, page.difficulty, page.path, page.api, ...(page.tags || []), ...(page.highlights || [])].join(" "));
  }

  /** Every word of the query must appear somewhere in the page's text. */
  function matchesPage(page, state) {
    if (state.category !== "all" && page.category !== state.category) return false;
    if (state.difficulty !== "all" && page.difficulty !== state.difficulty) return false;
    if (state.tags.length > 0 && !state.tags.every((tag) => (page.tags || []).includes(tag))) return false;

    const words = normalize(state.query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const text = searchableText(page);
    return words.every((word) => text.includes(word));
  }

  function sortPages(pages, sort, difficulties = ["beginner", "intermediate", "advanced"]) {
    const byTitle = (a, b) => a.title.localeCompare(b.title);
    const sorted = [...pages];
    if (sort === "newest") {
      sorted.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) || byTitle(a, b));
    } else if (sort === "difficulty") {
      sorted.sort((a, b) => difficulties.indexOf(a.difficulty) - difficulties.indexOf(b.difficulty) || byTitle(a, b));
    } else {
      sorted.sort(byTitle);
    }
    return sorted;
  }

  function filterPages(pages, state, difficulties) {
    return sortPages(
      pages.filter((page) => matchesPage(page, state)),
      state.sort,
      difficulties,
    );
  }

  /** Read the state from a query string, falling back to defaults for unknown values. */
  function parseState(search, storedView) {
    const params = new URLSearchParams(search || "");
    const view = params.get("view") || storedView;
    const sort = params.get("sort");
    return {
      query: params.get("q") || "",
      category: params.get("category") || "all",
      difficulty: params.get("difficulty") || "all",
      tags: (params.get("tags") || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      sort: SORTS.includes(sort) ? sort : DEFAULT_STATE.sort,
      view: VIEWS.includes(view) ? view : DEFAULT_STATE.view,
    };
  }

  /** Write only the values that differ from the defaults. */
  function serializeState(state) {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.category !== "all") params.set("category", state.category);
    if (state.difficulty !== "all") params.set("difficulty", state.difficulty);
    if (state.tags.length > 0) params.set("tags", state.tags.join(","));
    if (state.sort !== DEFAULT_STATE.sort) params.set("sort", state.sort);
    if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  function hasActiveFilters(state) {
    return Boolean(state.query) || state.category !== "all" || state.difficulty !== "all" || state.tags.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  function el(tag, attrs = {}, children = []) {
    const node = root.document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    });
    children.filter(Boolean).forEach((child) => node.appendChild(typeof child === "string" ? root.document.createTextNode(child) : child));
    return node;
  }

  function icon(className) {
    return el("i", { className: `fas ${className}`, "aria-hidden": "true" });
  }

  function difficultyBadge(difficulty) {
    return el("span", { className: `practice-badge practice-badge--${difficulty}`, text: difficulty });
  }

  function tagList(tags, limit) {
    const shown = limit ? tags.slice(0, limit) : tags;
    const list = el(
      "ul",
      { className: "practice-tags", "aria-label": "Tags" },
      shown.map((tag) => el("li", {}, [el("button", { type: "button", className: "practice-tag", "data-tag": tag, text: `#${tag}` })])),
    );
    if (limit && tags.length > limit) list.appendChild(el("li", { className: "practice-tags__more", text: `+${tags.length - limit}` }));
    return list;
  }

  function openLink(page, label = "Open") {
    return el("a", { className: "btn btn-agri btn-compact practice-open", href: page.path, "data-testid": `open-${page.id}` }, [
      icon("fa-arrow-right"),
      ` ${label}`,
    ]);
  }

  function renderLargeCard(page) {
    return el("article", { className: "practice-card practice-card--large glass futuristic-card", "data-testid": `practice-${page.id}` }, [
      el("div", { className: "practice-card__head" }, [
        el("span", { className: "practice-card__icon bg-agri-gradient" }, [icon(page.icon)]),
        el("div", {}, [el("h2", { className: "practice-card__title" }, [el("a", { href: page.path, text: page.title })]), el("p", { className: "practice-card__category", text: page.category })]),
        difficultyBadge(page.difficulty),
      ]),
      el("p", { className: "practice-card__summary", text: page.summary }),
      page.highlights?.length ? el("ul", { className: "practice-card__highlights" }, page.highlights.map((item) => el("li", { text: item }))) : null,
      tagList(page.tags),
      el("div", { className: "practice-card__footer" }, [
        el("div", { className: "practice-card__meta" }, [page.api ? el("code", { title: "API used by this page", text: page.api }) : null]),
        openLink(page),
      ]),
    ]);
  }

  function renderSmallCard(page) {
    return el("article", { className: "practice-card practice-card--small glass futuristic-card", "data-testid": `practice-${page.id}` }, [
      el("div", { className: "practice-card__head" }, [
        el("span", { className: "practice-card__icon bg-agri-gradient" }, [icon(page.icon)]),
        el("h2", { className: "practice-card__title" }, [el("a", { href: page.path, text: page.title })]),
      ]),
      el("p", { className: "practice-card__summary practice-card__summary--clamp", text: page.summary }),
      tagList(page.tags, 3),
      el("div", { className: "practice-card__footer" }, [difficultyBadge(page.difficulty), openLink(page)]),
    ]);
  }

  function renderCompactRow(page) {
    return el("li", { className: "practice-row", "data-testid": `practice-${page.id}` }, [
      el("span", { className: "practice-row__icon" }, [icon(page.icon)]),
      el("a", { className: "practice-row__title", href: page.path, text: page.title }),
      el("span", { className: "practice-row__category", text: page.category }),
      difficultyBadge(page.difficulty),
      el("span", { className: "practice-row__tags", text: page.tags.map((tag) => `#${tag}`).join(" ") }),
      openLink(page),
    ]);
  }

  async function initPage() {
    const doc = root.document;
    const els = {
      search: doc.getElementById("practiceSearch"),
      category: doc.getElementById("practiceCategory"),
      difficulty: doc.getElementById("practiceDifficulty"),
      sort: doc.getElementById("practiceSort"),
      tags: doc.getElementById("practiceTagFilters"),
      viewButtons: [...doc.querySelectorAll("[data-view]")],
      results: doc.getElementById("practiceResults"),
      count: doc.getElementById("practiceCount"),
      clear: doc.getElementById("practiceClear"),
      status: doc.getElementById("practiceStatus"),
    };

    let storedView = null;
    try {
      storedView = root.localStorage.getItem(VIEW_STORAGE_KEY);
    } catch (error) {
      storedView = null;
    }

    let state = parseState(root.location.search, storedView);
    let catalog = { pages: [], difficulties: [] };

    const setState = (patch) => {
      state = { ...state, ...patch };
      root.history.replaceState(null, "", `${root.location.pathname}${serializeState(state)}`);
      if (patch.view) {
        try {
          root.localStorage.setItem(VIEW_STORAGE_KEY, patch.view);
        } catch (error) {
          // Storage unavailable: the view still applies for this visit.
        }
      }
      render();
    };

    const syncControls = () => {
      if (els.search.value !== state.query) els.search.value = state.query;
      els.category.value = state.category;
      els.difficulty.value = state.difficulty;
      els.sort.value = state.sort;
      els.viewButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === state.view)));
      els.tags.querySelectorAll("[data-filter-tag]").forEach((button) => {
        button.setAttribute("aria-pressed", String(state.tags.includes(button.dataset.filterTag)));
      });
      els.clear.hidden = !hasActiveFilters(state);
    };

    const render = () => {
      syncControls();
      const pages = filterPages(catalog.pages, state, catalog.difficulties);
      const total = catalog.pages.length;
      els.count.textContent = `${pages.length} of ${total} practice ${total === 1 ? "page" : "pages"}`;

      els.results.className = `practice-results practice-results--${state.view}`;
      els.results.setAttribute("data-view", state.view);

      if (pages.length === 0) {
        els.results.replaceChildren(
          el("div", { className: "practice-empty glass futuristic-card", "data-testid": "practice-empty" }, [
            icon("fa-seedling"),
            el("p", { text: "No practice pages match these filters." }),
            el("button", { type: "button", className: "btn btn-outline btn-compact", "data-action": "clear", text: "Clear filters" }),
          ]),
        );
        return;
      }

      if (state.view === "compact") {
        els.results.replaceChildren(el("ul", { className: "practice-list glass futuristic-card" }, pages.map(renderCompactRow)));
      } else {
        els.results.replaceChildren(...pages.map(state.view === "small" ? renderSmallCard : renderLargeCard));
      }
    };

    const fillSelect = (select, values, allLabel) => {
      select.replaceChildren(el("option", { value: "all", text: allLabel }), ...values.map((value) => el("option", { value, text: value })));
    };

    // Controls
    let searchTimer = null;
    els.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => setState({ query: els.search.value.trim() }), 120);
    });
    els.category.addEventListener("change", () => setState({ category: els.category.value }));
    els.difficulty.addEventListener("change", () => setState({ difficulty: els.difficulty.value }));
    els.sort.addEventListener("change", () => setState({ sort: els.sort.value }));
    els.viewButtons.forEach((button) => button.addEventListener("click", () => setState({ view: button.dataset.view })));

    const toggleTag = (tag) => setState({ tags: state.tags.includes(tag) ? state.tags.filter((t) => t !== tag) : [...state.tags, tag] });
    els.tags.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter-tag]");
      if (button) toggleTag(button.dataset.filterTag);
    });

    const clearFilters = () => setState({ query: "", category: "all", difficulty: "all", tags: [] });
    els.clear.addEventListener("click", clearFilters);
    els.results.addEventListener("click", (event) => {
      const tagButton = event.target.closest("[data-tag]");
      if (tagButton) {
        if (!state.tags.includes(tagButton.dataset.tag)) toggleTag(tagButton.dataset.tag);
        return;
      }
      if (event.target.closest("[data-action=clear]")) clearFilters();
    });

    // "/" focuses the search box, Escape clears it.
    doc.addEventListener("keydown", (event) => {
      const typing = /^(input|textarea|select)$/i.test(event.target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        els.search.focus();
      } else if (event.key === "Escape" && event.target === els.search && state.query) {
        setState({ query: "" });
      }
    });

    // Data
    try {
      const response = await root.fetch(CATALOG_URL, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || `HTTP ${response.status}`);
      catalog = payload.data;
    } catch (error) {
      els.status.textContent = `Could not load the practice catalog: ${error.message}`;
      els.status.hidden = false;
      return;
    }

    const categories = [...new Set(catalog.pages.map((page) => page.category))].sort();
    const tags = [...new Set(catalog.pages.flatMap((page) => page.tags || []))].sort();
    fillSelect(els.category, categories, "All categories");
    fillSelect(els.difficulty, catalog.difficulties, "Any difficulty");
    els.tags.replaceChildren(
      ...tags.map((tag) => el("button", { type: "button", className: "practice-tag", "data-filter-tag": tag, "aria-pressed": "false", text: `#${tag}` })),
    );

    render();
  }

  const api = { normalize, matchesPage, sortPages, filterPages, parseState, serializeState, hasActiveFilters, VIEWS, SORTS, DEFAULT_STATE };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RolnopolPracticeCatalog = api;
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => initPage());
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
