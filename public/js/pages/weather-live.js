/**
 * Weather Live page — subscribes to the server's Server-Sent Events (SSE) stream
 * of current conditions and severe-weather alerts.
 *
 * The stream endpoint (GET /api/v1/weather/live/stream) is public and gated by
 * the `weatherLiveStreamEnabled` feature flag, so this page works for anonymous
 * visitors. The browser's native EventSource handles auto-reconnect for us; we
 * just (re)open it on region change / reconnect and render the frames.
 *
 * The stream state (connecting / live / paused / error) is published as
 * `data-stream-state` on the toolbar, because "is it still arriving?" is the
 * question every assertion about this page starts with. It is deliberately
 * independent of where the charts are scrubbed to: pausing stops readings,
 * scrubbing only moves the window over the readings already collected.
 */
(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.WeatherLivePage = api;

  if (typeof document !== "undefined") {
    var page = api.create({});
    // Published so the stream can be interrogated as an object, not only
    // through the DOM.
    if (typeof window !== "undefined") {
      window.weatherLivePage = page;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        page.init();
      });
    } else {
      page.init();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  var STREAM_PATH = "/api/v1/weather/live/stream";
  var MAX_LOG_ENTRIES = 12;
  var MAX_ALERTS = 20;
  var DEFAULT_INTERVAL_MS = 4000;
  var DEFAULT_REGION = "PL-14";

  function create(deps) {
    var options = deps || {};
    var doc = options.documentRef || (typeof document === "undefined" ? null : document);
    var win = options.windowRef || (typeof window === "undefined" ? null : window);

    var source = null;
    var paused = false;
    var streamState = "connecting";
    var activeAlertKeys = {};

    function $(id) {
      return doc ? doc.getElementById(id) : null;
    }

    // The charts module (js/pages/weather-live-charts.js) owns the rolling
    // history, the scrub window and the user's chart preferences, including the
    // stream cadence.
    function charts() {
      return win.WeatherLiveCharts || null;
    }

    function setConnection(state, label) {
      var dot = $("weatherLiveConnDot");
      var text = $("weatherLiveConnLabel");
      var toolbar = $("weatherLiveToolbar");
      streamState = state === "idle" && paused ? "paused" : state;
      if (dot) {
        dot.className = "weather-live-dot weather-live-dot--" + state;
      }
      if (text) {
        text.textContent = label;
      }
      if (toolbar) {
        toolbar.setAttribute("data-stream-state", streamState);
      }
    }

    function setStatus(message) {
      var el = $("weatherLiveStatus");
      if (el) {
        el.textContent = message;
      }
    }

    function formatTime(iso) {
      var date = iso ? new Date(iso) : new Date();
      if (isNaN(date.getTime())) {
        return "";
      }
      return date.toLocaleTimeString();
    }

    function appendLog(kind, text, iso) {
      var list = $("weatherLiveEventLog");
      if (!list) {
        return;
      }
      var li = doc.createElement("li");
      li.className = "weather-live-eventlog__item weather-live-eventlog__item--" + kind;
      var time = doc.createElement("span");
      time.className = "weather-live-eventlog__time";
      time.textContent = formatTime(iso);
      var body = doc.createElement("span");
      body.className = "weather-live-eventlog__text";
      body.textContent = text;
      li.appendChild(time);
      li.appendChild(body);
      list.insertBefore(li, list.firstChild);
      while (list.children.length > MAX_LOG_ENTRIES) {
        list.removeChild(list.lastChild);
      }
    }

    function metric(label, value) {
      return (
        '<div class="weather-live-metric"><span class="weather-live-metric__label">' +
        label +
        '</span><span class="weather-live-metric__value">' +
        value +
        "</span></div>"
      );
    }

    function renderConditions(data) {
      var conditionEl = $("weatherLiveCondition");
      var tempEl = $("weatherLiveTemp");
      var metaEl = $("weatherLiveMeta");
      var metricsEl = $("weatherLiveMetrics");
      var baseEl = $("weatherLiveBase");

      if (conditionEl) {
        conditionEl.textContent = data.condition || "—";
      }
      if (tempEl) {
        tempEl.textContent = Math.round(data.temperatureC) + "°C";
      }
      if (metaEl) {
        metaEl.textContent = "Region " + data.region + " · feels like " + data.feelsLikeC + "°C · updated " + formatTime(data.observedAt);
      }
      if (metricsEl) {
        metricsEl.innerHTML =
          metric("Wind", data.windKmh + " km/h") +
          metric("Gusts", data.gustKmh + " km/h") +
          metric("Rain", data.precipitationMmH + " mm/h") +
          metric("Humidity", data.humidityPct + "%") +
          metric("Pressure", data.pressureHpa + " hPa") +
          metric("Cloud", data.cloudCoverPct + "%");
      }
      if (baseEl && data.base) {
        baseEl.textContent =
          "Today (" +
          data.date +
          "): " +
          data.base.condition +
          ", " +
          data.base.temperatureMinC +
          "° / " +
          data.base.temperatureMaxC +
          "° — " +
          (data.base.advisory || "");
      }
    }

    function renderAlert(alert) {
      var emptyEl = $("weatherLiveAlertsEmpty");
      var list = $("weatherLiveAlerts");
      if (!list) {
        return;
      }
      if (activeAlertKeys[alert.key]) {
        return;
      }
      activeAlertKeys[alert.key] = true;

      if (emptyEl) {
        emptyEl.style.display = "none";
      }

      var li = doc.createElement("li");
      li.className = "weather-live-alert weather-live-alert--" + (alert.severity || "warning");
      li.setAttribute("data-alert-key", alert.key);

      var head = doc.createElement("div");
      head.className = "weather-live-alert__head";
      var badge = doc.createElement("span");
      badge.className = "weather-live-alert__severity";
      badge.textContent = (alert.severity || "warning").toUpperCase();
      var title = doc.createElement("span");
      title.className = "weather-live-alert__title";
      title.textContent = alert.title || "Weather alert";
      head.appendChild(badge);
      head.appendChild(title);

      var msg = doc.createElement("p");
      msg.className = "weather-live-alert__message";
      msg.textContent = alert.message || "";

      var time = doc.createElement("span");
      time.className = "weather-live-alert__time";
      time.textContent = formatTime(alert.ts);

      li.appendChild(head);
      li.appendChild(msg);
      li.appendChild(time);
      list.insertBefore(li, list.firstChild);

      while (list.children.length > MAX_ALERTS) {
        list.removeChild(list.lastChild);
      }
    }

    function closeStream() {
      if (source) {
        source.close();
        source = null;
      }
    }

    function currentRegion() {
      var select = $("weatherLiveRegionSelect");
      return select && select.value ? select.value : DEFAULT_REGION;
    }

    function openStream() {
      if (paused) {
        return;
      }
      closeStream();
      activeAlertKeys = {};
      var list = $("weatherLiveAlerts");
      var emptyEl = $("weatherLiveAlertsEmpty");
      if (list) {
        list.innerHTML = "";
      }
      if (emptyEl) {
        emptyEl.style.display = "";
      }

      var region = encodeURIComponent(currentRegion());
      var intervalMs = charts() ? charts().getIntervalMs() : DEFAULT_INTERVAL_MS;
      var url = STREAM_PATH + "?region=" + region + "&intervalMs=" + intervalMs;

      setConnection("connecting", "Connecting…");
      setStatus("Opening live weather stream for " + currentRegion() + "…");

      try {
        source = new win.EventSource(url);
      } catch (error) {
        setConnection("error", "Unavailable");
        setStatus("Live weather stream is unavailable in this browser.");
        return;
      }

      source.addEventListener("open", function () {
        setConnection("live", "Live");
        setStatus("Live stream connected. Updates arrive automatically.");
      });

      source.addEventListener("conditions", function (event) {
        try {
          var data = JSON.parse(event.data);
          renderConditions(data);
          if (charts()) {
            charts().push(data);
          }
          appendLog(
            "conditions",
            data.condition + " · " + Math.round(data.temperatureC) + "°C, wind " + data.windKmh + " km/h",
            data.observedAt,
          );
        } catch (error) {
          /* ignore malformed frame */
        }
      });

      source.addEventListener("alert", function (event) {
        try {
          var alert = JSON.parse(event.data);
          renderAlert(alert);
          appendLog("alert", "ALERT: " + (alert.title || alert.key), alert.ts);
        } catch (error) {
          /* ignore malformed frame */
        }
      });

      source.addEventListener("error", function () {
        // EventSource auto-reconnects unless the endpoint is gone (e.g. flag off).
        if (source && source.readyState === 2) {
          setConnection("error", "Disconnected");
          setStatus("Live stream closed. Use Reconnect to try again.");
        } else {
          setConnection("connecting", "Reconnecting…");
          setStatus("Connection interrupted — reconnecting automatically…");
        }
      });
    }

    function setPauseButton(isPaused) {
      var btn = $("weatherLivePauseBtn");
      if (!btn) {
        return;
      }
      btn.innerHTML = isPaused ? '<i class="fas fa-play"></i>&nbsp; Resume' : '<i class="fas fa-pause"></i>&nbsp; Pause';
      btn.setAttribute("aria-pressed", isPaused ? "true" : "false");
    }

    /**
     * Pausing stops readings arriving; it says nothing about where the charts are
     * scrubbed to, and resuming does not drag the window back to the live edge.
     * That is the "Jump to live" button's job.
     */
    function togglePause() {
      paused = !paused;
      setPauseButton(paused);
      if (paused) {
        closeStream();
        setConnection("idle", "Paused");
        setStatus("Live stream paused. The charts keep the readings already collected.");
      } else {
        openStream();
      }
    }

    function init() {
      var reconnectBtn = $("weatherLiveReconnectBtn");
      var pauseBtn = $("weatherLivePauseBtn");
      var regionSelect = $("weatherLiveRegionSelect");

      if (reconnectBtn) {
        reconnectBtn.addEventListener("click", function () {
          paused = false;
          setPauseButton(false);
          openStream();
        });
      }
      if (pauseBtn) {
        pauseBtn.addEventListener("click", togglePause);
      }
      if (regionSelect) {
        regionSelect.addEventListener("change", function () {
          // A different region is a different data series — start the charts over.
          if (charts()) {
            charts().clear();
          }
          openStream();
        });
      }

      if (charts()) {
        charts().init();
        // Changing the cadence means re-opening the stream with a new intervalMs.
        charts().onIntervalChange(function () {
          if (!paused) {
            openStream();
          }
        });
      }

      if (win && typeof win.addEventListener === "function") {
        win.addEventListener("beforeunload", closeStream);
      }

      openStream();
    }

    return {
      init: init,
      togglePause: togglePause,
      openStream: openStream,
      closeStream: closeStream,
      isPaused: function () {
        return paused;
      },
      getStreamState: function () {
        return streamState;
      },
      getSource: function () {
        return source;
      },
    };
  }

  return {
    create: create,
    STREAM_PATH: STREAM_PATH,
    MAX_LOG_ENTRIES: MAX_LOG_ENTRIES,
    MAX_ALERTS: MAX_ALERTS,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS,
    DEFAULT_REGION: DEFAULT_REGION,
  };
});
