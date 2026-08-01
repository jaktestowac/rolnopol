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
 */
(function () {
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

  function escapeHtml(text) {
    return window.ChartKit.escapeHtml(text);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function create(spec) {
    var series = spec.series || [];
    var controls = spec.controls || {};
    var storageKey = spec.storageKey;

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

    function byId(id) {
      return id ? document.getElementById(id) : null;
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
        var raw = window.localStorage.getItem(storageKey);
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
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      } catch (error) {
        /* storage full or blocked — preferences just won't persist */
      }
    }

    function notifyChange(key) {
      changeListeners.forEach(function (listener) {
        listener(key, config[key], config);
      });
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

    function windowedData() {
      var size = Number(config.window) || 0;
      return size > 0 ? data.slice(-size) : data.slice();
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
        '<article class="ck-chart" data-chart="' + item.key + '">' +
        '<header class="ck-chart__head">' +
        '<span class="ck-chart__title"><i class="fas ' + (item.icon || "fa-chart-line") + '" aria-hidden="true"></i> ' + escapeHtml(item.label) + "</span>" +
        '<span class="ck-chart__now" data-chart-now="' + item.key + '">—</span>' +
        '<select class="ck-chart__style form-input" data-chart-style="' + item.key + '" aria-label="' + escapeHtml(item.label) + ' chart style">' +
        styleOptionsMarkup(item, config.styles[item.key] || "auto") +
        "</select>" +
        "</header>" +
        '<div class="ck-chart__plot" data-chart-plot="' + item.key + '">' +
        '<div class="ck-chart__svg-wrap" data-chart-svg="' + item.key + '"></div>' +
        '<div class="ck-chart__cursor" data-chart-cursor="' + item.key + '" hidden></div>' +
        '<div class="ck-chart__tip" data-chart-tip="' + item.key + '" hidden></div>' +
        "</div>" +
        '<footer class="ck-chart__stats" data-chart-stats="' + item.key + '"></footer>' +
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
      var viewX = ((event.clientX - rect.left) / rect.width) * window.ChartKit.DEFAULT_WIDTH;
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
        '<span class="ck-chart__tip-time">' + escapeHtml(labelFor(row, nearest.index)) + "</span>" +
        '<span class="ck-chart__tip-value">' + escapeHtml(valueText(item, item.read(row))) + "</span>";
      if (item.band && config.secondary) {
        lines +=
          '<span class="ck-chart__tip-extra">' + escapeHtml(valueText(item, item.band.min(row)) + " … " + valueText(item, item.band.max(row))) + "</span>";
      }
      if (item.secondary && config.secondary) {
        lines += '<span class="ck-chart__tip-extra">' + escapeHtml(item.secondary.label + " " + valueText(item, item.secondary.read(row))) + "</span>";
      }
      tip.innerHTML = lines;

      var left = (nearest.x / window.ChartKit.DEFAULT_WIDTH) * rect.width;
      cursor.style.left = left + "px";
      cursor.hidden = false;
      tip.style.left = Math.max(4, Math.min(rect.width - 4, left)) + "px";
      tip.hidden = false;
    }

    function valueText(item, value) {
      return window.ChartKit.format(value, item.precision) + " " + (item.unit || "");
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
        "<span><em>min</em> " + escapeHtml(window.ChartKit.format(Math.min.apply(null, lows), item.precision)) + "</span>" +
        "<span><em>avg</em> " + escapeHtml(window.ChartKit.format(sum / finite.length, item.precision)) + "</span>" +
        "<span><em>max</em> " + escapeHtml(window.ChartKit.format(Math.max.apply(null, highs), item.precision)) + "</span>" +
        "<span><em>" + escapeHtml(spec.countLabel || "readings") + "</em> " + finite.length + "</span>"
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
      if (!host) {
        return;
      }

      var list = visibleSeries();
      var rows = windowedData();

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
        var color = window.ChartKit.paletteColor(config.palette, item.hue);
        var values = rows.map(item.read);
        var result = window.ChartKit.render(
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
            width: window.ChartKit.DEFAULT_WIDTH,
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
        var toggle = document.querySelector('[data-series-toggle="' + item.key + '"]');
        if (toggle) {
          toggle.checked = config.visible[item.key] !== false;
        }
      });
      CONTROL_IDS.forEach(function (key) {
        var el = byId(controls[key]);
        if (el) {
          el.value = String(config[key]);
        }
      });
      FLAG_IDS.forEach(function (key) {
        var el = byId(controls[key]);
        if (el) {
          el.checked = config[key] !== false;
        }
      });
    }

    function bindOptions() {
      series.forEach(function (item) {
        var toggle = document.querySelector('[data-series-toggle="' + item.key + '"]');
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
        el.addEventListener("change", function () {
          config[key] = NUMERIC_KEYS[key] ? Number(el.value) : el.value;
          saveConfig();
          layoutSignature = "";
          render();
          notifyChange(key);
        });
      });

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
          saveConfig();
          syncControls();
          layoutSignature = "";
          render();
          notifyChange("reset");
        });
      }
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
        render();
      },
      appendData: function (row, maxRows) {
        data.push(row);
        var cap = maxRows || 240;
        while (data.length > cap) {
          data.shift();
        }
        render();
      },
      clear: function () {
        data = [];
        geometry = {};
        layoutSignature = "";
        render();
      },
      getData: function () {
        return data.slice();
      },
      get: function (key) {
        return config[key];
      },
      onChange: function (listener) {
        if (typeof listener === "function") {
          changeListeners.push(listener);
        }
      },
    };
  }

  window.ChartDeck = { create: create, DEFAULTS: DECK_DEFAULTS };
})();
