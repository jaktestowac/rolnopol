/**
 * Weather Live charts — rolling visualizations of the SSE `conditions` frames.
 *
 * The page (js/pages/weather-live.js) hands every frame to
 * `WeatherLiveCharts.push(frame)`; the shared ChartDeck keeps the history,
 * the user's preferences and the cards. This module only describes the live
 * metrics and owns the one control the deck doesn't know about: the stream
 * cadence, which the page needs in order to re-open the EventSource.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "rolnopol.weatherLive.chartOptions";
  var CADENCE_KEY = "rolnopol.weatherLive.intervalMs";
  var DEFAULT_INTERVAL_MS = 4000;
  var MAX_HISTORY = 240;

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

  var deck = null;
  var intervalMs = DEFAULT_INTERVAL_MS;
  var intervalListeners = [];
  var started = false;

  function formatClock(iso) {
    var date = iso ? new Date(iso) : new Date();
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString();
  }

  function loadCadence() {
    try {
      var saved = Number(window.localStorage.getItem(CADENCE_KEY));
      if (saved) {
        intervalMs = saved;
      }
    } catch (error) {
      /* storage blocked — stay on the default cadence */
    }
  }

  function saveCadence() {
    try {
      window.localStorage.setItem(CADENCE_KEY, String(intervalMs));
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
    var select = document.getElementById("weatherLiveIntervalSelect");
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
    var button = document.getElementById("weatherLiveChartsClearBtn");
    if (button) {
      button.addEventListener("click", function () {
        if (deck) {
          deck.clear();
        }
      });
    }
  }

  function init() {
    if (started || !window.ChartDeck) {
      return;
    }
    started = true;
    loadCadence();

    deck = window.ChartDeck.create({
      storageKey: STORAGE_KEY,
      rootId: "weatherLiveCharts",
      emptyId: "weatherLiveChartsEmpty",
      optionsPanelId: "weatherLiveChartOptions",
      optionsToggleId: "weatherLiveChartOptionsBtn",
      resetBtnId: "weatherLiveChartsResetBtn",
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
      },
      defaults: { window: 30 },
      series: SERIES,
      countLabel: "readings",
      noDataText: "Collecting readings… charts appear with the first live frame.",
      xLabel: function (frame) {
        return formatClock(frame.observedAt);
      },
    });

    deck.init();
    bindCadenceControl();
    bindClearControl();

    // "Reset options" restores the deck defaults; keep the cadence in step.
    deck.onChange(function (key) {
      if (key !== "reset" || intervalMs === DEFAULT_INTERVAL_MS) {
        return;
      }
      intervalMs = DEFAULT_INTERVAL_MS;
      saveCadence();
      var select = document.getElementById("weatherLiveIntervalSelect");
      if (select) {
        select.value = String(intervalMs);
      }
      announceCadence();
    });
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
  }

  window.WeatherLiveCharts = {
    init: init,
    push: push,
    clear: function () {
      if (deck) {
        deck.clear();
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
  };
})();
