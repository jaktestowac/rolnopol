/**
 * Weather forecast charts — the 7-day forecast drawn as a customizable deck
 * of metric cards (shared ChartKit/ChartDeck, same look as the Weather Live
 * page).
 *
 * js/pages/weather.js calls `WeatherCharts.setForecast(daily, forecast)` on
 * every refresh; the selected day is used as a single-point fallback when the
 * requested date sits outside the forecast horizon.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "rolnopol.weather.chartOptions";

  function avgTemp(day) {
    return (Number(day.temperatureMinC) + Number(day.temperatureMaxC)) / 2;
  }

  var SERIES = [
    {
      key: "temp",
      label: "Temperature",
      icon: "fa-temperature-half",
      unit: "°C",
      precision: 1,
      hue: 0,
      defaultStyle: "band",
      read: avgTemp,
      band: {
        min: function (day) {
          return Number(day.temperatureMinC);
        },
        max: function (day) {
          return Number(day.temperatureMaxC);
        },
      },
    },
    {
      key: "rain",
      label: "Precipitation",
      icon: "fa-cloud-showers-heavy",
      unit: "mm",
      precision: 1,
      hue: 2,
      defaultStyle: "bars",
      zeroFloor: true,
      read: function (day) {
        return Number(day.precipitationMm);
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
      read: function (day) {
        return Number(day.windKmh);
      },
    },
    {
      key: "humidity",
      label: "Humidity",
      icon: "fa-droplet",
      unit: "%",
      precision: 0,
      hue: 3,
      defaultStyle: "area",
      pct: true,
      read: function (day) {
        return Number(day.humidityPct);
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
      read: function (day) {
        return Number(day.pressureHpa);
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
      read: function (day) {
        return Number(day.cloudCoverPct);
      },
    },
    {
      key: "soil",
      label: "Soil moisture",
      icon: "fa-seedling",
      unit: "%",
      precision: 0,
      hue: 6,
      defaultStyle: "area",
      pct: true,
      visible: false,
      read: function (day) {
        return Number(day.soilMoisturePct);
      },
    },
    {
      key: "drought",
      label: "Drought index",
      icon: "fa-sun-plant-wilt",
      unit: "idx",
      precision: 0,
      hue: 7,
      defaultStyle: "gauge",
      pct: true,
      visible: false,
      read: function (day) {
        return Number(day.droughtIndex);
      },
    },
  ];

  var deck = null;
  var started = false;

  function dayLabel(day, index) {
    if (index === 0) {
      return "Tomorrow";
    }
    var date = new Date(String(day && day.date) + "T00:00:00Z");
    if (isNaN(date.getTime())) {
      return String((day && day.date) || index + 1);
    }
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }

  function init() {
    if (started || !window.ChartDeck || !document.getElementById("weatherCharts")) {
      return;
    }
    started = true;

    deck = window.ChartDeck.create({
      storageKey: STORAGE_KEY,
      rootId: "weatherCharts",
      emptyId: "weatherChartsEmpty",
      optionsPanelId: "weatherChartOptions",
      optionsToggleId: "weatherChartOptionsBtn",
      resetBtnId: "weatherChartsResetBtn",
      controls: {
        style: "weatherChartStyle",
        palette: "weatherChartPalette",
        columns: "weatherChartColumns",
        height: "weatherChartHeight",
        yScale: "weatherChartYScale",
        smooth: "weatherChartSmooth",
        points: "weatherChartPoints",
        grid: "weatherChartGrid",
        fill: "weatherChartFill",
        axis: "weatherChartAxis",
        secondary: "weatherChartBand",
      },
      defaults: { points: true },
      series: SERIES,
      countLabel: "days",
      noDataText: "No forecast days to chart for the selected date.",
      xLabel: dayLabel,
    });

    deck.init();
  }

  function setForecast(daily, forecast) {
    init();
    if (!deck) {
      return;
    }
    var days = Array.isArray(forecast) && forecast.length > 0 ? forecast : [daily];
    deck.setData(
      days.filter(Boolean).map(function (day) {
        return {
          date: day.date || "",
          condition: day.condition || "",
          temperatureMinC: Number(day.temperatureMinC),
          temperatureMaxC: Number(day.temperatureMaxC),
          precipitationMm: Number(day.precipitationMm),
          humidityPct: Number(day.humidityPct),
          windKmh: Number(day.windKmh),
          pressureHpa: Number(day.pressureHpa),
          cloudCoverPct: Number(day.cloudCoverPct),
          soilMoisturePct: Number(day.soilMoisturePct),
          droughtIndex: Number(day.droughtIndex),
        };
      }),
    );
  }

  window.WeatherCharts = {
    init: init,
    setForecast: setForecast,
    clear: function () {
      if (deck) {
        deck.clear();
      }
    },
  };
})();
