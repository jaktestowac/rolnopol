/**
 * Weather Live charts — rolling visualizations of the SSE `conditions` frames.
 *
 * The page (js/pages/weather-live.js) hands every frame to
 * `WeatherLiveCharts.push(frame)`; the shared ChartDeck keeps the history, the
 * user's preferences and the cards. This module describes the live metrics and
 * owns the two things the deck doesn't know about:
 *
 *   - the stream cadence, which the page needs in order to re-open the
 *     EventSource;
 *   - the query string. The window / columns / height sliders and the scrub
 *     position are mirrored into the URL, so a view can be linked to and
 *     reloaded. An explicit query parameter beats the stored preference.
 *
 * Scrubbing is deliberately independent of the stream: readings keep arriving
 * into the retained history while the chart holds still on the window the user
 * dragged to. A deep link asking for more history than the page has collected
 * yet stays pending until the buffer can honour it — you cannot scrub into
 * readings that have not arrived.
 */
(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  // In a browser the page talks to one ready-made instance; the factory is for
  // tests, which require this file and inject their own document/window.
  if (typeof document !== "undefined") {
    root.WeatherLiveCharts = api.create({});
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  var STORAGE_KEY = "rolnopol.weatherLive.chartOptions";
  var CADENCE_KEY = "rolnopol.weatherLive.intervalMs";
  var DEFAULT_INTERVAL_MS = 4000;
  var MAX_HISTORY = 240;
  var DEFAULT_WINDOW = 30;

  // Deck config key → query parameter. `window` is the history window size;
  // `scrub` is handled apart because it is view state, not a preference.
  var QUERY_CONTROLS = [
    { key: "window", param: "history" },
    { key: "columns", param: "columns" },
    { key: "height", param: "height" },
  ];
  var SCRUB_PARAM = "scrub";

  var SERIES = [
    {
      key: "temp",
      label: "Temperature",
      icon: "fa-temperature-half",
      unit: "°C",
      precision: 1,
      hue: 0,
      defaultStyle: "area",
      read: function (frame) {
        return frame.temperatureC;
      },
      secondary: {
        label: "Feels like",
        read: function (frame) {
          return frame.feelsLikeC;
        },
      },
    },
    {
      key: "wind",
      label: "Wind speed",
      icon: "fa-wind",
      unit: "km/h",
      precision: 0,
      hue: 1,
      defaultStyle: "line",
      zeroFloor: true,
      read: function (frame) {
        return frame.windKmh;
      },
      secondary: {
        label: "Gusts",
        read: function (frame) {
          return frame.gustKmh;
        },
      },
    },
    {
      key: "rain",
      label: "Rainfall",
      icon: "fa-cloud-showers-heavy",
      unit: "mm/h",
      precision: 1,
      hue: 2,
      defaultStyle: "bars",
      zeroFloor: true,
      read: function (frame) {
        return frame.precipitationMmH;
      },
    },
    {
      key: "humidity",
      label: "Humidity",
      icon: "fa-droplet",
      unit: "%",
      precision: 0,
      hue: 3,
      defaultStyle: "gauge",
      pct: true,
      read: function (frame) {
        return frame.humidityPct;
      },
    },
    {
      key: "pressure",
      label: "Pressure",
      icon: "fa-gauge-high",
      unit: "hPa",
      precision: 0,
      hue: 4,
      defaultStyle: "line",
      visible: false,
      read: function (frame) {
        return frame.pressureHpa;
      },
    },
    {
      key: "cloud",
      label: "Cloud cover",
      icon: "fa-cloud",
      unit: "%",
      precision: 0,
      hue: 5,
      defaultStyle: "bars",
      pct: true,
      visible: false,
      read: function (frame) {
        return frame.cloudCoverPct;
      },
    },
  ];

  function formatClock(iso) {
    var date = iso ? new Date(iso) : new Date();
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString();
  }

  function create(deps) {
    var options = deps || {};
    var doc = options.documentRef || (typeof document === "undefined" ? null : document);
    var win = options.windowRef || (typeof window === "undefined" ? null : window);

    var deck = null;
    var intervalMs = DEFAULT_INTERVAL_MS;
    var intervalListeners = [];
    var started = false;
    // A scrub offset asked for by the URL that the retained history cannot
    // honour yet. Applied as soon as it can be, dropped when the user scrubs.
    var pendingScrub = 0;

    function loadCadence() {
      try {
        var saved = Number(win.localStorage.getItem(CADENCE_KEY));
        if (saved) {
          intervalMs = saved;
        }
      } catch (error) {
        /* storage blocked — stay on the default cadence */
      }
    }

    function saveCadence() {
      try {
        win.localStorage.setItem(CADENCE_KEY, String(intervalMs));
      } catch (error) {
        /* storage blocked — cadence just won't persist */
      }
    }

    function announceCadence() {
      intervalListeners.forEach(function (listener) {
        listener(intervalMs);
      });
    }

    function bindCadenceControl() {
      var select = doc.getElementById("weatherLiveIntervalSelect");
      if (!select) {
        return;
      }
      select.value = String(intervalMs);
      select.addEventListener("change", function () {
        intervalMs = Number(select.value) || DEFAULT_INTERVAL_MS;
        saveCadence();
        announceCadence();
      });
    }

    function bindClearControl() {
      var button = doc.getElementById("weatherLiveChartsClearBtn");
      if (button) {
        button.addEventListener("click", function () {
          if (deck) {
            deck.clear();
          }
        });
      }
    }

    /* ---------------------------------------------------------- query string */

    function queryParams() {
      try {
        return new URLSearchParams(String((win.location && win.location.search) || ""));
      } catch (error) {
        return new URLSearchParams("");
      }
    }

    function applyQuery() {
      var params = queryParams();

      QUERY_CONTROLS.forEach(function (entry) {
        if (params.has(entry.param)) {
          deck.set(entry.key, params.get(entry.param));
        }
      });

      // Scrubbing needs history to scrub over, and on a fresh load there is
      // none — hold the request until enough readings have arrived.
      pendingScrub = Math.max(0, Math.floor(Number(params.get(SCRUB_PARAM))) || 0);
      applyPendingScrub();
      markPendingScrub();
    }

    function applyPendingScrub() {
      if (!pendingScrub || !deck) {
        return;
      }
      if (deck.getWindowState().maxOffset < pendingScrub) {
        return;
      }
      var wanted = pendingScrub;
      pendingScrub = 0;
      deck.setWindowOffset(wanted);
      markPendingScrub();
    }

    function markPendingScrub() {
      var bar = doc.getElementById("weatherLiveScrubBar");
      if (!bar) {
        return;
      }
      if (pendingScrub > 0) {
        bar.setAttribute("data-scrub-pending", String(pendingScrub));
      } else {
        bar.removeAttribute("data-scrub-pending");
      }
    }

    /**
     * Mirror the sliders and the scrub offset into the URL. Only writes when the
     * URL would actually change, so following the live edge leaves the history
     * of the browser — and the address bar — alone.
     */
    function syncQuery() {
      if (!deck || !win.history || typeof win.history.replaceState !== "function") {
        return;
      }

      var url;
      try {
        url = new URL(String(win.location.href));
      } catch (error) {
        return;
      }

      QUERY_CONTROLS.forEach(function (entry) {
        var value = deck.get(entry.key);
        // A slider back on its default belongs nowhere in the URL.
        if (Number(value) === Number(deck.getDefault(entry.key))) {
          url.searchParams.delete(entry.param);
        } else {
          url.searchParams.set(entry.param, String(value));
        }
      });

      // The offset grows while the chart is held and readings keep arriving, so
      // the URL keeps saying how far behind live the chart currently is.
      var offset = pendingScrub || deck.getWindowState().offset;
      if (offset > 0) {
        url.searchParams.set(SCRUB_PARAM, String(offset));
      } else {
        url.searchParams.delete(SCRUB_PARAM);
      }

      if (url.href !== String(win.location.href)) {
        win.history.replaceState({}, "", url.href);
      }
    }

    /* ------------------------------------------------------------------ deck */

    function init() {
      if (started || !win.ChartDeck) {
        return;
      }
      started = true;
      loadCadence();

      deck = win.ChartDeck.create({
        documentRef: doc,
        windowRef: win,
        storageKey: STORAGE_KEY,
        rootId: "weatherLiveCharts",
        emptyId: "weatherLiveChartsEmpty",
        optionsPanelId: "weatherLiveChartOptions",
        optionsToggleId: "weatherLiveChartOptionsBtn",
        resetBtnId: "weatherLiveChartsResetBtn",
        scrubBarId: "weatherLiveScrubBar",
        scrubReadoutId: "weatherLiveScrubReadout",
        followBtnId: "weatherLiveScrubLiveBtn",
        controls: {
          style: "weatherLiveChartStyle",
          palette: "weatherLivePalette",
          columns: "weatherLiveChartColumns",
          height: "weatherLiveChartHeight",
          window: "weatherLiveHistorySize",
          yScale: "weatherLiveYScale",
          smooth: "weatherLiveSmooth",
          points: "weatherLivePoints",
          grid: "weatherLiveGrid",
          fill: "weatherLiveFill",
          axis: "weatherLiveAxis",
          secondary: "weatherLiveSecondary",
          scrub: "weatherLiveScrub",
        },
        defaults: { window: DEFAULT_WINDOW },
        series: SERIES,
        countLabel: "readings",
        noDataText: "Collecting readings… charts appear with the first live frame.",
        xLabel: function (frame) {
          return formatClock(frame.observedAt);
        },
        rowStamp: function (frame) {
          return frame.observedAt;
        },
      });

      deck.init();
      bindCadenceControl();
      bindClearControl();

      deck.onChange(function (key) {
        // Touching the scrub control answers the URL's request for good.
        if (key === "scrub" || key === "reset") {
          pendingScrub = 0;
          markPendingScrub();
        }
        // "Reset options" restores the deck defaults; keep the cadence in step.
        if (key === "reset" && intervalMs !== DEFAULT_INTERVAL_MS) {
          intervalMs = DEFAULT_INTERVAL_MS;
          saveCadence();
          var select = doc.getElementById("weatherLiveIntervalSelect");
          if (select) {
            select.value = String(intervalMs);
          }
          announceCadence();
        }
        syncQuery();
      });

      applyQuery();
      syncQuery();
    }

    function push(frame) {
      if (!deck || !frame || typeof frame !== "object") {
        return;
      }
      deck.appendData(
        {
          observedAt: frame.observedAt || new Date().toISOString(),
          condition: frame.condition || "",
          temperatureC: Number(frame.temperatureC),
          feelsLikeC: Number(frame.feelsLikeC),
          windKmh: Number(frame.windKmh),
          gustKmh: Number(frame.gustKmh),
          precipitationMmH: Number(frame.precipitationMmH),
          humidityPct: Number(frame.humidityPct),
          pressureHpa: Number(frame.pressureHpa),
          cloudCoverPct: Number(frame.cloudCoverPct),
        },
        MAX_HISTORY,
      );
      applyPendingScrub();
      syncQuery();
    }

    return {
      init: init,
      push: push,
      clear: function () {
        if (deck) {
          pendingScrub = 0;
          markPendingScrub();
          deck.clear();
          syncQuery();
        }
      },
      getIntervalMs: function () {
        return intervalMs;
      },
      onIntervalChange: function (listener) {
        if (typeof listener === "function") {
          intervalListeners.push(listener);
        }
      },
      // Published for automation and tests: the window state as the deck sees
      // it, without going through the DOM mirror.
      getWindowState: function () {
        return deck ? deck.getWindowState() : null;
      },
      getPendingScrub: function () {
        return pendingScrub;
      },
      getDeck: function () {
        return deck;
      },
    };
  }

  return {
    create: create,
    SERIES: SERIES,
    QUERY_CONTROLS: QUERY_CONTROLS,
    SCRUB_PARAM: SCRUB_PARAM,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS,
    DEFAULT_WINDOW: DEFAULT_WINDOW,
    MAX_HISTORY: MAX_HISTORY,
  };
});
