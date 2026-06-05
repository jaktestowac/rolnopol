(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.HarvestArchivePage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const API_METADATA = "/api/v1/harvest-archive";
  const API_ENTRIES = "/api/v1/harvest-archive/entries";

  const elements = {};

  function cacheElements() {
    elements.shell = document.getElementById("harvestArchiveShell");
    elements.title = document.getElementById("harvestArchiveTitle");
    elements.status = document.getElementById("harvestArchiveStatus");
    elements.badge = document.getElementById("harvestArchiveBadge");
    elements.layout = document.getElementById("harvestArchiveLayout");
  }

  function setStatus(tone, text) {
    if (elements.status) {
      elements.status.setAttribute("data-tone", tone);
      elements.status.textContent = text;
    }
  }

  function setBadge(text) {
    if (elements.badge) {
      elements.badge.textContent = text;
    }
  }

  function applyTheme(theme) {
    if (!theme || !theme.colors) return;
    const root = document.documentElement;
    const c = theme.colors;
    root.style.setProperty("--harvest-theme-primary", c.primary || "#a0522d");
    root.style.setProperty("--harvest-theme-secondary", c.secondary || "#ffd700");
    root.style.setProperty("--harvest-theme-bg", c.bg || "#1a0f05");
    root.style.setProperty("--harvest-theme-accent", c.accent || "#d4a76a");
    root.style.setProperty("--harvest-theme-surface", c.surface || "#2a1a0a");
    root.style.setProperty("--harvest-theme-muted", c.muted || "#8B6D4B");

    // Glow
    if (theme.glow) {
      root.style.setProperty("--harvest-theme-gold-glow", theme.glow.color || "rgba(255, 215, 0, 0.35)");
      root.style.setProperty("--harvest-theme-glow-spread", theme.glow.spread || "0 0 20px");
    }

    // Card background gradient
    if (theme.cardBg) {
      root.style.setProperty("--harvest-theme-card-from", theme.cardBg.from || "rgba(42, 26, 10, 0.85)");
      root.style.setProperty("--harvest-theme-card-to", theme.cardBg.to || "rgba(30, 18, 6, 0.92)");
    }

    // Text shadow
    if (theme.textShadow) {
      root.style.setProperty("--harvest-theme-text-shadow", theme.textShadow.color || "rgba(255, 215, 0, 0.25)");
      root.style.setProperty("--harvest-theme-text-shadow-blur", theme.textShadow.blur || "8px");
    }

    // Icon filter
    if (theme.iconFilter) {
      root.style.setProperty("--harvest-theme-icon-filter", theme.iconFilter);
    }

    // Gradients
    if (theme.gradients) {
      if (theme.gradients.banner) {
        root.style.setProperty("--harvest-theme-banner-gradient", theme.gradients.banner);
      }
      if (theme.gradients.header) {
        root.style.setProperty("--harvest-theme-header-gradient", theme.gradients.header);
      }
    }

    // Border styles
    if (theme.borders) {
      root.style.setProperty("--harvest-theme-border-style", theme.borders.style || "solid");
      root.style.setProperty("--harvest-theme-border-width", theme.borders.width || "1px");
      root.style.setProperty("--harvest-theme-border-radius", theme.borders.radius || "1rem");
    }

    // Particle overlay
    if (theme.particles && theme.particles.type && theme.particles.type !== "none" && theme.particles.density > 0) {
      const pType = theme.particles.type;
      const density = theme.particles.density || 8;
      const speed = theme.particles.speed || 1;
      const overlay = buildParticleOverlay(pType, density);
      const duration = Math.max(12, Math.round(40 / speed));
      root.style.setProperty("--harvest-theme-particle-overlay", overlay);
      root.style.setProperty("--harvest-theme-particle-size", "400% 400%");
      root.style.setProperty("--harvest-theme-particle-opacity", "0.5");
      root.style.setProperty("--harvest-theme-particle-animation", `${theme.animation || "harvest-sway"} ${duration}s linear infinite`);
      document.body.classList.add("particles-active");
    } else {
      root.style.setProperty("--harvest-theme-particle-overlay", "none");
      root.style.setProperty("--harvest-theme-particle-animation", "none");
      document.body.classList.remove("particles-active");
    }

    // Body animation class
    if (theme.animation) {
      document.body.classList.remove(
        "harvest-sway",
        "harvest-frost-drift",
        "harvest-parchment-fade",
        "harvest-golden-shimmer",
        "harvest-petal-drift",
        "harvest-sparkle-drift",
      );
      document.body.classList.add(theme.animation);
    }
  }

  /**
   * Build a CSS background-image string for particle overlays.
   *
   * Creates a grid of radial-gradient "dots" at scattered positions.
   * The ::after pseudo-element uses background-size: 200% 200% so the
   * keyframe animation can pan background-position to create movement.
   *
   * @param {string} type   — particle type keyword (for color)
   * @param {number} density — number of particle dots (max 30)
   * @returns {string} CSS background-image value
   */
  function buildParticleOverlay(type, density) {
    if (type === "none" || density <= 0) return "none";

    const colors = {
      leaves: "rgba(212, 167, 106, 0.18)",
      snow: "rgba(236, 240, 241, 0.14)",
      dust: "rgba(200, 150, 62, 0.12)",
      pollen: "rgba(244, 208, 63, 0.15)",
      petals: "rgba(175, 122, 197, 0.15)",
      sparkle: "rgba(93, 173, 226, 0.18)",
    };
    const color = colors[type] || "rgba(255, 255, 255, 0.1)";
    const dotSize = type === "snow" ? "9px" : "12px";
    const count = Math.min(Math.max(density, 3), 30);
    const cols = Math.ceil(Math.sqrt(count));
    const cellW = Math.ceil(100 / cols);
    const cellH = Math.ceil(100 / Math.ceil(count / cols));
    const layers = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellW + ((i * 37 + 13) % cellW);
      const y = row * cellH + ((i * 53 + 7) % cellH);
      layers.push(`radial-gradient(${dotSize} ${dotSize} at ${x}% ${y}%, ${color}, transparent)`);
    }
    return layers.join(", ");
  }

  function renderEntryCard(entry) {
    const card = document.createElement("article");
    card.className = "harvest-archive-entry-card glass";

    const header = document.createElement("div");
    header.className = "harvest-archive-entry-card__header";

    const type = document.createElement("span");
    type.className = "harvest-archive-entry-card__type";
    type.textContent = entry.entryType || "Record";

    const mood = document.createElement("span");
    mood.className = "harvest-archive-entry-card__mood";
    mood.textContent = entry.mood ? `Mood: ${entry.mood}` : "";

    header.appendChild(type);
    header.appendChild(mood);

    const excerpt = document.createElement("p");
    excerpt.className = "harvest-archive-entry-card__excerpt";
    excerpt.textContent = entry.excerpt || "";

    card.appendChild(header);
    card.appendChild(excerpt);

    return card;
  }

  function renderActive(event, entries) {
    applyTheme(event.theme);

    // Update title with event name
    if (elements.title) {
      elements.title.textContent = event.bannerTitle || event.name || "Holiday Harvest Archive";
    }

    setStatus("active", `Archive open — ${event.name || "Harvest Season"}`);
    setBadge(`${event.emoji || "📜"} ${event.name || "Active"}`);

    // Clear layout
    elements.layout.innerHTML = "";

    // Event banner
    const banner = document.createElement("section");
    banner.className = "harvest-archive-banner";

    if (event.emoji) {
      const emoji = document.createElement("div");
      emoji.className = "harvest-archive-banner__emoji";
      emoji.textContent = event.emoji;
      banner.appendChild(emoji);
    }

    if (event.bannerTitle) {
      const bannerTitle = document.createElement("h2");
      bannerTitle.className = "harvest-archive-banner__title";
      bannerTitle.textContent = event.bannerTitle;
      banner.appendChild(bannerTitle);
    }

    if (event.bannerSubtitle) {
      const bannerSubtitle = document.createElement("p");
      bannerSubtitle.className = "harvest-archive-banner__subtitle";
      bannerSubtitle.textContent = event.bannerSubtitle;
      banner.appendChild(bannerSubtitle);
    }

    elements.layout.appendChild(banner);

    // Entry cards
    if (entries && entries.length > 0) {
      entries.forEach((entry) => {
        elements.layout.appendChild(renderEntryCard(entry));
      });
    } else {
      const empty = document.createElement("p");
      empty.className = "harvest-archive-sealed__text";
      empty.textContent = "The archive is open, but no entries have been recorded for this season yet.";
      elements.layout.appendChild(empty);
    }
  }

  function renderInactive() {
    setStatus("inactive", "The archive is sealed. Return during harvest season.");
    setBadge("🔒 Sealed");

    // Reset theme tokens to defaults
    const root = document.documentElement;
    const defaults = {
      "--harvest-theme-primary": "#a0522d",
      "--harvest-theme-secondary": "#ffd700",
      "--harvest-theme-bg": "#1a0f05",
      "--harvest-theme-accent": "#d4a76a",
      "--harvest-theme-surface": "#2a1a0a",
      "--harvest-theme-muted": "#8B6D4B",
      "--harvest-theme-gold-glow": "rgba(255, 215, 0, 0.35)",
      "--harvest-theme-glow-spread": "0 0 20px",
      "--harvest-theme-card-from": "rgba(42, 26, 10, 0.85)",
      "--harvest-theme-card-to": "rgba(30, 18, 6, 0.92)",
      "--harvest-theme-text-shadow": "rgba(255, 215, 0, 0.25)",
      "--harvest-theme-text-shadow-blur": "8px",
      "--harvest-theme-icon-filter": "drop-shadow(0 0 6px rgba(255, 215, 0, 0.5))",
      "--harvest-theme-banner-gradient": "linear-gradient(135deg, #1a0f05 0%, #3d220e 50%, #1a0f05 100%)",
      "--harvest-theme-header-gradient": "linear-gradient(90deg, transparent, rgba(255,215,0,0.08), transparent)",
      "--harvest-theme-border-style": "solid",
      "--harvest-theme-border-width": "1px",
      "--harvest-theme-border-radius": "1rem",
      "--harvest-theme-particle-overlay": "none",
      "--harvest-theme-particle-animation": "none",
    };
    for (const [prop, val] of Object.entries(defaults)) {
      root.style.setProperty(prop, val);
    }
    // Remove animation + particle classes
    document.body.classList.remove(
      "harvest-sway",
      "harvest-frost-drift",
      "harvest-parchment-fade",
      "harvest-golden-shimmer",
      "harvest-petal-drift",
      "harvest-sparkle-drift",
      "particles-active",
    );

    elements.layout.innerHTML = "";

    const sealed = document.createElement("section");
    sealed.className = "harvest-archive-sealed";

    const icon = document.createElement("div");
    icon.className = "harvest-archive-sealed__icon";
    icon.innerHTML = '<i class="fas fa-book-open"></i>';

    const title = document.createElement("h2");
    title.className = "harvest-archive-sealed__title";
    title.textContent = "The Archive Is Sealed";

    const text = document.createElement("p");
    text.className = "harvest-archive-sealed__text";
    text.textContent = "Seasonal records are only accessible during harvest events.";

    sealed.appendChild(icon);
    sealed.appendChild(title);
    sealed.appendChild(text);

    elements.layout.appendChild(sealed);
  }

  function renderError(message) {
    setStatus("error", "The archive could not be reached.");
    setBadge("⚠ Error");

    elements.layout.innerHTML = "";

    const error = document.createElement("section");
    error.className = "harvest-archive-error";

    const icon = document.createElement("div");
    icon.style.fontSize = "2rem";
    icon.style.marginBottom = "0.5rem";
    icon.innerHTML = '<i class="fas fa-triangle-exclamation"></i>';

    const text = document.createElement("p");
    text.textContent = message || "An unexpected error occurred.";

    error.appendChild(icon);
    error.appendChild(text);

    elements.layout.appendChild(error);
  }

  async function fetchJSON(url) {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  async function init() {
    cacheElements();

    try {
      // Step 1: Check metadata
      const metaResponse = await fetchJSON(API_METADATA);

      if (!metaResponse.success) {
        renderError(metaResponse.error || "Failed to load archive metadata.");
        return;
      }

      const meta = metaResponse.data;

      if (!meta.active) {
        renderInactive();
        return;
      }

      // Step 2: Fetch entries
      const entriesResponse = await fetchJSON(API_ENTRIES);

      if (!entriesResponse.success) {
        renderError(entriesResponse.error || "Failed to load archive entries.");
        return;
      }

      const { event, entries } = entriesResponse.data;
      renderActive(event || meta.event, entries || []);
    } catch (err) {
      console.error("Harvest Archive error:", err);
      renderError("The archive could not be reached. Check your connection and try again.");
    }
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init };
});
