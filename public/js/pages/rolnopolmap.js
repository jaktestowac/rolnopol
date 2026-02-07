/**
 * Abstract Map Page
 * Renders a vector-based clickable map using SVG (no real map tiles).
 */
(function () {
  class RolnopolMap {
    constructor() {
      this.apiService = null;
      this.authService = null;
      this.featureFlagsService = null;
      this.eventBus = null;
      this.root = null;
      this.state = {
        labelsVisible: true,
        selectedId: null,
      };
      // Areas and SVG shape registry
      this._areas = [];
      this._shapeById = new Map(); // id -> SVGElement
      // ViewBox pan/zoom state
      this._base = { w: 1000, h: 600 };
      this._vb = { x: 0, y: 0, w: 1000, h: 600 };
      this._drag = {
        active: false,
        startX: 0,
        startY: 0,
        vbStartX: 0,
        vbStartY: 0,
      };
      this._limits = { minW: 50, maxW: 5000 }; // zoom in down to width=50, out to width=5000
      this._coordsEl = null;
      this._areasCache = null; // cache for file-loaded sample areas
      this._geoFit = null; // projection fit for GeoJSON datasets
      this._fitPadding = 12; // px padding used when fitting viewBox to areas
      this._labelZoomThreshold = 1.6; // show labels only when zoom >= threshold
      // Coloring by percentage of fields area (ha)
      this._coloring = {
        enabled: false,
        stats: null, // Map of normalizedName -> { fieldsAreaHa, fieldsCount, ... }
        minPct: 0,
        maxPct: 100,
        scaleMode: "dynamic", // 'dynamic' = min..max, 'fixed' = 0..100
      };
    }

    async init(app) {
      this.apiService = app.getModule("apiService");
      this.authService = app.getModule("authService");
      this.featureFlagsService = app.getModule("featureFlagsService");
      this.eventBus = app.getEventBus();

      // Require authentication
      if (!this.authService || !this.authService.requireAuth("/login.html")) return;

      const isEnabled = await this._ensureFeatureEnabled();
      if (!isEnabled) {
        return;
      }

      // Prefer the abstract-map container used by the page; fallback to legacy id
      this.root = document.getElementById("abstract-map") || document.getElementById("rolnopol-map");
      if (!this.root) {
        console.error("abstract-map/rolnopol-map container not found");
        return;
      }

      this._renderSvg();
      this._setupControls();
      this._ensureControlsUI();
      await this._maybeLoadAreasFromApi();
    }

    async _ensureFeatureEnabled() {
      if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
        return true;
      }

      try {
        const enabled = await this.featureFlagsService.isEnabled("rolnopolMapEnabled", true);
        if (!enabled) {
          if (typeof window.queueFeatureGateModal === "function") {
            window.queueFeatureGateModal({
              title: "Map Unavailable",
              message: "The Rolnopol map is currently disabled. You can return to the home page.",
            });
          }
          window.location.href = "/";
          return false;
        }
      } catch (error) {
        return true;
      }

      return true;
    }

    _renderSvg(areas) {
      // Basic SVG viewport
      this.root.innerHTML = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `${this._vb.x} ${this._vb.y} ${this._vb.w} ${this._vb.h}`);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Abstract field areas");
      svg.style.touchAction = "none"; // allow custom panning on touch devices
      // Prevent unexpected clipping of child graphics like text icons near edges
      svg.style.overflow = "visible";

      // Content group for areas and labels
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

      // If no external areas provided, we'll try to fetch sample areas asynchronously
      const data = areas && areas.length ? areas : null;
      this._areas = Array.isArray(data) ? data : [];
      this._shapeById.clear();

      if (data && data.length) {
        // If we have areas and a fitted projection, fit the viewBox to their extents for a bigger display
        this._fitViewBoxToAreas(data);
        data.forEach((a) => {
          const fill = a.fill || this._colorForType(a.type) || "#88c999";
          const stroke = a.stroke || "#2f855a";
          const strokeWidth = a.strokeWidth || 2;

          let shapeEl;
          if (a.path) {
            // Complex polygon with possible holes, rendered as a <path>
            shapeEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
            shapeEl.setAttribute("d", a.path);
          } else if (Array.isArray(a.points)) {
            shapeEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            shapeEl.setAttribute("points", a.points.map((p) => p.join(",")).join(" "));
          }

          if (shapeEl) {
            shapeEl.setAttribute("class", "amap__area");
            if (a.id != null) shapeEl.setAttribute("data-id", a.id);
            shapeEl.setAttribute("fill", fill);
            shapeEl.setAttribute("stroke", stroke);
            shapeEl.setAttribute("stroke-width", strokeWidth);
            if (a.path) shapeEl.setAttribute("fill-rule", "evenodd");
            shapeEl.addEventListener("click", () => this._onAreaClick(a));
            g.appendChild(shapeEl);
            if (a.id != null) this._shapeById.set(String(a.id), shapeEl);
          }

          if (a.label && a.name) {
            const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", a.label.x);
            label.setAttribute("y", a.label.y);
            label.setAttribute("class", "amap__label");
            label.textContent = a.name;
            label.style.display = this._labelsShouldBeVisible() ? "block" : "none";
            g.appendChild(label);
          }

          // Always display big icon if details.icon is provided
          if (a.label && a.details && a.details.icon) {
            const icon = document.createElementNS("http://www.w3.org/2000/svg", "text");
            icon.setAttribute("x", a.label.x);
            icon.setAttribute("y", a.label.y);
            icon.setAttribute("text-anchor", "middle");
            icon.setAttribute("dominant-baseline", "middle");
            icon.setAttribute("class", "amap__icon");
            // Ensure visible even for small areas: fixed px size and explicit display
            icon.setAttribute(
              "style",
              "line-height:1; display:block; pointer-events:none; user-select:none; paint-order:stroke; stroke:rgba(0,0,0,0.45); stroke-width:2px;",
            );
            icon.textContent = String(a.details.icon);
            g.appendChild(icon);
          }
        });
      } else {
        // No data provided: defer-load sample areas from static JSON, then re-render
        // this._sampleAreas().then((arr) => {
        //   if (Array.isArray(arr) && arr.length) {
        //     this._fitViewBoxToAreas(arr);
        //     this._renderSvg(arr);
        //   }
        // });
      }

      // Optional subtle grid to mimic lat/lon
      this._drawGrid(svg);

      svg.appendChild(g);
      this.root.appendChild(svg);

      // Interactions and overlays
      this._attachInteractions(svg);
      // Ensure UI (zoom buttons + coords overlay) exists
      this._ensureControlsUI();
      // Apply initial label visibility based on current zoom
      this._applyLabelVisibility();
      // If coloring toggle is enabled, apply it after render
      if (this._coloring.enabled) {
        this._applyFieldPercentageColoring();
      }
    }

    _drawGrid(svg) {
      const ns = "http://www.w3.org/2000/svg";
      const stepX = 100,
        stepY = 100;
      for (let x = 0; x <= this._base.w; x += stepX) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", String(x));
        line.setAttribute("y1", "0");
        line.setAttribute("x2", String(x));
        line.setAttribute("y2", String(this._base.h));
        line.setAttribute("stroke", "#546e7a");
        line.setAttribute("stroke-width", "1");
        line.setAttribute("opacity", "0.12");
        svg.appendChild(line);
      }
      for (let y = 0; y <= this._base.h; y += stepY) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", "0");
        line.setAttribute("y1", String(y));
        line.setAttribute("x2", String(this._base.w));
        line.setAttribute("y2", String(y));
        line.setAttribute("stroke", "#546e7a");
        line.setAttribute("stroke-width", "1");
        line.setAttribute("opacity", "0.12");
        svg.appendChild(line);
      }
    }

    _attachInteractions(svg) {
      // Wheel zoom (centered at cursor)
      svg.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const rect = svg.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const relX = mx / rect.width;
          const relY = my / rect.height;
          const delta = e.deltaY < 0 ? 0.9 : 1.1;
          this._zoomAt(relX, relY, delta);
          svg.setAttribute("viewBox", `${this._vb.x} ${this._vb.y} ${this._vb.w} ${this._vb.h}`);
          this._applyLabelVisibility();
        },
        { passive: false },
      );

      // Mouse drag pan
      svg.addEventListener("mousedown", (e) => {
        this._drag.active = true;
        this._drag.startX = e.clientX;
        this._drag.startY = e.clientY;
        this._drag.vbStartX = this._vb.x;
        this._drag.vbStartY = this._vb.y;
      });
      window.addEventListener("mousemove", (e) => {
        if (!this._drag.active) return;
        const rect = svg.getBoundingClientRect();
        const dxPx = e.clientX - this._drag.startX;
        const dyPx = e.clientY - this._drag.startY;
        const dx = (dxPx / rect.width) * this._vb.w;
        const dy = (dyPx / rect.height) * this._vb.h;
        this._vb.x = this._drag.vbStartX - dx;
        this._vb.y = this._drag.vbStartY - dy;
        svg.setAttribute("viewBox", `${this._vb.x} ${this._vb.y} ${this._vb.w} ${this._vb.h}`);
        this._applyLabelVisibility();
      });
      window.addEventListener("mouseup", () => {
        this._drag.active = false;
      });

      // Touch pan (single-finger)
      svg.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          this._drag.active = true;
          this._drag.startX = t.clientX;
          this._drag.startY = t.clientY;
          this._drag.vbStartX = this._vb.x;
          this._drag.vbStartY = this._vb.y;
        },
        { passive: false },
      );
      svg.addEventListener(
        "touchmove",
        (e) => {
          if (!this._drag.active || e.touches.length !== 1) return;
          e.preventDefault();
          const t = e.touches[0];
          const rect = svg.getBoundingClientRect();
          const dxPx = t.clientX - this._drag.startX;
          const dyPx = t.clientY - this._drag.startY;
          const dx = (dxPx / rect.width) * this._vb.w;
          const dy = (dyPx / rect.height) * this._vb.h;
          this._vb.x = this._drag.vbStartX - dx;
          this._vb.y = this._drag.vbStartY - dy;
          svg.setAttribute("viewBox", `${this._vb.x} ${this._vb.y} ${this._vb.w} ${this._vb.h}`);
          this._applyLabelVisibility();
        },
        { passive: false },
      );
      svg.addEventListener("touchend", () => {
        this._drag.active = false;
      });

      // Mouse move to update coords
      svg.addEventListener("mousemove", (e) => {
        const coord = this._mouseToSvgCoord(svg, e.clientX, e.clientY);
        this._updateCoordsOverlay(coord.x, coord.y);
      });
      svg.addEventListener("mouseleave", () => {
        this._updateCoordsOverlay(null, null);
      });
    }

    _zoomAt(relX, relY, scaleDelta) {
      const newW = this._vb.w * scaleDelta;
      const clampedW = Math.max(this._limits.minW, Math.min(this._limits.maxW, newW));
      const factor = clampedW / this._vb.w; // actual factor after clamping
      const clampedH = this._vb.h * factor; // preserve aspect ratio

      // Adjust x,y to keep cursor point stable
      const dx = (this._vb.w - clampedW) * relX;
      const dy = (this._vb.h - clampedH) * relY;
      this._vb = {
        x: this._vb.x + dx,
        y: this._vb.y + dy,
        w: clampedW,
        h: clampedH,
      };
    }

    _mouseToSvgCoord(svg, clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      const x = this._vb.x + relX * this._vb.w;
      const y = this._vb.y + relY * this._vb.h;
      return { x, y };
    }

    _ensureControlsUI() {
      // Floating zoom buttons and coords overlay
      const wrapper = this.root;
      // Make root positioned for absolute children
      if (getComputedStyle(wrapper).position === "static") {
        wrapper.style.position = "relative";
      }
      // Zoom buttons
      const btnsId = "amap-zoom-btns";
      let btns = document.getElementById(btnsId);
      if (!btns) {
        btns = document.createElement("div");
        btns.id = btnsId;
        btns.style.position = "absolute";
        btns.style.top = "0.5rem";
        btns.style.right = "0.5rem";
        btns.style.display = "flex";
        btns.style.flexDirection = "column";
        btns.style.gap = "0.4rem";
        btns.style.zIndex = "10";
        const plus = document.createElement("button");
        plus.textContent = "+";
        plus.className = "btn btn-compact btn-futuristic";
        plus.addEventListener("click", () => {
          this._zoomAt(0.5, 0.5, 0.9);
          const svg = this.root.querySelector("svg");
          svg && svg.setAttribute("viewBox", `${this._vb.x} ${this._vb.y} ${this._vb.w} ${this._vb.h}`);
          this._updateCoordsOverlay(null, null);
        });
        const minus = document.createElement("button");
        minus.textContent = "−";
        minus.className = "btn btn-compact btn-outline btn-futuristic";
        minus.addEventListener("click", () => {
          this._zoomAt(0.5, 0.5, 1.1);
          const svg = this.root.querySelector("svg");
          svg && svg.setAttribute("viewBox", `${this._vb.x} ${this._vb.y} ${this._vb.w} ${this._vb.h}`);
          this._updateCoordsOverlay(null, null);
        });
        btns.appendChild(plus);
        btns.appendChild(minus);
        wrapper.appendChild(btns);
      }
      // Color-by-percentage toggle UI (placed below zoom buttons)
      const colorCtlId = "amap-color-toggle";
      let colorCtl = document.getElementById(colorCtlId);
      if (!colorCtl) {
        colorCtl = document.createElement("label");
        colorCtl.id = colorCtlId;
        colorCtl.style.position = "absolute";
        colorCtl.style.top = "5rem"; // under zoom buttons
        colorCtl.style.right = "0.5rem";
        colorCtl.style.display = "flex";
        colorCtl.style.alignItems = "center";
        colorCtl.style.gap = "0.5rem";
        colorCtl.style.padding = "0.35rem 0.5rem";
        colorCtl.style.background = "rgba(0,0,0,0.45)";
        colorCtl.style.color = "#fff";
        colorCtl.style.borderRadius = "0.375rem";
        colorCtl.style.zIndex = "11";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = "amap-color-checkbox";
        cb.checked = !!this._coloring.enabled;
        cb.style.accentColor = "#2f855a";
        const text = document.createElement("span");
        text.textContent = "Fields %";
        colorCtl.appendChild(cb);
        colorCtl.appendChild(text);
        wrapper.appendChild(colorCtl);
        cb.addEventListener("change", async () => {
          this._coloring.enabled = cb.checked;
          if (this._coloring.enabled) {
            await this._ensureDistrictsStats();
            this._applyFieldPercentageColoring();
            this._ensureLegendUI();
            this._updateLegendUI();
          } else {
            this._clearFieldPercentageColoring();
            this._hideLegendUI();
          }
          this._updateScaleToggleUI();
        });
      }
      // Scale mode toggle (only relevant when coloring enabled)
      const scaleCtlId = "amap-scale-toggle";
      let scaleCtl = document.getElementById(scaleCtlId);
      if (!scaleCtl) {
        scaleCtl = document.createElement("label");
        scaleCtl.id = scaleCtlId;
        scaleCtl.style.position = "absolute";
        scaleCtl.style.top = "8rem"; // below color toggle
        scaleCtl.style.right = "0.5rem";
        scaleCtl.style.display = this._coloring.enabled ? "flex" : "none";
        scaleCtl.style.alignItems = "center";
        scaleCtl.style.gap = "0.5rem";
        scaleCtl.style.padding = "0.35rem 0.5rem";
        scaleCtl.style.background = "rgba(0,0,0,0.45)";
        scaleCtl.style.color = "#fff";
        scaleCtl.style.borderRadius = "0.375rem";
        scaleCtl.style.zIndex = "11";
        const cb2 = document.createElement("input");
        cb2.type = "checkbox";
        cb2.id = "amap-scale-checkbox";
        cb2.checked = this._coloring.scaleMode === "fixed";
        cb2.style.accentColor = "#2f855a";
        const text2 = document.createElement("span");
        text2.textContent = "0–100%";
        scaleCtl.appendChild(cb2);
        scaleCtl.appendChild(text2);
        wrapper.appendChild(scaleCtl);
        cb2.addEventListener("change", () => {
          this._coloring.scaleMode = cb2.checked ? "fixed" : "dynamic";
          if (this._coloring.enabled) {
            this._applyFieldPercentageColoring();
            this._updateLegendUI();
          }
        });
      } else {
        // keep UI in sync if it already exists
        const cb2 = document.getElementById("amap-scale-checkbox");
        if (cb2) cb2.checked = this._coloring.scaleMode === "fixed";
        scaleCtl.style.display = this._coloring.enabled ? "flex" : "none";
      }
      // Coordinates overlay
      if (!this._coordsEl) {
        const coords = document.createElement("div");
        coords.className = "coords-overlay";
        coords.style.position = "absolute";
        coords.style.left = "0.75rem";
        coords.style.bottom = "0.5rem";
        coords.style.padding = "0.25rem 0.5rem";
        coords.style.background = "rgba(0,0,0,0.45)";
        coords.style.color = "#fff";
        coords.style.fontSize = "0.85rem";
        coords.style.borderRadius = "0.375rem";
        coords.style.pointerEvents = "none";
        coords.textContent = "Lon: —, Lat: —, Zoom: 1.0x";
        this._coordsEl = coords;
        wrapper.appendChild(coords);
      }
      this._updateCoordsOverlay(null, null);

      // Fancy message overlay (top-left), resizable and scrollable
      let msg = document.getElementById("amapMessage");
      if (!msg) {
        // Create if missing
        msg = document.createElement("div");
        msg.id = "amapMessage";
        wrapper.appendChild(msg);
      }
      if (msg) {
        // Re-parent inside map wrapper if it isn't already there
        if (msg.parentElement !== wrapper) {
          try {
            msg.parentElement && msg.parentElement.removeChild(msg);
          } catch (_) {}
          wrapper.appendChild(msg);
        }
        // Reset any previous margins that were meant for flow layout
        msg.style.margin = "0";
        // Ensure visible even if a CSS class hides it
        msg.style.display = "block";
        // Apply overlay styles
        msg.style.position = "absolute";
        msg.style.top = "0.5rem";
        msg.style.left = "0.5rem";
        msg.style.zIndex = "12";
        msg.style.background = "rgba(20,24,33,0.55)"; // translucent
        msg.style.backdropFilter = "blur(6px)";
        msg.style.WebkitBackdropFilter = "blur(6px)";
        msg.style.color = "#fff";
        msg.style.border = "1px solid rgba(255,255,255,0.15)";
        msg.style.borderRadius = "12px";
        msg.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
        msg.style.padding = "0.75rem";
        msg.style.maxWidth = "min(440px, 44vw)";
        msg.style.minWidth = "220px";
        msg.style.maxHeight = "48vh";
        msg.style.overflow = "auto";
        msg.style.resize = "both"; // allow user to resize
        msg.style.fontSize = "0.92rem";
        msg.style.lineHeight = "1.35";
        msg.style.wordBreak = "break-word";
        msg.style.overflowWrap = "anywhere";
        msg.style.userSelect = "text";
        msg.setAttribute("role", "region");
        msg.setAttribute("aria-label", "Area details");
        msg.setAttribute("aria-live", "polite");
        // Placeholder text when empty
        if (!msg.innerHTML.trim()) {
          msg.innerHTML = '<span style="opacity:.8">Click an area to see details…</span>';
        }
      }
      // Legend UI for color scale
      this._ensureLegendUI();
      this._updateScaleToggleUI();
    }

    _updateCoordsOverlay(x, y) {
      if (!this._coordsEl) return;
      const zoom = this._base.w / this._vb.w;
      if (x == null || y == null) {
        this._coordsEl.textContent = `Zoom: ${zoom.toFixed(2)}x`;
        return;
      }
      let lon, lat;
      if (this._geoFit && this._geoFit.useFit) {
        // Inverse of fitted projection
        const { scale, offsetX, offsetY, lonMin, latMax } = this._geoFit;
        lon = (x - offsetX) / scale + lonMin;
        lat = latMax - (y - offsetY) / scale;
      } else {
        // World equirectangular inverse
        lon = (x / this._base.w) * 360 - 180; // -180..180
        lat = 90 - (y / this._base.h) * 180; // 90..-90
      }
      this._coordsEl.textContent = `Lon: ${lon.toFixed(4)}°, Lat: ${lat.toFixed(4)}°, Zoom: ${zoom.toFixed(2)}x`;
    }

    _colorForType(type) {
      const map = {
        Wheat: "#f6d365",
        Corn: "#ffd166",
        Barley: "#e5c07b",
        Pasture: "#a8e6a3",
        Orchard: "#8fd19e",
        Forest: "#3b7f5c",
        Lake: "#73b7ff",
        Fallow: "#c4c4c4",
        Clover: "#a6f0c6",
      };
      return map[type] || null;
    }

    _setupControls() {
      const msg = document.getElementById("amapMessage");

      const svg = this.root && this.root.querySelector("svg");
      if (!svg) return;
      const show = this._labelsShouldBeVisible();
      svg.querySelectorAll(".amap__label").forEach((t) => {
        t.style.display = show ? "block" : "none";
      });
    }

    // --- Coloring by fields percentage ---------------------------------
    async _ensureDistrictsStats() {
      if (this._coloring.stats) return this._coloring.stats;
      try {
        // The apiService prefixes /api/v1/, path requested: /api/v1/fields/districts/
        const res = await this.apiService.getDistricts({
          requiresAuth: true,
        });
        const payload = res && res.success ? res.data : res;
        const data = payload && payload.data ? payload.data : payload;
        const map = new Map();
        const norm = (s) =>
          String(s || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        if (Array.isArray(data)) {
          for (const item of data) {
            const name = item.name || item.district || item.key || item.id;
            if (!name) continue;
            map.set(norm(name), item);
          }
        } else if (data && typeof data === "object") {
          for (const [name, item] of Object.entries(data)) {
            map.set(norm(name), item);
          }
        }
        this._coloring.stats = map;
        return map;
      } catch (e) {
        // Leave stats null on error
        return null;
      }
    }

    _applyFieldPercentageColoring() {
      if (!this._areas.length || !this._coloring.stats) return;
      // Compute percentages per area
      const norm = (s) =>
        String(s || "")
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
      const values = [];
      const perAreaPct = new Map(); // id -> pct
      for (const a of this._areas) {
        if (!a || a.areaHa == null || !isFinite(a.areaHa) || a.areaHa <= 0) continue;
        const key = norm(a.name || a.id);
        const stat = this._coloring.stats.get(key);
        const fieldsAreaHa = stat && (stat.fieldsAreaHa ?? stat.areaHa ?? stat.fields_area_ha);
        if (fieldsAreaHa == null || !isFinite(fieldsAreaHa)) continue;
        const pct = (fieldsAreaHa / a.areaHa) * 100;
        if (!isFinite(pct)) continue;
        perAreaPct.set(String(a.id), pct);
        values.push(pct);
      }
      if (!values.length) return;
      const dynamicMin = Math.min(...values);
      const dynamicMax = Math.max(...values);
      const useFixed = this._coloring.scaleMode === "fixed";
      const min = useFixed ? 0 : dynamicMin;
      const max = useFixed ? 100 : dynamicMax;
      this._coloring.minPct = min;
      this._coloring.maxPct = max;

      // Apply colors
      for (const [id, pct] of perAreaPct.entries()) {
        const el = this._shapeById.get(id);
        if (!el) continue;
        // Save original fill once
        if (!el.dataset.fillOriginal) {
          el.dataset.fillOriginal = el.getAttribute("fill") || "#88c999";
        }
        const color = this._greenToRed(pct, min, max);
        el.setAttribute("fill", color);
      }
      this._updateLegendUI();
    }

    _clearFieldPercentageColoring() {
      // Restore original fill for all shapes that were colored
      for (const el of this._shapeById.values()) {
        if (el && el.dataset && el.dataset.fillOriginal) {
          el.setAttribute("fill", el.dataset.fillOriginal);
          delete el.dataset.fillOriginal;
        }
      }
    }

    _greenToRed(value, min, max) {
      // Linear interpolation 0->green, 1->red
      const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
      // Use HSL from 130deg (green) to 0deg (red)
      const hue = 130 * (1 - t); // 130..0
      const sat = 75; // %
      const light = 55; // %
      return `hsl(${hue.toFixed(1)}, ${sat}%, ${light}%)`;
    }

    _ensureLegendUI() {
      const wrapper = this.root;
      if (!wrapper) return;
      const id = "amap-legend";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.style.position = "absolute";
        el.style.right = "0.5rem";
        el.style.bottom = "0.5rem";
        el.style.background = "rgba(0,0,0,0.45)";
        el.style.color = "#fff";
        el.style.borderRadius = "0.375rem";
        el.style.padding = "0.35rem 0.5rem";
        el.style.fontSize = "0.85rem";
        el.style.zIndex = "11";
        el.style.display = this._coloring.enabled ? "block" : "none";
        el.innerHTML = `
          <div style="display:flex;align-items:center;gap:.5rem;">
            <span>Fields %:</span>
            <span id="amap-legend-min">0%</span>
            <div style="height:10px;width:120px;background:linear-gradient(90deg, hsl(130,75%,55%), hsl(0,75%,55%));border-radius:6px;"></div>
            <span id="amap-legend-max">100%</span>
          </div>`;
        wrapper.appendChild(el);
      } else {
        el.style.display = this._coloring.enabled ? "block" : "none";
      }
    }

    _updateLegendUI() {
      const el = document.getElementById("amap-legend");
      if (!el) return;
      el.style.display = this._coloring.enabled ? "block" : "none";
      const minEl = document.getElementById("amap-legend-min");
      const maxEl = document.getElementById("amap-legend-max");
      if (minEl) minEl.textContent = `${this._coloring.minPct.toFixed(1)}%`;
      if (maxEl) maxEl.textContent = `${this._coloring.maxPct.toFixed(1)}%`;
    }

    _hideLegendUI() {
      const el = document.getElementById("amap-legend");
      if (el) el.style.display = "none";
    }

    _updateScaleToggleUI() {
      const scaleCtl = document.getElementById("amap-scale-toggle");
      if (!scaleCtl) return;
      scaleCtl.style.display = this._coloring.enabled ? "flex" : "none";
      const cb2 = document.getElementById("amap-scale-checkbox");
      if (cb2) cb2.checked = this._coloring.scaleMode === "fixed";
    }

    _labelsShouldBeVisible() {
      const zoom = this._base.w / this._vb.w;
      return this.state.labelsVisible && zoom >= this._labelZoomThreshold;
    }

    _applyLabelVisibility() {
      const svg = this.root && this.root.querySelector("svg");
      if (!svg) return;
      const show = this._labelsShouldBeVisible();
      svg.querySelectorAll(".amap__label").forEach((t) => {
        t.style.display = show ? "block" : "none";
      });
    }

    async _maybeLoadAreasFromApi() {
      // Optional extension: if an endpoint exists, you can provide custom areas
      // Expected format: [{ id, name, areaHa, points:[[x,y],...], label:{x,y}, fill?, stroke? }]
      try {
        const res = await this.apiService.get("map/fieldsmap", {
          requiresAuth: true,
        });
        if (res && res.success && res.data) {
          // Accept either our internal array or GeoJSON
          if (Array.isArray(res.data) && res.data.length) {
            this._fitViewBoxToAreas(res.data);
            this._renderSvg(res.data);
          } else if (res.data.type === "FeatureCollection" && Array.isArray(res.data.features)) {
            const areas = this._geojsonToAreas(res.data);
            if (areas.length) {
              this._fitViewBoxToAreas(areas);
              this._renderSvg(areas);
            }
          }
        }
      } catch (_) {
        // Silently ignore if endpoint not present
      }
    }

    async _onAreaClick(area) {
      this.state.selectedId = area.id;
      this._highlightSelected();

      const msg = document.getElementById("amapMessage");
      if (msg) {
        // Build a compact, grid-formatted details panel that scales for lots of data
        const rows = [];
        const add = (label, value) => {
          if (value == null || value === "") return;
          rows.push(`<div style="opacity:.85">${label}:</div><div>${value}</div>`);
        };
        // Header line with Name + optional icon
        const icon = area.details && area.details.icon ? area.details.icon : "";
        const title = area.name ? `${area.name}` : `Area ${area.id}`;
        const header = `
          <div style="display:flex;align-items:center;gap:.5rem;margin:0 0 .5rem 0;">
            ${icon ? `<span style="font-size:1.25rem;line-height:1">${icon}</span>` : ""}
            <strong style="font-size:1.05rem;">${title}</strong>
          </div>`;
        add("ID", area.id);
        add("Type", area.type);
        add("Headquarters", area.headquarters);
        add("Plates", area.plates);
        add("Province", area.province);
        if (area.areaKm2) add("Area (km²)", area.areaKm2);
        if (area.areaHa) add("Area (ha)", area.areaHa);
        add("Population", area.population);
        add("Density", area.density);
        if (area.details && area.details.message) add("Message", area.details.message);

        // Meta entries
        if (area.meta && Object.keys(area.meta).length) {
          for (const [k, v] of Object.entries(area.meta)) {
            add(k, v);
          }
        }

        // Try to fetch district stats by district name -> slug
        if (area.name && this.apiService) {
          const slug = String(area.name).trim().replace(/\s+/g, "-");
          try {
            const resp = await this.apiService.post(`fields/districts/${encodeURIComponent(slug)}`, null, { requiresAuth: true });
            const data = resp && resp.success ? resp.data : resp;
            // API is wrapped by formatResponseBody: { success, data }
            const payload = data && data.data ? data.data : data;
            if (payload && typeof payload === "object") {
              const stats = payload.fieldsCount != null || payload.fieldsAreaHa != null ? payload : payload[area.name];
              if (stats && typeof stats === "object") {
                add("Fields (count)", stats.fieldsCount ?? 0);
                add("Fields area (ha)", stats.fieldsAreaHa ?? 0);
                const avgFieldSizeHa = stats.fieldsAreaHa / stats.fieldsCount || 0;
                const roundedAvgFieldSizeHa = Math.round(avgFieldSizeHa * 100) / 100;

                add("Average field size (ha)", roundedAvgFieldSizeHa ?? 0);
                const percentage = (stats.fieldsAreaHa / area.areaHa) * 100 || 0;
                add("Percentage of fields area (ha)", percentage.toFixed(2) + "%");
              }
            }
          } catch (e) {
            // Non-fatal; ignore network errors in UI
          }
        }

        const grid = `
          <div style="display:grid;grid-template-columns:auto 1fr;gap:.25rem .5rem;align-items:start;">
            ${rows.join("")}
          </div>`;
        msg.innerHTML = header + grid;
      }
    }

    _highlightSelected() {
      const svg = this.root && this.root.querySelector("svg");
      if (!svg) return;
      svg.querySelectorAll(".amap__area").forEach((el) => {
        const id = el.getAttribute("data-id");
        if (this.state.selectedId && id === String(this.state.selectedId)) {
          el.classList.add("amap__area--selected");
        } else {
          el.classList.remove("amap__area--selected");
        }
      });
    }

    _sampleAreas() {
      // Load from an external JSON file once; return cached data if already loaded
      if (Array.isArray(this._areasCache)) return Promise.resolve(this._areasCache);
      return this._loadAreasFromFile();
    }

    async _loadAreasFromFile() {
      try {
        const res = await fetch("/data/abstract-areas.json", {
          cache: "no-cache",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // Accept either internal array or GeoJSON FeatureCollection
        if (Array.isArray(json)) {
          this._areasCache = json;
          return json;
        } else if (json && json.type === "FeatureCollection" && Array.isArray(json.features)) {
          const areas = this._geojsonToAreas(json);
          this._areasCache = areas;
          return areas;
        }
      } catch (err) {
        console.warn("Failed to load sample areas from file:", err);
      }
      return [];
    }

    // --- GeoJSON support -------------------------------------------------
    /**
     * Convert a GeoJSON FeatureCollection of Polygon/MultiPolygon (lon/lat WGS84)
     * into internal area objects suitable for SVG rendering.
     */
    _geojsonToAreas(fc) {
      if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return [];

      // Compute lon/lat bounds to fit into view
      const bbox = this._computeGeoBounds(fc);
      if (bbox) this._setGeoFit(bbox);

      const areas = [];
      fc.features.forEach((feat, idx) => {
        const geom = feat && feat.geometry;
        if (!geom || !geom.type || !geom.coordinates) return;
        const props = (feat && feat.properties) || {};
        const id = props.id ?? feat.id ?? idx;
        const name = props.nazwa || props.name || `Area ${id}`;
        const details = props.details && typeof props.details === "object" ? props.details : undefined;

        if (geom.type === "Polygon") {
          const rings = geom.coordinates; // [ [ [lon,lat],... ] (outer), [hole] ... ]
          const projected = rings.map((ring) => this._ringToPoints(ring));
          // Build path to support holes; also expose outer ring points for simple cases
          const d = this._ringsToPath(projected);
          const centroid = this._centroidOfRing(projected[0]);
          areas.push({
            id,
            name,
            areaKm2: props.area_km2 || props.areaKm2 || undefined,
            areaHa: props.area_ha || props.areaHa || undefined,
            population: props.population || props.populacja || undefined,
            density: props.density || props.gęstość || undefined,
            path: d,
            points: projected[0],
            _rings: projected,
            label: { x: centroid.x, y: centroid.y },
            type: props.type || props.typ || undefined,
            details,
          });
        } else if (geom.type === "MultiPolygon") {
          const polys = geom.coordinates; // [ [rings...], [rings...] ]
          polys.forEach((rings) => {
            const projected = rings.map((ring) => this._ringToPoints(ring));
            const d = this._ringsToPath(projected);
            const centroid = this._centroidOfRing(projected[0]);
            areas.push({
              id,
              name,
              path: d,
              points: projected[0],
              _rings: projected,
              label: { x: centroid.x, y: centroid.y },
              type: props.type || props.typ || undefined,
              details,
            });
          });
        }
      });
      return areas;
    }

    _projectLonLat(lon, lat) {
      // If we have a fitted local projection, use it; else use world equirectangular
      if (this._geoFit && this._geoFit.useFit) {
        const { scale, offsetX, offsetY, lonMin, latMax } = this._geoFit;
        const x = offsetX + (lon - lonMin) * scale;
        const y = offsetY + (latMax - lat) * scale;
        return [x, y];
      }
      // Equirectangular projection into SVG base box
      const x = ((lon + 180) / 360) * this._base.w;
      const y = ((90 - lat) / 180) * this._base.h;
      return [x, y];
    }

    _ringToPoints(ring) {
      // ring: [ [lon,lat], ... ] ; ensure closed but do not duplicate last point in polygon 'points'
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const c = ring[i];
        if (!Array.isArray(c) || c.length < 2) continue;
        const [lon, lat] = c;
        pts.push(this._projectLonLat(lon, lat));
      }
      return pts;
    }

    _ringsToPath(rings) {
      // rings: [ [ [x,y], ...], [hole...], ... ]
      const parts = [];
      rings.forEach((ring) => {
        if (!ring || !ring.length) return;
        const [x0, y0] = ring[0];
        const cmds = ["M", x0, y0];
        for (let i = 1; i < ring.length; i++) {
          const [x, y] = ring[i];
          cmds.push("L", x, y);
        }
        cmds.push("Z");
        parts.push(cmds.join(" "));
      });
      return parts.join(" ");
    }

    _centroidOfRing(points) {
      // Polygon centroid (2D). If degenerate, fallback to average.
      let area = 0,
        cx = 0,
        cy = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [x0, y0] = points[j];
        const [x1, y1] = points[i];
        const f = x0 * y1 - x1 * y0;
        area += f;
        cx += (x0 + x1) * f;
        cy += (y0 + y1) * f;
      }
      area *= 0.5;
      if (Math.abs(area) < 1e-8) {
        // fallback: average
        let sx = 0,
          sy = 0;
        for (const [x, y] of points) {
          sx += x;
          sy += y;
        }
        const n = points.length || 1;
        return { x: sx / n, y: sy / n };
      }
      return { x: cx / (6 * area), y: cy / (6 * area) };
    }

    // Fit current viewBox to the projected bounds of given areas
    _fitViewBoxToAreas(areas) {
      if (!Array.isArray(areas) || !areas.length) return;
      let xmin = Infinity,
        ymin = Infinity,
        xmax = -Infinity,
        ymax = -Infinity;
      for (const a of areas) {
        const collect = [];
        if (a.path && a._rings) {
          // When available, use precomputed rings
          a._rings.forEach((r) => collect.push(...r));
        } else if (Array.isArray(a.points)) {
          collect.push(...a.points);
        }
        for (const p of collect) {
          if (!p || p.length < 2) continue;
          const [x, y] = p;
          if (x < xmin) xmin = x;
          if (x > xmax) xmax = x;
          if (y < ymin) ymin = y;
          if (y > ymax) ymax = y;
        }
      }
      if (!isFinite(xmin) || !isFinite(xmax) || !isFinite(ymin) || !isFinite(ymax)) return;
      const pad = this._fitPadding;
      xmin -= pad;
      ymin -= pad;
      xmax += pad;
      ymax += pad;
      const w = Math.max(10, xmax - xmin);
      const h = Math.max(10, ymax - ymin);
      this._vb = { x: xmin, y: ymin, w, h };
    }

    // Compute lon/lat bounding box across all features (Polygons/MultiPolygons)
    _computeGeoBounds(fc) {
      let lonMin = Infinity,
        lonMax = -Infinity,
        latMin = Infinity,
        latMax = -Infinity;
      let found = false;
      for (const feat of fc.features) {
        const g = feat && feat.geometry;
        if (!g || !g.coordinates) continue;
        if (g.type === "Polygon") {
          for (const ring of g.coordinates) {
            for (const c of ring) {
              if (!Array.isArray(c) || c.length < 2) continue;
              const [lon, lat] = c;
              if (!isFinite(lon) || !isFinite(lat)) continue;
              found = true;
              if (lon < lonMin) lonMin = lon;
              if (lon > lonMax) lonMax = lon;
              if (lat < latMin) latMin = lat;
              if (lat > latMax) latMax = lat;
            }
          }
        } else if (g.type === "MultiPolygon") {
          for (const poly of g.coordinates) {
            for (const ring of poly) {
              for (const c of ring) {
                if (!Array.isArray(c) || c.length < 2) continue;
                const [lon, lat] = c;
                if (!isFinite(lon) || !isFinite(lat)) continue;
                found = true;
                if (lon < lonMin) lonMin = lon;
                if (lon > lonMax) lonMax = lon;
                if (lat < latMin) latMin = lat;
                if (lat > latMax) latMax = lat;
              }
            }
          }
        }
      }
      if (!found) return null;
      return { lonMin, lonMax, latMin, latMax };
    }

    // Create fitted projection to map bounds into SVG view with padding and preserving aspect ratio
    _setGeoFit(bounds) {
      const pad = Math.min(40, Math.min(this._base.w, this._base.h) * 0.05);
      const lonSpan = Math.max(1e-9, bounds.lonMax - bounds.lonMin);
      const latSpan = Math.max(1e-9, bounds.latMax - bounds.latMin);
      const scaleX = (this._base.w - 2 * pad) / lonSpan;
      const scaleY = (this._base.h - 2 * pad) / latSpan;
      const scale = Math.min(scaleX, scaleY) * 4;
      // Centering offsets
      const contentW = lonSpan * scale;
      const contentH = latSpan * scale;
      const offsetX = (this._base.w - contentW) / 2 - bounds.lonMin * scale;
      const offsetY = (this._base.h - contentH) / 2 + bounds.latMax * scale * 1 - contentH; // account for y inversion via latMax - lat
      // The above formula can be simplified by computing base offset + padding: we center content vertically and horizontally.
      this._geoFit = {
        useFit: true,
        scale,
        offsetX: (this._base.w - contentW) / 2 - bounds.lonMin * scale,
        offsetY: (this._base.h - contentH) / 2, // actual y computed with latMax in _projectLonLat
        lonMin: bounds.lonMin,
        lonMax: bounds.lonMax,
        latMin: bounds.latMin,
        latMax: bounds.latMax,
        pad,
      };
    }
  }

  window.RolnopolMap = RolnopolMap;
})();
