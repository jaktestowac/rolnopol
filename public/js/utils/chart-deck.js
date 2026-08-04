/**
 * ChartDeck — a customizable grid of metric charts rendered with ChartKit.
 *
 * A deck owns everything around the SVG: the option panel wiring, the
 * localStorage-backed preferences, the per-metric cards (live value, trend
 * arrow, min/avg/max footer, style picker) and the hover tooltips. Pages
 * supply the metrics and the ids of their markup, then push data in:
 *
 *   var deck = ChartDeck.create({
 *     storageKey: "rolnopol.weather.chartOptions",
 *     rootId: "weatherCharts",
 *     emptyId: "weatherChartsEmpty",
 *     series: [{ key: "temp", label: "Temperature", unit: "°C", hue: 0,
 *                read: function (item) { return item.temperatureC; } }, ...],
 *     xLabel: function (item, index) { return String(index); },
 *   });
 *   deck.setData(rows);
 *
 * Series options: key, label, icon, unit, precision, hue, defaultStyle,
 * zeroFloor, pct, read(item), secondary { label, read(item) } and
 * band { min(item), max(item) } for min/max envelopes.
 *
 * A deck fed by a live stream can also be scrubbed: `window` is how many
 * readings the chart shows, and the scrub control moves that window back over
 * the retained history while new readings keep arriving. The deck publishes
 * both as `data-*` on its root, so the state is assertable without reading
 * pixels — see `getWindowState()`.
 */
(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ChartDeck = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  var DECK_DEFAULTS = {
    style: "auto",
    palette: "meadow",
    columns: 2,
    height: 160,
    window: 0,
    yScale: "auto",
    smooth: true,
    points: false,
    grid: true,
    fill: true,
    axis: true,
    secondary: true,
  };

  var CONTROL_IDS = ["style", "palette", "columns", "height", "window", "yScale"];
  var FLAG_IDS = ["smooth", "points", "grid", "fill", "axis", "secondary"];
  var NUMERIC_KEYS = { columns: true, height: true, window: true };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampNumber(value, min, max) {
    var number = Number(value);
    if (!isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  /**
   * Where the visible window sits over the retained readings.
   *
   * `offset` counts readings back from the live edge: 0 is the newest reading,
   * `maxOffset` is as far back as the retained history reaches. `position` is
   * the same thing read left-to-right (0 = oldest window, `maxOffset` = live),
   * which is the direction a scrub slider runs in.
   */
  function resolveWindow(state) {
    var readingCount = Math.max(0, Math.floor(Number(state.readingCount)) || 0);
    var windowSize = Math.max(0, Math.floor(Number(state.windowSize)) || 0);
    var span = windowSize > 0 ? Math.min(windowSize, readingCount) : readingCount;
    var maxOffset = Math.max(0, readingCount - span);
    var offset = clampNumber(state.offset, 0, maxOffset);
    var endIndex = readingCount - 1 - offset;

    return {
      readingCount: readingCount,
      windowSize: windowSize,
      span: span,
      offset: offset,
      maxOffset: maxOffset,
      position: maxOffset - offset,
      following: offset === 0,
      startIndex: span === 0 ? -1 : endIndex - span + 1,
      endIndex: span === 0 ? -1 : endIndex,
    };
  }

  function create(spec) {
    var series = spec.series || [];
    var controls = spec.controls || {};
    var storageKey = spec.storageKey;
    var doc = spec.documentRef || (typeof document === "undefined" ? null : document);
    var win = spec.windowRef || (typeof window === "undefined" ? null : window);

    var defaults = clone(DECK_DEFAULTS);
    Object.keys(spec.defaults || {}).forEach(function (key) {
      defaults[key] = spec.defaults[key];
    });
    defaults.visible = {};
    defaults.styles = {};
    series.forEach(function (item) {
      defaults.visible[item.key] = item.visible !== false;
      defaults.styles[item.key] = "auto";
    });

    var config = clone(defaults);
    var data = [];
    var geometry = {};
    var layoutSignature = "";
    var changeListeners = [];

    // Retained readings are numbered by a monotonic sequence that survives
    // eviction, so a scrubbed window can be anchored to the readings it shows
    // rather than to a distance from the live edge. Arriving readings must not
    // slide the chart sideways under the user's thumb.
    var firstSeq = 0; // sequence number of data[0]
    var anchorSeq = null; // newest visible reading while scrubbing; null = follow live

    function kit() {
      return win.ChartKit;
    }

    function escapeHtml(text) {
      return kit().escapeHtml(text);
    }

    function byId(id) {
      return id && doc ? doc.getElementById(id) : null;
    }

    function root() {
      return byId(spec.rootId);
    }

    function seriesFor(key) {
      for (var i = 0; i < series.length; i += 1) {
        if (series[i].key === key) {
          return series[i];
        }
      }
      return null;
    }

    /* ---------------------------------------------------------- preferences */

    function loadConfig() {
      try {
        var raw = win.localStorage.getItem(storageKey);
        if (!raw) {
          return;
        }
        var saved = JSON.parse(raw);
        if (!saved || typeof saved !== "object") {
          return;
        }
        Object.keys(defaults).forEach(function (key) {
          if (saved[key] === undefined) {
            return;
          }
          if (key === "visible" || key === "styles") {
            Object.keys(defaults[key]).forEach(function (seriesKey) {
              if (saved[key][seriesKey] !== undefined) {
                config[key][seriesKey] = saved[key][seriesKey];
              }
            });
            return;
          }
          config[key] = saved[key];
        });
      } catch (error) {
        /* corrupt or unavailable storage — keep defaults */
      }
    }

    function saveConfig() {
      try {
        win.localStorage.setItem(storageKey, JSON.stringify(config));
      } catch (error) {
        /* storage full or blocked — preferences just won't persist */
      }
    }

    function notifyChange(key) {
      changeListeners.forEach(function (listener) {
        listener(key, config[key], config);
      });
    }

    /* --------------------------------------------------------- scrub window */

    function newestSeq() {
      return firstSeq + data.length - 1;
    }

    function windowState() {
      return resolveWindow({
        readingCount: data.length,
        windowSize: config.window,
        offset: anchorSeq === null ? 0 : newestSeq() - anchorSeq,
      });
    }

    /**
     * Pull the anchor back inside what the buffer still holds. A held window
     * whose oldest reading has been evicted gets pushed forward — that is the
     * honest consequence of a bounded history, not a reason to point at
     * readings that are gone.
     */
    function clampAnchor() {
      if (anchorSeq === null) {
        return;
      }
      var state = windowState();
      anchorSeq = state.offset === 0 ? null : newestSeq() - state.offset;
    }

    function setWindowOffset(offset) {
      if (!isFinite(Number(offset))) {
        return;
      }
      var state = windowState();
      var next = clampNumber(offset, 0, state.maxOffset);
      // A drag ends with `change` reporting the value its last `input` already
      // delivered, and a clamped drag reports a value it cannot have.
      if (next === state.offset) {
        return;
      }
      anchorSeq = next === 0 ? null : newestSeq() - next;
      render();
      notifyChange("scrub");
    }

    function setWindowPosition(position) {
      if (!isFinite(Number(position))) {
        return;
      }
      setWindowOffset(windowState().maxOffset - Number(position));
    }

    function scrubText(state) {
      var noun = spec.countLabel || "readings";
      if (state.readingCount === 0) {
        return "Live — waiting for the first reading…";
      }
      if (state.following) {
        return "Live — latest " + state.span + " of " + state.readingCount + " " + noun;
      }
      return (
        "Held " +
        state.offset +
        " " +
        noun +
        " back — showing " +
        (state.startIndex + 1) +
        "–" +
        (state.endIndex + 1) +
        " of " +
        state.readingCount
      );
    }

    /** Publishes the window as `data-*` so tests can read it without pixels. */
    function writeWindowMirror(state, rows) {
      var host = root();
      if (host) {
        host.setAttribute("data-reading-count", String(state.readingCount));
        host.setAttribute("data-window-size", String(state.windowSize));
        host.setAttribute("data-window-span", String(rows.length));
        host.setAttribute("data-window-offset", String(state.offset));
        host.setAttribute("data-window-max-offset", String(state.maxOffset));
        host.setAttribute("data-window-position", String(state.position));
        host.setAttribute("data-window-start", String(state.startIndex));
        host.setAttribute("data-window-end", String(state.endIndex));
        host.setAttribute("data-window-follow", state.following ? "live" : "held");
        if (typeof spec.rowStamp === "function") {
          host.setAttribute("data-window-first-at", rows.length ? String(spec.rowStamp(rows[0])) : "");
          host.setAttribute("data-window-last-at", rows.length ? String(spec.rowStamp(rows[rows.length - 1])) : "");
        }
      }

      var bar = byId(spec.scrubBarId);
      if (bar) {
        bar.setAttribute("data-window-follow", state.following ? "live" : "held");
        bar.setAttribute("data-scrub-max", String(state.maxOffset));
      }
    }

    function syncScrubControl(state) {
      var text = scrubText(state);
      var slider = byId(controls.scrub);
      if (slider) {
        // `max` grows with the retained history: the thumb keeps its value while
        // the track it sits on gets longer, so the view recedes into the past.
        slider.max = String(state.maxOffset);
        slider.setAttribute("max", String(state.maxOffset));
        slider.value = String(state.position);
        slider.disabled = state.maxOffset === 0;
        slider.setAttribute("aria-valuetext", text);
      }

      var readout = byId(spec.scrubReadoutId);
      if (readout) {
        readout.textContent = text;
      }

      var followBtn = byId(spec.followBtnId);
      if (followBtn) {
        followBtn.disabled = state.following;
      }
    }

    /* --------------------------------------------------------------- render */

    function resolveStyle(item) {
      var perChart = config.styles[item.key];
      if (perChart && perChart !== "auto") {
        return perChart;
      }
      if (config.style && config.style !== "auto") {
        return config.style;
      }
      return item.defaultStyle || "line";
    }

    function visibleSeries() {
      return series.filter(function (item) {
        return config.visible[item.key] !== false;
      });
    }

    function windowedData(state) {
      return state.span === 0 ? [] : data.slice(state.startIndex, state.endIndex + 1);
    }

    function styleOptionsMarkup(item, selected) {
      var labels = { auto: "Auto", area: "Area", line: "Line", bars: "Bars", gauge: "Gauge", band: "Band" };
      var styles = ["auto", "area", "line", "bars", "gauge"];
      if (item.band) {
        styles.push("band");
      }
      return styles
        .map(function (style) {
          return '<option value="' + style + '"' + (style === selected ? " selected" : "") + ">" + labels[style] + "</option>";
        })
        .join("");
    }

    function cardMarkup(item) {
      return (
        '<article class="ck-chart" data-chart="' +
        item.key +
        '">' +
        '<header class="ck-chart__head">' +
        '<span class="ck-chart__title"><i class="fas ' +
        (item.icon || "fa-chart-line") +
        '" aria-hidden="true"></i> ' +
        escapeHtml(item.label) +
        "</span>" +
        '<span class="ck-chart__now" data-chart-now="' +
        item.key +
        '">—</span>' +
        '<select class="ck-chart__style form-input" data-chart-style="' +
        item.key +
        '" aria-label="' +
        escapeHtml(item.label) +
        ' chart style">' +
        styleOptionsMarkup(item, config.styles[item.key] || "auto") +
        "</select>" +
        "</header>" +
        '<div class="ck-chart__plot" data-chart-plot="' +
        item.key +
        '">' +
        '<div class="ck-chart__svg-wrap" data-chart-svg="' +
        item.key +
        '"></div>' +
        '<div class="ck-chart__cursor" data-chart-cursor="' +
        item.key +
        '" hidden></div>' +
        '<div class="ck-chart__tip" data-chart-tip="' +
        item.key +
        '" hidden></div>' +
        "</div>" +
        '<footer class="ck-chart__stats" data-chart-stats="' +
        item.key +
        '"></footer>' +
        "</article>"
      );
    }

    function bindCard(item) {
      var host = root();
      if (!host) {
        return;
      }
      var select = host.querySelector('[data-chart-style="' + item.key + '"]');
      if (select) {
        select.addEventListener("change", function () {
          config.styles[item.key] = select.value;
          saveConfig();
          layoutSignature = "";
          render();
        });
      }

      var plot = host.querySelector('[data-chart-plot="' + item.key + '"]');
      if (!plot) {
        return;
      }
      plot.addEventListener("mousemove", function (event) {
        showTooltip(item, plot, event);
      });
      plot.addEventListener("mouseleave", function () {
        hideTooltip(item.key);
      });
    }

    function ensureCards(list) {
      var host = root();
      if (!host) {
        return;
      }
      var signature =
        list
          .map(function (item) {
            return item.key + ":" + resolveStyle(item);
          })
          .join("|") +
        "#" +
        config.columns;

      if (signature === layoutSignature) {
        return;
      }
      layoutSignature = signature;
      host.style.setProperty("--ck-columns", String(config.columns));
      host.innerHTML = list.map(cardMarkup).join("");
      list.forEach(bindCard);
    }

    function hideTooltip(key) {
      var host = root();
      if (!host) {
        return;
      }
      var tip = host.querySelector('[data-chart-tip="' + key + '"]');
      var cursor = host.querySelector('[data-chart-cursor="' + key + '"]');
      if (tip) {
        tip.hidden = true;
      }
      if (cursor) {
        cursor.hidden = true;
      }
    }

    function showTooltip(item, plot, event) {
      var geom = geometry[item.key];
      var host = root();
      if (!geom || !host || !geom.points || geom.points.length === 0) {
        return;
      }
      var tip = host.querySelector('[data-chart-tip="' + item.key + '"]');
      var cursor = host.querySelector('[data-chart-cursor="' + item.key + '"]');
      if (!tip || !cursor) {
        return;
      }

      var rect = plot.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      var viewX = ((event.clientX - rect.left) / rect.width) * kit().DEFAULT_WIDTH;
      var nearest = geom.points[0];
      geom.points.forEach(function (point) {
        if (Math.abs(point.x - viewX) < Math.abs(nearest.x - viewX)) {
          nearest = point;
        }
      });

      var row = geom.rows[nearest.index];
      if (!row) {
        return;
      }
      var lines =
        '<span class="ck-chart__tip-time">' +
        escapeHtml(labelFor(row, nearest.index)) +
        "</span>" +
        '<span class="ck-chart__tip-value">' +
        escapeHtml(valueText(item, item.read(row))) +
        "</span>";
      if (item.band && config.secondary) {
        lines +=
          '<span class="ck-chart__tip-extra">' +
          escapeHtml(valueText(item, item.band.min(row)) + " … " + valueText(item, item.band.max(row))) +
          "</span>";
      }
      if (item.secondary && config.secondary) {
        lines +=
          '<span class="ck-chart__tip-extra">' +
          escapeHtml(item.secondary.label + " " + valueText(item, item.secondary.read(row))) +
          "</span>";
      }
      tip.innerHTML = lines;

      var left = (nearest.x / kit().DEFAULT_WIDTH) * rect.width;
      cursor.style.left = left + "px";
      cursor.hidden = false;
      tip.style.left = Math.max(4, Math.min(rect.width - 4, left)) + "px";
      tip.hidden = false;
    }

    function valueText(item, value) {
      return kit().format(value, item.precision) + " " + (item.unit || "");
    }

    function labelFor(row, index) {
      return typeof spec.xLabel === "function" ? String(spec.xLabel(row, index)) : String(index + 1);
    }

    function statsMarkup(item, values, rows) {
      var finite = values.filter(function (value) {
        return isFinite(value);
      });
      if (finite.length === 0) {
        return "";
      }
      var sum = finite.reduce(function (acc, value) {
        return acc + value;
      }, 0);
      // A banded metric reports the envelope it draws, not the middle line.
      var lows = finite;
      var highs = finite;
      if (item.band && config.secondary) {
        lows = rows.map(item.band.min).filter(isFinite);
        highs = rows.map(item.band.max).filter(isFinite);
      }
      return (
        "<span><em>min</em> " +
        escapeHtml(kit().format(Math.min.apply(null, lows), item.precision)) +
        "</span>" +
        "<span><em>avg</em> " +
        escapeHtml(kit().format(sum / finite.length, item.precision)) +
        "</span>" +
        "<span><em>max</em> " +
        escapeHtml(kit().format(Math.max.apply(null, highs), item.precision)) +
        "</span>" +
        "<span><em>" +
        escapeHtml(spec.countLabel || "readings") +
        "</em> " +
        finite.length +
        "</span>"
      );
    }

    function trendIcon(values) {
      if (values.length < 2) {
        return "";
      }
      var delta = values[values.length - 1] - values[values.length - 2];
      if (!isFinite(delta) || Math.abs(delta) < 1e-9) {
        return ' <i class="fas fa-minus ck-chart__trend ck-chart__trend--flat" aria-hidden="true"></i>';
      }
      return delta > 0
        ? ' <i class="fas fa-arrow-trend-up ck-chart__trend ck-chart__trend--up" aria-hidden="true"></i>'
        : ' <i class="fas fa-arrow-trend-down ck-chart__trend ck-chart__trend--down" aria-hidden="true"></i>';
    }

    function render() {
      var host = root();
      var empty = byId(spec.emptyId);

      clampAnchor();
      var state = windowState();
      var rows = windowedData(state);
      writeWindowMirror(state, rows);
      syncScrubControl(state);

      if (!host) {
        return;
      }

      var list = visibleSeries();

      if (list.length === 0 || rows.length === 0) {
        host.innerHTML = "";
        layoutSignature = "";
        geometry = {};
        if (empty) {
          empty.hidden = false;
          empty.textContent =
            list.length === 0
              ? spec.noSeriesText || "No metrics selected — pick at least one series under Customize."
              : spec.noDataText || "No data to chart yet.";
        }
        return;
      }
      if (empty) {
        empty.hidden = true;
      }

      ensureCards(list);
      var labels = rows.map(labelFor);

      list.forEach(function (item) {
        var color = kit().paletteColor(config.palette, item.hue);
        var values = rows.map(item.read);
        var result = kit().render(
          {
            key: item.key,
            label: item.label,
            unit: item.unit,
            precision: item.precision,
            values: values,
            extras: item.secondary && config.secondary ? rows.map(item.secondary.read) : null,
            // The `secondary` flag covers every companion series: ghost lines
            // (feels-like, gusts) and min/max envelopes alike.
            band: item.band && config.secondary ? { min: rows.map(item.band.min), max: rows.map(item.band.max) } : null,
            zeroFloor: item.zeroFloor,
            pct: item.pct,
            style: resolveStyle(item),
            xLabels: labels,
          },
          {
            width: kit().DEFAULT_WIDTH,
            height: Number(config.height) || defaults.height,
            color: color,
            smooth: config.smooth,
            points: config.points,
            grid: config.grid,
            fill: config.fill,
            axis: config.axis,
            yScale: config.yScale,
          },
        );

        var svgHost = host.querySelector('[data-chart-svg="' + item.key + '"]');
        if (svgHost) {
          svgHost.innerHTML = result.svg;
        }
        geometry[item.key] = result.points ? { points: result.points, rows: rows } : null;

        var now = host.querySelector('[data-chart-now="' + item.key + '"]');
        if (now) {
          now.innerHTML = escapeHtml(valueText(item, values[values.length - 1])) + trendIcon(values);
          now.style.color = color;
        }

        var stats = host.querySelector('[data-chart-stats="' + item.key + '"]');
        if (stats) {
          stats.innerHTML = statsMarkup(item, values, rows);
        }
      });
    }

    /* -------------------------------------------------------------- options */

    function syncControls() {
      series.forEach(function (item) {
        var toggle = doc.querySelector('[data-series-toggle="' + item.key + '"]');
        if (toggle) {
          toggle.checked = config.visible[item.key] !== false;
        }
      });
      CONTROL_IDS.forEach(function (key) {
        var el = byId(controls[key]);
        if (el) {
          el.value = String(config[key]);
        }
        syncReadout(key);
      });
      FLAG_IDS.forEach(function (key) {
        var el = byId(controls[key]);
        if (el) {
          el.checked = config[key] !== false;
        }
      });
    }

    /**
     * A slider needs its value written out somewhere readable. The markup owns
     * the noun ("30 readings"), the deck only writes the number.
     */
    function syncReadout(key) {
      if (!doc || typeof doc.querySelectorAll !== "function") {
        return;
      }
      var nodes = doc.querySelectorAll('[data-ck-readout="' + key + '"]');
      Array.prototype.forEach.call(nodes, function (node) {
        node.textContent = String(config[key]);
      });
    }

    function isRange(el) {
      return el.type === "range" || (typeof el.getAttribute === "function" && el.getAttribute("type") === "range");
    }

    /** Ranges report every step through `input`; selects only fire `change`. */
    function onControlInput(el, handler) {
      el.addEventListener("change", handler);
      if (isRange(el)) {
        el.addEventListener("input", handler);
      }
    }

    function bindOptions() {
      series.forEach(function (item) {
        var toggle = doc.querySelector('[data-series-toggle="' + item.key + '"]');
        if (!toggle) {
          return;
        }
        toggle.addEventListener("change", function () {
          config.visible[item.key] = toggle.checked;
          saveConfig();
          layoutSignature = "";
          render();
        });
      });

      CONTROL_IDS.forEach(function (key) {
        var el = byId(controls[key]);
        if (!el) {
          return;
        }
        onControlInput(el, function () {
          var next = NUMERIC_KEYS[key] ? Number(el.value) : el.value;
          // A range fires `input` on every step and `change` on release; only
          // the step that actually moves the value is worth a re-render.
          if (config[key] === next) {
            return;
          }
          config[key] = next;
          saveConfig();
          syncReadout(key);
          layoutSignature = "";
          render();
          notifyChange(key);
        });
      });

      var scrub = byId(controls.scrub);
      if (scrub) {
        onControlInput(scrub, function () {
          setWindowPosition(scrub.value);
        });
      }

      var followBtn = byId(spec.followBtnId);
      if (followBtn) {
        followBtn.addEventListener("click", function () {
          setWindowOffset(0);
        });
      }

      FLAG_IDS.forEach(function (key) {
        var el = byId(controls[key]);
        if (!el) {
          return;
        }
        el.addEventListener("change", function () {
          config[key] = el.checked;
          saveConfig();
          render();
          notifyChange(key);
        });
      });

      var toggleBtn = byId(spec.optionsToggleId);
      var panel = byId(spec.optionsPanelId);
      if (toggleBtn && panel) {
        toggleBtn.addEventListener("click", function () {
          var opening = panel.hasAttribute("hidden");
          if (opening) {
            panel.removeAttribute("hidden");
          } else {
            panel.setAttribute("hidden", "");
          }
          toggleBtn.setAttribute("aria-expanded", opening ? "true" : "false");
        });
      }

      var resetBtn = byId(spec.resetBtnId);
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          config = clone(defaults);
          anchorSeq = null;
          saveConfig();
          syncControls();
          layoutSignature = "";
          render();
          notifyChange("reset");
        });
      }
    }

    /**
     * Programmatic equivalent of moving a control — used to restore state the
     * page keeps elsewhere (a query string, say). Values are clamped to the
     * control's own min/max, so a hand-edited URL cannot ask for 99 columns.
     */
    function set(key, value) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key) || key === "visible" || key === "styles") {
        return false;
      }

      var next = value;
      if (NUMERIC_KEYS[key]) {
        var el = byId(controls[key]);
        var min = el ? Number(el.getAttribute("min")) : NaN;
        var max = el ? Number(el.getAttribute("max")) : NaN;
        next = Number(value);
        if (!isFinite(next)) {
          return false;
        }
        if (isFinite(min) && isFinite(max)) {
          next = clampNumber(next, min, max);
        }
      } else if (FLAG_IDS.indexOf(key) !== -1) {
        next = value === true || value === "true" || value === "1";
      } else {
        next = String(value);
      }

      if (config[key] === next) {
        return false;
      }
      config[key] = next;
      saveConfig();
      syncControls();
      layoutSignature = "";
      render();
      notifyChange(key);
      return true;
    }

    function init() {
      loadConfig();
      syncControls();
      bindOptions();
      render();
    }

    return {
      init: init,
      render: render,
      setData: function (rows) {
        data = Array.isArray(rows) ? rows.slice() : [];
        firstSeq = 0;
        anchorSeq = null;
        render();
      },
      appendData: function (row, maxRows) {
        data.push(row);
        var cap = maxRows || 240;
        while (data.length > cap) {
          data.shift();
          // The dropped reading keeps its number: the anchor of a held window
          // is a sequence, not an index, so eviction cannot renumber it.
          firstSeq += 1;
        }
        render();
      },
      clear: function () {
        data = [];
        geometry = {};
        layoutSignature = "";
        firstSeq = 0;
        anchorSeq = null;
        render();
      },
      getData: function () {
        return data.slice();
      },
      get: function (key) {
        return config[key];
      },
      getDefault: function (key) {
        return defaults[key];
      },
      set: set,
      getWindowState: function () {
        return windowState();
      },
      getVisibleData: function () {
        return windowedData(windowState());
      },
      setWindowOffset: setWindowOffset,
      setWindowPosition: setWindowPosition,
      followLive: function () {
        setWindowOffset(0);
      },
      onChange: function (listener) {
        if (typeof listener === "function") {
          changeListeners.push(listener);
        }
      },
    };
  }

  return {
    create: create,
    DEFAULTS: DECK_DEFAULTS,
    resolveWindow: resolveWindow,
    clampNumber: clampNumber,
  };
});
