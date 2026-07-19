/**
 * Documentation page renderer.
 *
 * Turns the documentation data from GET /api/documentation into the page:
 * sidebar navigation, section content, feature-flag toggle, and search wiring.
 *
 * The rendering is driven by two small dispatch tables so it is easy to change
 * and extend without touching a giant if/else:
 *
 *   CONTENT_ITEM_RENDERERS  – keyed by a content item's `type`
 *                             (paragraph, list, table, callout, steps, flow,
 *                             subsection-card). Add a key to support a new item.
 *
 *   SECTION_RENDERERS       – ordered list of { match, render } shape handlers
 *                             (heading blocks, string, string list, entities,
 *                             roles, legacy flows, user types, e2e, features).
 *                             The first matching handler wins; add one to
 *                             support a new section shape. A JSON fallback
 *                             handles anything unmatched.
 *
 * DOM structure, CSS classes, inline styles, and data-testid attributes match
 * the previous inline implementation so behaviour is unchanged.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tiny DOM helper
  // ---------------------------------------------------------------------------

  /**
   * Create an element. `opts` may set: className, text, html, style (object),
   * attrs (object), dataset (object). `children` is a Node/string or an array
   * of them (nullish entries are skipped).
   */
  function h(tag, opts, children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.className) node.className = opts.className;
      if (opts.text != null) node.textContent = opts.text;
      if (opts.html != null) node.innerHTML = opts.html;
      if (opts.style) Object.assign(node.style, opts.style);
      if (opts.attrs) {
        Object.entries(opts.attrs).forEach(([k, v]) => {
          if (v != null) node.setAttribute(k, v);
        });
      }
      if (opts.dataset) {
        Object.entries(opts.dataset).forEach(([k, v]) => {
          node.dataset[k] = v;
        });
      }
    }
    const kids = children == null ? [] : Array.isArray(children) ? children : [children];
    kids.forEach((child) => {
      if (child == null) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  /** Tag an element so the "hide feature-flagged docs" toggle can hide it. */
  function applyFeatureFlag(element, flagged) {
    if (flagged) element.dataset.featureFlagged = "true";
    return element;
  }

  // ---------------------------------------------------------------------------
  // Content item renderers (inside { heading, content: [...] } blocks)
  // ---------------------------------------------------------------------------

  const CALLOUT_ICONS = {
    info: "fa-circle-info",
    tip: "fa-lightbulb",
    warning: "fa-triangle-exclamation",
    success: "fa-circle-check",
  };

  const CONTENT_ITEM_RENDERERS = {
    paragraph(item) {
      if (!item.text) return null;
      return applyFeatureFlag(h("p", { text: item.text }), item.isFeatureFlagged);
    },

    list(item) {
      if (!Array.isArray(item.items)) return null;
      const ul = h(
        "ul",
        {},
        item.items.map((str) => h("li", { text: str })),
      );
      return applyFeatureFlag(ul, item.isFeatureFlagged);
    },

    table(item) {
      if (!item.columns || !item.rows) return null;
      const table = h("table", { style: { margin: "1rem 0", borderCollapse: "collapse", width: "100%" } });
      applyFeatureFlag(table, item.isFeatureFlagged);

      const headCells = item.columns.map((col) =>
        h("th", {
          text: col,
          style: { border: "1px solid #e0e0e0", background: "#f7f9f6", padding: "0.5rem 0.7rem", fontWeight: "bold" },
        }),
      );
      table.appendChild(h("thead", {}, h("tr", {}, headCells)));

      const bodyRows = item.rows.map((row) =>
        h(
          "tr",
          {},
          row.map((cell) => h("td", { text: cell, style: { border: "1px solid #e0e0e0", padding: "0.5rem 0.7rem" } })),
        ),
      );
      table.appendChild(h("tbody", {}, bodyRows));
      return table;
    },

    callout(item) {
      const box = h("div", { className: `docs-callout docs-callout--${item.variant || "info"}` });
      applyFeatureFlag(box, item.isFeatureFlagged);

      const icon = h("i", {
        className: `fas ${CALLOUT_ICONS[item.variant] || CALLOUT_ICONS.info}`,
        attrs: { "aria-hidden": "true" },
      });
      box.appendChild(h("div", { className: "docs-callout__icon" }, icon));

      const body = h("div", { className: "docs-callout__body" });
      if (item.title) body.appendChild(h("div", { className: "docs-callout__title", text: item.title }));
      if (item.text) body.appendChild(h("p", { text: item.text }));
      box.appendChild(body);
      return box;
    },

    steps(item) {
      if (!Array.isArray(item.items)) return null;
      const wrap = h("div", { className: "docs-steps" });
      applyFeatureFlag(wrap, item.isFeatureFlagged);
      if (item.title) wrap.appendChild(h("div", { className: "docs-steps__title", text: item.title }));

      const ol = h("ol", { className: "docs-steps__list" });
      item.items.forEach((step, idx) => {
        const body = h("div", { className: "docs-steps__body" });
        if (typeof step === "string") {
          body.textContent = step;
        } else {
          if (step.title) body.appendChild(h("div", { className: "docs-steps__step-title", text: step.title }));
          if (step.text) body.appendChild(h("div", { text: step.text }));
        }
        const num = h("span", { className: "docs-steps__num", text: String(idx + 1) });
        ol.appendChild(h("li", { className: "docs-steps__item" }, [num, body]));
      });
      wrap.appendChild(ol);
      return wrap;
    },

    flow(item) {
      if (!Array.isArray(item.steps)) return null;
      const wrap = h("div", { className: "docs-flow" });
      applyFeatureFlag(wrap, item.isFeatureFlagged);
      if (item.title) wrap.appendChild(h("div", { className: "docs-flow__title", text: item.title }));

      item.steps.forEach((node, idx) => {
        const box = h("div", { className: "docs-flow__node" });
        if (idx === 0) box.classList.add("docs-flow__node--start");
        if (idx === item.steps.length - 1) box.classList.add("docs-flow__node--end");

        let arrowLabel = "";
        if (typeof node === "string") {
          box.appendChild(h("div", { className: "docs-flow__label", text: node }));
        } else {
          box.appendChild(h("div", { className: "docs-flow__label", text: node.label || "" }));
          if (node.detail) box.appendChild(h("div", { className: "docs-flow__detail", text: node.detail }));
          arrowLabel = node.arrow || "";
        }
        wrap.appendChild(box);

        if (idx < item.steps.length - 1) {
          const conn = h(
            "div",
            { className: "docs-flow__connector" },
            h("i", { className: "fas fa-arrow-down", attrs: { "aria-hidden": "true" } }),
          );
          if (arrowLabel) conn.appendChild(h("span", { className: "docs-flow__connector-label", text: arrowLabel }));
          wrap.appendChild(conn);
        }
      });
      return wrap;
    },

    "subsection-card"(item) {
      const card = h("div", { className: "subsection-card" });

      const header = h("div", { className: "subsection-card-header" });
      if (item.icon) {
        header.appendChild(h("div", { className: "subsection-card-icon" }, h("i", { className: `fas ${item.icon}` })));
      }
      const titleGroup = h("div", { className: "subsection-card-title-group" }, h("h4", { text: item.title }));
      if (item.description) {
        titleGroup.appendChild(h("p", { className: "subsection-card-description", text: item.description }));
      }
      header.appendChild(titleGroup);
      card.appendChild(header);

      applyFeatureFlag(card, item.isFeatureFlagged);
      if (Array.isArray(item.items)) {
        const ul = h(
          "ul",
          {},
          item.items.map((li) => h("li", { text: li })),
        );
        applyFeatureFlag(ul, item.isFeatureFlagged);
        const contentDiv = applyFeatureFlag(h("div", { className: "subsection-card-content" }, ul), item.isFeatureFlagged);
        card.appendChild(contentDiv);
      }
      return card;
    },
  };

  /** Render a single content item (string => paragraph, else by `type`). */
  function renderContentItem(item) {
    if (typeof item === "string") return h("p", { text: item });
    const renderer = CONTENT_ITEM_RENDERERS[item && item.type];
    return renderer ? renderer(item) : null;
  }

  // ---------------------------------------------------------------------------
  // Section shape renderers (first match wins; order mirrors the legacy chain)
  // ---------------------------------------------------------------------------

  const isBlockArray = (content) => Array.isArray(content) && content[0] && content[0].heading;
  const firstItem = (section) => Array.isArray(section.content) && section.content[0];

  function gridStyle(min) {
    return { display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min || "260px"}, 1fr))`, gap: "1.2rem" };
  }

  function renderMarkdownBlocks(section, div) {
    section.content.forEach((block) => {
      div.appendChild(h("h3", { text: block.heading }));
      const md = h("div");
      if (window.marked) md.innerHTML = window.marked.parse(block.markdown);
      else md.textContent = block.markdown;
      div.appendChild(md);
    });
  }

  function renderHeadingBlocks(section, div) {
    section.content.forEach((block) => {
      div.appendChild(h("h3", { text: block.heading }));
      block.content.forEach((item) => {
        const node = renderContentItem(item);
        if (node) div.appendChild(node);
      });
    });
  }

  function renderStringContent(section, div) {
    div.appendChild(h("p", { text: section.content, style: { fontSize: "1.1rem", marginBottom: "1.5rem" } }));
  }

  function renderStringList(section, div) {
    const items = section.content.map((str) => h("li", { text: str, style: { marginBottom: "0.5rem" } }));
    div.appendChild(h("ul", { style: { margin: "1rem 0 2rem 1.5rem", fontSize: "1.05rem" } }, items));
  }

  function renderEntities(section, div) {
    const grid = h("div", { style: gridStyle() });
    section.content.forEach((entity) => {
      const card = h("div", { className: "entity-card entity-card-custom" }, [
        h("h4", { className: "entity-card-title", html: `<i class='fas fa-database'></i> ${entity.entity}` }),
        entity.description ? h("p", { text: entity.description }) : null,
      ]);
      grid.appendChild(card);
    });
    div.appendChild(grid);
  }

  function renderDemoAccounts(section, div) {
    const grid = h("div", { className: "demo-accounts", style: gridStyle() });
    section.content.forEach((role) => {
      const card = h("div", { className: "demo-account demo-account-custom" });
      card.appendChild(h("h4", { className: "demo-account-title", html: `<i class='fas fa-user'></i> ${role.role}` }));
      if (role.description) card.appendChild(h("p", { text: role.description }));
      const credentialId = role.username || role.email;
      if (credentialId || role.password) {
        const idLabel = role.username ? "Username" : "Email";
        const creds = h("div", {
          html: `${credentialId ? `<strong>${idLabel}:</strong> <span style='color:#6a7b5e'>${credentialId}</span><br>` : ""}<strong>Password:</strong> <span style='color:#6a7b5e'>${role.password || ""}</span>`,
        });
        card.appendChild(creds);
      }
      grid.appendChild(card);
    });
    div.appendChild(grid);
  }

  function renderRoles(section, div) {
    const grid = h("div", { style: gridStyle() });
    section.content.forEach((role) => {
      const card = h("div", { className: "role-card role-card-custom" });
      card.appendChild(h("h4", { className: "role-card-title", html: `<i class='fas fa-user'></i> ${role.role}` }));
      if (role.description) card.appendChild(h("p", { text: role.description }));
      if (role.permissions) {
        card.appendChild(
          h(
            "ul",
            { className: "permissions-list" },
            role.permissions.map((perm) => h("li", { text: perm })),
          ),
        );
      }
      grid.appendChild(card);
    });
    div.appendChild(grid);
  }

  function renderLegacyFlows(section, div) {
    section.content.forEach((flowObj) => {
      const flowDiv = h("div", { className: "feature-card feature-card-custom", style: { marginBottom: "1.5rem" } });
      applyFeatureFlag(flowDiv, flowObj.isFeatureFlagged);
      flowDiv.appendChild(h("h4", { className: "feature-card-title", html: `<i class='fas fa-route'></i> ${flowObj.flow}` }));
      if (flowObj.summary) {
        flowDiv.appendChild(h("p", { text: flowObj.summary, style: { fontWeight: "500", marginBottom: "0.7rem", textAlign: "left" } }));
      }
      if (Array.isArray(flowObj.steps)) {
        flowDiv.appendChild(
          h(
            "ol",
            { className: "permissions-list" },
            flowObj.steps.map((step) => h("li", { text: step })),
          ),
        );
      }
      div.appendChild(flowDiv);
    });
  }

  function renderUserTypes(section, div) {
    const grid = h("div", { style: gridStyle() });
    section.content.forEach((typeObj) => {
      const card = h("div", { className: "role-card types-card-custom" });
      card.appendChild(h("h4", { className: "types-card-title", html: `<i class='fas fa-user'></i> ${typeObj.type}` }));
      if (typeObj.description) card.appendChild(h("p", { text: typeObj.description }));
      if (typeObj.permissions) {
        card.appendChild(
          h(
            "ul",
            { className: "permissions-list" },
            typeObj.permissions.map((perm) => h("li", { text: perm })),
          ),
        );
      }
      grid.appendChild(card);
    });
    div.appendChild(grid);
  }

  function renderE2EScenarios(section, div) {
    section.content.forEach((scenario) => {
      const card = h("div", { className: "feature-card feature-card-custom", style: { marginBottom: "1.5rem" } });
      card.appendChild(h("h4", { className: "feature-card-title", html: `<i class='fas fa-vials'></i> ${scenario.scenario}` }));
      if (scenario.description) {
        card.appendChild(h("p", { text: scenario.description, style: { fontWeight: "500", marginBottom: "0.7rem", textAlign: "left" } }));
      }
      if (Array.isArray(scenario.steps)) {
        const ol = h("ol", { className: "permissions-list" });
        scenario.steps.forEach((step, idx) => {
          ol.appendChild(
            h("li", { html: `<span style='color:#6a7b5e;font-weight:bold;margin-right:0.5em;'>Step ${idx + 1}:</span> ${step}` }),
          );
        });
        card.appendChild(ol);
      }
      div.appendChild(card);
    });
  }

  function renderFeatures(section, div) {
    const grid = h("div", { style: { display: "flex", flexDirection: "column", gap: "1rem" } });
    section.content.forEach((feature) => {
      const card = h("div", { className: "feature-card feature-card-custom", style: { padding: "0.8rem" } });
      applyFeatureFlag(card, feature.isFeatureFlagged);
      card.appendChild(
        h("h4", { className: "feature-card-title", html: `<i class='fas fa-check-circle'></i> ${feature.category || "Feature"}` }),
      );
      if (feature.summary) card.appendChild(h("p", { text: feature.summary, style: { marginBottom: "0.5rem" } }));

      if (Array.isArray(feature.items)) {
        const ul = h("ul", { style: { margin: "0.4rem 0 0 1rem", padding: "0", listStyle: "disc" } });
        feature.items.slice(0, 12).forEach((item) => {
          ul.appendChild(h("li", { text: item, style: { marginBottom: "0.25rem", lineHeight: "1.4" } }));
        });
        if (feature.items.length > 12) {
          ul.appendChild(h("li", { text: `...and ${feature.items.length - 12} more`, style: { fontStyle: "italic" } }));
        }
        card.appendChild(ul);
      } else if (feature.content && typeof feature.content === "string") {
        card.appendChild(h("p", { text: feature.content }));
      }
      grid.appendChild(card);
    });
    div.appendChild(grid);
  }

  function renderFallback(section, div) {
    div.appendChild(h("pre", { className: "json-fallback", text: JSON.stringify(section.content, null, 2) }));
  }

  const SECTION_RENDERERS = [
    { match: (s) => isBlockArray(s.content) && s.content[0].markdown, render: renderMarkdownBlocks },
    { match: (s) => isBlockArray(s.content) && Array.isArray(s.content[0].content), render: renderHeadingBlocks },
    { match: (s) => typeof s.content === "string", render: renderStringContent },
    { match: (s) => Array.isArray(s.content) && s.content.every((i) => typeof i === "string"), render: renderStringList },
    { match: (s) => s.section === "entities" && firstItem(s) && s.content[0].entity, render: renderEntities },
    {
      match: (s) => firstItem(s) && s.content[0].role,
      render: (s, div) => (s.section === "demo-accounts" ? renderDemoAccounts(s, div) : renderRoles(s, div)),
    },
    { match: (s) => firstItem(s) && s.content[0].flow && s.content[0].steps, render: renderLegacyFlows },
    { match: (s) => s.section === "user-roles" && firstItem(s) && s.content[0].type, render: renderUserTypes },
    { match: (s) => s.section === "e2e-scenarios" && Array.isArray(s.content), render: renderE2EScenarios },
    { match: (s) => s.section === "features" && Array.isArray(s.content), render: renderFeatures },
  ];

  // ---------------------------------------------------------------------------
  // Section header + section assembly
  // ---------------------------------------------------------------------------

  const SECTION_ICONS = {
    overview: "fa-info-circle",
    "user-roles": "fa-user-shield",
    features: "fa-star",
    "user-flows": "fa-route",
    "api-basics": "fa-code",
    "testing-tips": "fa-vial",
    "demo-accounts": "fa-user-check",
  };

  function flagTitle(section) {
    const flags = Array.isArray(section.featureFlags) ? section.featureFlags : [];
    return flags.length ? `Shown because feature flag is enabled: ${flags.join(", ")}` : "Shown because a feature flag is enabled";
  }

  function renderSectionHeader(section) {
    const title = h("h2", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } });
    const iconClass = SECTION_ICONS[section.section] || (section.isFeatureFlagged ? "fa-puzzle-piece" : null);
    if (iconClass) title.appendChild(h("i", { className: `fas ${iconClass}`, style: { color: "#6a7b5e" } }));
    title.appendChild(h("span", { text: section.title }));

    if (section.isFeatureFlagged) {
      const badge = h("span", {
        className: "docs-feature-flag-badge",
        attrs: { "data-testid": `section-flag-badge-${section.section}`, title: flagTitle(section) },
      });
      badge.appendChild(h("i", { className: "fas fa-flag", attrs: { "aria-hidden": "true" } }));
      badge.appendChild(document.createTextNode(" Feature flag"));
      title.appendChild(badge);
    }
    return title;
  }

  function renderSection(section) {
    const div = h("div", {
      className: "docs-section",
      attrs: { id: section.section, "data-testid": `section-${section.section}` },
    });
    applyFeatureFlag(div, section.isFeatureFlagged);
    div.appendChild(renderSectionHeader(section));

    const renderer = SECTION_RENDERERS.find((r) => r.match(section));
    (renderer ? renderer.render : renderFallback)(section, div);

    div.appendChild(h("hr", { className: "docs-section-divider" }));
    return div;
  }

  // ---------------------------------------------------------------------------
  // Sidebar navigation
  // ---------------------------------------------------------------------------

  function buildNav(docs) {
    const nav = document.getElementById("dynamic-docs-nav");
    if (!nav) return;
    nav.innerHTML = "";
    const currentHash = window.location.hash.replace("#", "");

    docs.forEach((section, idx) => {
      const a = h("a", { text: section.title, attrs: { href: `#${section.section}`, "data-testid": `nav-${section.section}` } });
      if ((currentHash && section.section === currentHash) || (!currentHash && idx === 0)) a.classList.add("active");

      const li = h("li");
      if (section.isFeatureFlagged) {
        // Tag the nav item so the "hide feature-flagged docs" toggle hides the
        // sidebar entry too, not just the section content.
        li.dataset.featureFlagged = "true";
        a.appendChild(h("i", { className: "fas fa-flag docs-nav-flag", attrs: { "aria-hidden": "true", title: flagTitle(section) } }));
      }
      li.appendChild(a);
      nav.appendChild(li);
    });
  }

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const y = target.getBoundingClientRect().top + window.pageYOffset - 80; // offset for navbar/header
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  function attachNavInteractions() {
    const navLinks = document.querySelectorAll(".docs-nav a");
    navLinks.forEach((link) => {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        navLinks.forEach((l) => l.classList.remove("active"));
        this.classList.add("active");
        scrollToSection(this.getAttribute("href").substring(1));
        window.location.hash = this.getAttribute("href");
      });
    });
    if (window.location.hash) scrollToSection(window.location.hash.replace("#", ""));
  }

  // ---------------------------------------------------------------------------
  // Feature-flag toggle + flag helpers
  // ---------------------------------------------------------------------------

  function setupSidebarToggle() {
    const toggleButton = document.getElementById("docs-sidebar-toggle");
    if (!toggleButton) return;
    // Feature-flagged sections are shown by default; the toggle lets a tester
    // hide them to see only the core docs.
    let showFlagged = true;

    const updateToggle = (visible) => {
      showFlagged = visible;
      toggleButton.classList.toggle("active", visible);
      toggleButton.setAttribute("aria-pressed", String(visible));
      const label = toggleButton.querySelector(".docs-sidebar-toggle-label");
      if (label) label.textContent = visible ? "Hide feature-flagged docs" : "Show feature-flagged docs";
      document.body.classList.toggle("docs-hide-flagged", !visible);
    };

    toggleButton.addEventListener("click", () => updateToggle(!showFlagged));
    updateToggle(showFlagged);
  }

  function revealFlagToggle(docs) {
    // Reveal the toggle only when the docs actually contain feature-flag sections.
    const toggle = document.getElementById("docs-sidebar-toggle");
    if (toggle && docs.some((section) => section.isFeatureFlagged)) toggle.style.display = "";
  }

  async function waitForAppInit() {
    if (!window.App) return false;
    if (window.App.isInitialized) return true;

    const maxAttempts = 120;
    for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
      if (window.App.isInitialized) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.App.isInitialized === true;
  }

  async function getFeatureFlagValue(flagKey, defaultValue) {
    const ready = await waitForAppInit();
    if (!ready) return defaultValue;
    const service = window.App?.getModule?.("featureFlagsService");
    if (!service || typeof service.isEnabled !== "function") return defaultValue;
    return service.isEnabled(flagKey, defaultValue);
  }

  // ---------------------------------------------------------------------------
  // Search (basic + advanced) — preserved behaviour
  // ---------------------------------------------------------------------------

  function setupDocsSearch() {
    const wrapper = document.getElementById("docs-search");
    const input = document.getElementById("docs-search-input");
    const empty = document.getElementById("docs-search-empty");
    if (!wrapper || !input) return;

    wrapper.style.display = "block";

    const filterSections = () => {
      const query = input.value.trim().toLowerCase();
      let anyVisible = false;

      document.querySelectorAll(".docs-section").forEach((section) => {
        const match = !query || section.textContent.toLowerCase().includes(query);
        section.style.display = match ? "" : "none";
        const link = document.querySelector(`.docs-nav a[href="#${section.id}"]`);
        if (link && link.parentElement) link.parentElement.style.display = match ? "" : "none";
        if (match) anyVisible = true;
      });

      if (empty) empty.style.display = anyVisible ? "none" : "block";
    };

    input.addEventListener("input", filterSections);
    filterSections();
  }

  function setupDocsAdvancedSearch() {
    const wrapper = document.getElementById("docs-search");
    const advancedSearchDiv = document.getElementById("docs-search-advanced");
    const searchInput = document.getElementById("docs-search-input");
    const modeButtons = document.querySelectorAll("#docs-search-mode .docs-search-mode-btn");
    const scopeCheckboxes = document.querySelectorAll("#docs-search-scope input[type='checkbox']");
    const caseSensitiveCheckbox = document.getElementById("docs-search-case-sensitive");
    const empty = document.getElementById("docs-search-empty");

    if (!wrapper || !advancedSearchDiv || !searchInput) return;

    wrapper.style.display = "block";

    let searchMode = "contains";
    const searchScope = { title: true, content: true };
    let caseSensitive = false;

    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        modeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        searchMode = btn.dataset.mode;
        performAdvancedSearch();
      });
    });

    scopeCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        searchScope[checkbox.value] = checkbox.checked;
        performAdvancedSearch();
      });
    });

    caseSensitiveCheckbox.addEventListener("change", () => {
      caseSensitive = caseSensitiveCheckbox.checked;
      performAdvancedSearch();
    });

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) advancedSearchDiv.classList.add("active");
    });

    const matchesQuery = (searchText, titleToSearch, contentToSearch) => {
      try {
        if (searchMode === "contains") {
          if (searchScope.title && titleToSearch.includes(searchText)) return true;
          return searchScope.content && contentToSearch.includes(searchText);
        }
        if (searchMode === "exact") {
          const wordBoundaryRegex = new RegExp(`\\b${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, caseSensitive ? "g" : "gi");
          if (searchScope.title && wordBoundaryRegex.test(titleToSearch)) return true;
          wordBoundaryRegex.lastIndex = 0;
          return searchScope.content && wordBoundaryRegex.test(contentToSearch);
        }
        if (searchMode === "regex") {
          try {
            const regex = new RegExp(searchText, caseSensitive ? "g" : "gi");
            if (searchScope.title && regex.test(titleToSearch)) return true;
            regex.lastIndex = 0;
            return searchScope.content && regex.test(contentToSearch);
          } catch (regexError) {
            return false;
          }
        }
      } catch (e) {
        return false;
      }
      return false;
    };

    function performAdvancedSearch() {
      if (!searchInput.value.trim()) {
        document.querySelectorAll(".docs-section").forEach((section) => {
          section.style.display = "";
          const link = document.querySelector(`.docs-nav a[href="#${section.id}"]`);
          if (link && link.parentElement) link.parentElement.style.display = "";
        });
        if (empty) empty.style.display = "none";
        advancedSearchDiv.classList.remove("active");
        return;
      }

      advancedSearchDiv.classList.add("active");
      const query = searchInput.value.trim();
      let anyVisible = false;

      document.querySelectorAll(".docs-section").forEach((section) => {
        const title = section.getAttribute("data-title") || section.querySelector("h2")?.textContent || "";
        const content = section.textContent;
        const searchText = caseSensitive ? query : query.toLowerCase();
        const titleToSearch = caseSensitive ? title : title.toLowerCase();
        const contentToSearch = caseSensitive ? content : content.toLowerCase();

        const match = matchesQuery(searchText, titleToSearch, contentToSearch);
        section.style.display = match ? "" : "none";
        const link = document.querySelector(`.docs-nav a[href="#${section.id}"]`);
        if (link && link.parentElement) link.parentElement.style.display = match ? "" : "none";
        if (match) anyVisible = true;
      });

      if (empty) empty.style.display = anyVisible ? "none" : "block";
    }

    searchInput.addEventListener("input", performAdvancedSearch);
  }

  // ---------------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------------

  function showError() {
    const container = document.getElementById("dynamic-docs-content");
    if (container) container.innerHTML = "<p>Error loading documentation.</p>";
  }

  async function renderDocs(docs) {
    buildNav(docs);
    attachNavInteractions();

    const container = document.getElementById("dynamic-docs-content");
    if (!container) return;
    container.innerHTML = "";
    docs.forEach((section) => container.appendChild(renderSection(section)));

    revealFlagToggle(docs);

    const docsAdvancedSearchEnabled = await getFeatureFlagValue("docsAdvancedSearchEnabled", false);
    const docsSearchEnabled = await getFeatureFlagValue("docsSearchEnabled", false);
    if (docsAdvancedSearchEnabled) setupDocsAdvancedSearch();
    else if (docsSearchEnabled) setupDocsSearch();

    if (typeof window.setupDocsAiWidget === "function") {
      await window.setupDocsAiWidget({ getFeatureFlagValue });
    }
  }

  function init() {
    if (typeof initNavigation === "function") initNavigation("docs");
    setupSidebarToggle();

    if (typeof fetchDocumentation !== "function") return;
    fetchDocumentation()
      .then(renderDocs)
      .catch((err) => {
        showError();
        console.error("Documentation fetch error:", err);
      });
  }

  // Expose for testing / manual re-render; keep behaviour identical by
  // auto-initialising at load time (scripts are at the end of <body>).
  window.DocsPage = { init, renderSection, CONTENT_ITEM_RENDERERS, SECTION_RENDERERS };
  init();
})();
