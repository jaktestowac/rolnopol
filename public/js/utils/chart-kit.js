/**
 * ChartKit — hand-rolled inline-SVG chart renderers shared by the weather
 * pages (no charting library; same approach as the weather trend chart).
 *
 * The kit is pure: it turns a `spec` (values + how to read them) plus
 * `options` (look & feel) into an SVG string and the plotted point geometry
 * that callers need for hover tooltips. All DOM handling, persistence and
 * option wiring lives in ChartDeck (js/utils/chart-deck.js).
 *
 *   var result = ChartKit.render(
 *     { key: "temp", unit: "°C", precision: 1, values: [...], style: "area" },
 *     { width: 620, height: 160, color: "#e2683c", smooth: true, grid: true },
 *   );
 *   host.innerHTML = result.svg;   // result.points → [{x, y, value, index}]
 */
(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ChartKit = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  var DEFAULT_WIDTH = 620;
  var DEFAULT_HEIGHT = 160;
  var STYLES = ["area", "line", "bars", "gauge", "band"];

  // Eight-slot palettes; a series picks its colour by `hue` index.
  var PALETTES = {
    meadow: ["#e2683c", "#2e8b8b", "#3b7dd8", "#2e9e5b", "#7a5cc4", "#6a7b5e", "#b07a2e", "#a8442a"],
    sunset: ["#f2544b", "#ef8a17", "#9a6dd7", "#d81e5b", "#c9a227", "#8c7851", "#e0603a", "#7b3f8f"],
    ocean: ["#0fa3b1", "#087e8b", "#1b6ca8", "#06a77d", "#3d5a80", "#5c80a8", "#2a9d8f", "#264653"],
    mono: ["#2f3e2c", "#4a5d48", "#647a63", "#7d947c", "#95a894", "#adbcac", "#586b56", "#3f5240"],
  };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function format(value, precision) {
    if (!isFinite(value)) {
      return "—";
    }
    return Number(value).toFixed(precision || 0);
  }

  function paletteColor(name, hue) {
    var colors = PALETTES[name] || PALETTES.meadow;
    return colors[(hue || 0) % colors.length];
  }

  function finiteOnly(values) {
    return (values || []).filter(function (value) {
      return isFinite(value);
    });
  }

  function plotBox(width, height, axis) {
    var pad = axis ? { l: 42, r: 12, t: 14, b: 20 } : { l: 10, r: 10, t: 12, b: 10 };
    return { x0: pad.l, x1: width - pad.r, y0: pad.t, y1: height - pad.b };
  }

  function computeDomain(spec, options) {
    var all = finiteOnly((spec.values || []).concat(spec.extras || [], (spec.band && spec.band.min) || [], (spec.band && spec.band.max) || []));
    if (all.length === 0) {
      return { min: 0, max: 1 };
    }
    var min = Math.min.apply(null, all);
    var max = Math.max.apply(null, all);

    if (options.yScale === "zero") {
      if (spec.pct) {
        return { min: 0, max: 100 };
      }
      min = Math.min(0, min);
    }

    if (max - min < 1e-6) {
      max = min + (spec.precision === 0 ? 2 : 1);
    }
    var pad = (max - min) * 0.14;
    var lo = min - pad;
    var hi = max + pad;
    if ((spec.zeroFloor || spec.pct) && lo < 0) {
      lo = 0;
    }
    if (spec.pct && hi > 100) {
      hi = 100;
    }
    return { min: lo, max: hi };
  }

  function projectPoints(values, box, domain) {
    var count = values.length;
    var span = domain.max - domain.min || 1;
    var step = count > 1 ? (box.x1 - box.x0) / (count - 1) : 0;
    return values.map(function (value, index) {
      var x = count > 1 ? box.x0 + step * index : (box.x0 + box.x1) / 2;
      var clamped = Math.max(domain.min, Math.min(domain.max, isFinite(value) ? value : domain.min));
      var y = box.y1 - ((clamped - domain.min) / span) * (box.y1 - box.y0);
      return { x: x, y: y, value: value, index: index };
    });
  }

  function linePath(points, smooth) {
    if (points.length === 0) {
      return "";
    }
    if (points.length === 1) {
      return "M" + round(points[0].x) + " " + round(points[0].y);
    }
    if (!smooth) {
      return (
        "M" +
        points
          .map(function (point) {
            return round(point.x) + " " + round(point.y);
          })
          .join("L")
      );
    }
    var d = "M" + round(points[0].x) + " " + round(points[0].y);
    for (var i = 0; i < points.length - 1; i += 1) {
      var p0 = points[i - 1] || points[i];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6;
      var c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6;
      var c2y = p2.y - (p3.y - p1.y) / 6;
      d += "C" + round(c1x) + " " + round(c1y) + "," + round(c2x) + " " + round(c2y) + "," + round(p2.x) + " " + round(p2.y);
    }
    return d;
  }

  function polar(cx, cy, radius, degrees) {
    var radians = ((degrees - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  }

  function arcPath(cx, cy, radius, startDeg, endDeg) {
    var start = polar(cx, cy, radius, startDeg);
    var end = polar(cx, cy, radius, endDeg);
    var large = endDeg - startDeg > 180 ? 1 : 0;
    return "M" + round(start.x) + " " + round(start.y) + "A" + radius + " " + radius + " 0 " + large + " 1 " + round(end.x) + " " + round(end.y);
  }

  function defsMarkup(key, color) {
    return (
      "<defs>" +
      '<linearGradient id="ck-fill-' + key + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.45" />' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02" />' +
      "</linearGradient>" +
      '<linearGradient id="ck-band-' + key + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.42" />' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.12" />' +
      "</linearGradient>" +
      '<linearGradient id="ck-stroke-' + key + '" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.55" />' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="1" />' +
      "</linearGradient>" +
      '<filter id="ck-glow-' + key + '" x="-20%" y="-40%" width="140%" height="180%">' +
      '<feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="' + color + '" flood-opacity="0.35" />' +
      "</filter>" +
      "</defs>"
    );
  }

  function gridMarkup(box, domain, spec, options) {
    if (!options.grid && !options.axis) {
      return "";
    }
    return [0, 0.25, 0.5, 0.75, 1]
      .map(function (ratio) {
        var y = round(box.y1 - (box.y1 - box.y0) * ratio);
        var value = domain.min + (domain.max - domain.min) * ratio;
        var line = options.grid ? '<line class="ck-chart__grid" x1="' + box.x0 + '" y1="' + y + '" x2="' + round(box.x1) + '" y2="' + y + '" />' : "";
        var label =
          options.axis && ratio !== 0.25 && ratio !== 0.75
            ? '<text class="ck-chart__axis" x="' + (box.x0 - 6) + '" y="' + y + '" text-anchor="end" dominant-baseline="middle">' + escapeHtml(format(value, spec.precision)) + "</text>"
            : "";
        return line + label;
      })
      .join("");
  }

  /**
   * Bottom axis: with few points every label is drawn under its own point,
   * otherwise only the first and last (a rolling live stream would collide).
   */
  function xAxisMarkup(spec, points, box, height, options) {
    var labels = spec.xLabels || [];
    if (!options.axis || labels.length === 0) {
      return "";
    }
    var y = height - 5;
    if (labels.length <= 10 && points.length === labels.length) {
      return points
        .map(function (point, index) {
          var anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
          var x = index === 0 ? box.x0 : index === points.length - 1 ? box.x1 : point.x;
          return '<text class="ck-chart__axis" x="' + round(x) + '" y="' + y + '" text-anchor="' + anchor + '">' + escapeHtml(labels[index]) + "</text>";
        })
        .join("");
    }
    return (
      '<text class="ck-chart__axis" x="' + box.x0 + '" y="' + y + '" text-anchor="start">' + escapeHtml(labels[0]) + "</text>" +
      '<text class="ck-chart__axis" x="' + round(box.x1) + '" y="' + y + '" text-anchor="end">' + escapeHtml(labels[labels.length - 1]) + "</text>"
    );
  }

  function markersMarkup(points, key, show) {
    if (!show) {
      return "";
    }
    return points
      .map(function (point) {
        return '<circle class="ck-chart__dot" cx="' + round(point.x) + '" cy="' + round(point.y) + '" r="2.6" fill="url(#ck-stroke-' + key + ')" />';
      })
      .join("");
  }

  function headMarkup(points, key) {
    if (points.length === 0) {
      return "";
    }
    var last = points[points.length - 1];
    return (
      '<circle class="ck-chart__pulse" cx="' + round(last.x) + '" cy="' + round(last.y) + '" r="4.5" fill="url(#ck-stroke-' + key + ')" />' +
      '<circle class="ck-chart__marker" cx="' + round(last.x) + '" cy="' + round(last.y) + '" r="3.2" fill="url(#ck-stroke-' + key + ')" />'
    );
  }

  function svgOpen(width, height, label) {
    return '<svg class="ck-chart__svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + escapeHtml(label) + '">';
  }

  function renderLineLike(spec, options, style) {
    var width = options.width || DEFAULT_WIDTH;
    var height = options.height || DEFAULT_HEIGHT;
    var box = plotBox(width, height, options.axis);
    var domain = computeDomain(spec, options);
    var points = projectPoints(spec.values, box, domain);
    var path = linePath(points, options.smooth);

    var area = "";
    if (style === "area" && options.fill && points.length > 1) {
      area =
        '<path class="ck-chart__area" d="' +
        path +
        "L" + round(points[points.length - 1].x) + " " + round(box.y1) +
        "L" + round(points[0].x) + " " + round(box.y1) +
        'Z" fill="url(#ck-fill-' + spec.key + ')" />';
    }

    var ghost = "";
    if (spec.extras && spec.extras.length === spec.values.length) {
      var extraPoints = projectPoints(spec.extras, box, domain);
      ghost = '<path class="ck-chart__line ck-chart__line--ghost" d="' + linePath(extraPoints, options.smooth) + '" stroke="' + options.color + '" />';
    }

    var svg =
      svgOpen(width, height, (spec.label || spec.key) + " over time") +
      defsMarkup(spec.key, options.color) +
      gridMarkup(box, domain, spec, options) +
      area +
      ghost +
      '<path class="ck-chart__line" d="' + path + '" stroke="url(#ck-stroke-' + spec.key + ')" filter="url(#ck-glow-' + spec.key + ')" />' +
      markersMarkup(points, spec.key, options.points) +
      headMarkup(points, spec.key) +
      xAxisMarkup(spec, points, box, height, options) +
      "</svg>";

    return { svg: svg, points: points };
  }

  /** Min/max envelope with the average line on top — used for day forecasts. */
  function renderBand(spec, options) {
    if (!spec.band || !spec.band.min || !spec.band.max) {
      return renderLineLike(spec, options, "area");
    }
    var width = options.width || DEFAULT_WIDTH;
    var height = options.height || DEFAULT_HEIGHT;
    var box = plotBox(width, height, options.axis);
    var domain = computeDomain(spec, options);
    var lowPoints = projectPoints(spec.band.min, box, domain);
    var highPoints = projectPoints(spec.band.max, box, domain);
    var midPoints = projectPoints(spec.values, box, domain);

    // Close the envelope by walking the max line forward and the min line back;
    // the reversed sub-path starts with "M", which becomes a "L" join.
    var reversedLow = linePath(lowPoints.slice().reverse(), options.smooth);
    var bandPath = linePath(highPoints, options.smooth) + "L" + reversedLow.slice(1) + "Z";

    var svg =
      svgOpen(width, height, (spec.label || spec.key) + " range") +
      defsMarkup(spec.key, options.color) +
      gridMarkup(box, domain, spec, options) +
      (options.fill ? '<path class="ck-chart__band" d="' + bandPath + '" fill="url(#ck-band-' + spec.key + ')" />' : "") +
      '<path class="ck-chart__line ck-chart__line--edge" d="' + linePath(highPoints, options.smooth) + '" stroke="' + options.color + '" />' +
      '<path class="ck-chart__line ck-chart__line--edge" d="' + linePath(lowPoints, options.smooth) + '" stroke="' + options.color + '" />' +
      '<path class="ck-chart__line" d="' + linePath(midPoints, options.smooth) + '" stroke="url(#ck-stroke-' + spec.key + ')" filter="url(#ck-glow-' + spec.key + ')" />' +
      markersMarkup(midPoints, spec.key, options.points) +
      headMarkup(midPoints, spec.key) +
      xAxisMarkup(spec, midPoints, box, height, options) +
      "</svg>";

    return { svg: svg, points: midPoints };
  }

  function renderBars(spec, options) {
    var width = options.width || DEFAULT_WIDTH;
    var height = options.height || DEFAULT_HEIGHT;
    var box = plotBox(width, height, options.axis);
    var domain = computeDomain(spec, options);
    if (domain.min > 0 && (spec.zeroFloor || spec.pct)) {
      domain.min = 0;
    }
    var slot = spec.values.length > 1 ? (box.x1 - box.x0) / (spec.values.length - 1) : box.x1 - box.x0;
    var barWidth = Math.max(2, Math.min(30, slot * 0.62));
    // Inset the plot so the first and last bars sit inside the axis, not
    // straddling it.
    var barBox = { x0: box.x0 + barWidth / 2, x1: box.x1 - barWidth / 2, y0: box.y0, y1: box.y1 };
    var points = projectPoints(spec.values, barBox, domain);

    var bars = points
      .map(function (point) {
        var barHeight = Math.max(1, round(box.y1 - point.y));
        return (
          '<rect class="ck-chart__bar" x="' + round(point.x - barWidth / 2) + '" y="' + round(point.y) + '" width="' + round(barWidth) + '" height="' + barHeight +
          '" rx="' + round(Math.min(3, barWidth / 2)) + '" fill="url(#ck-fill-' + spec.key + ')" stroke="' + options.color + '" />'
        );
      })
      .join("");

    var svg =
      svgOpen(width, height, (spec.label || spec.key) + " per reading") +
      defsMarkup(spec.key, options.color) +
      gridMarkup(box, domain, spec, options) +
      bars +
      xAxisMarkup(spec, points, box, height, options) +
      "</svg>";

    return { svg: svg, points: points };
  }

  function renderGauge(spec, options) {
    var width = options.width || DEFAULT_WIDTH;
    var height = Math.max(150, options.height || DEFAULT_HEIGHT);
    var values = spec.values || [];
    var domain = spec.pct ? { min: 0, max: 100 } : computeDomain(spec, options);
    var current = values.length ? values[values.length - 1] : NaN;
    var span = domain.max - domain.min || 1;
    var fraction = Math.max(0, Math.min(1, (current - domain.min) / span));

    var cx = width / 2;
    var cy = height * 0.47;
    var radius = Math.min(height * 0.32, width * 0.11);
    var startDeg = -135;
    var endDeg = startDeg + 270 * (isFinite(fraction) ? fraction : 0);

    // A dim sparkline of the same window sits in the arc's bottom gap so the
    // gauge still shows where the reading is heading.
    var sparkline = "";
    if (values.length > 1) {
      var box = { x0: width * 0.33, x1: width * 0.67, y0: height - 22, y1: height - 6 };
      var sparkPoints = projectPoints(values, box, computeDomain(spec, options));
      sparkline = '<path class="ck-chart__spark" d="' + linePath(sparkPoints, options.smooth) + '" stroke="' + options.color + '" />';
    }

    var svg =
      svgOpen(width, height, (spec.label || spec.key) + " gauge") +
      defsMarkup(spec.key, options.color) +
      '<path class="ck-gauge__track" d="' + arcPath(cx, cy, radius, -135, 135) + '" />' +
      (isFinite(fraction) && endDeg > startDeg
        ? '<path class="ck-gauge__value" d="' + arcPath(cx, cy, radius, startDeg, endDeg) + '" stroke="url(#ck-stroke-' + spec.key + ')" filter="url(#ck-glow-' + spec.key + ')" />'
        : "") +
      '<text class="ck-gauge__reading" x="' + cx + '" y="' + round(cy + 2) + '" text-anchor="middle" dominant-baseline="middle" fill="' + options.color + '">' +
      escapeHtml(format(current, spec.precision)) +
      "</text>" +
      '<text class="ck-gauge__unit" x="' + cx + '" y="' + round(cy + 22) + '" text-anchor="middle">' + escapeHtml(spec.unit || "") + "</text>" +
      '<text class="ck-chart__axis" x="' + round(cx - radius - 4) + '" y="' + round(cy + radius * 0.78) + '" text-anchor="middle">' + escapeHtml(format(domain.min, spec.precision)) + "</text>" +
      '<text class="ck-chart__axis" x="' + round(cx + radius + 4) + '" y="' + round(cy + radius * 0.78) + '" text-anchor="middle">' + escapeHtml(format(domain.max, spec.precision)) + "</text>" +
      sparkline +
      "</svg>";

    return { svg: svg, points: null };
  }

  function render(spec, options) {
    var opts = options || {};
    var style = STYLES.indexOf(spec.style) === -1 ? "line" : spec.style;
    if (style === "gauge") {
      return renderGauge(spec, opts);
    }
    if (style === "bars") {
      return renderBars(spec, opts);
    }
    if (style === "band") {
      return renderBand(spec, opts);
    }
    return renderLineLike(spec, opts, style);
  }

  return {
    PALETTES: PALETTES,
    STYLES: STYLES,
    DEFAULT_WIDTH: DEFAULT_WIDTH,
    render: render,
    paletteColor: paletteColor,
    escapeHtml: escapeHtml,
    format: format,
    round: round,
  };
});
