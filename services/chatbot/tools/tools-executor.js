const { logInfo, logWarning, logTrace } = require("../../../helpers/logger-api");
const docsService = require("../../docs.service");

/**
 * Tools Executor
 * Executes function calls made by the LLM and returns results
 */
class ToolsExecutor {
  constructor(userId, context) {
    this.userId = userId;
    this.context = context;
  }

  /**
   * Execute a tool call and return the result
   */
  async execute(toolName, toolArgs) {
    logInfo(`Executing tool: ${toolName} with args:`, toolArgs);
    logTrace(`[TOOL DISPATCH] Dispatching to handler for tool: ${toolName}`, {
      toolName,
      argumentKeys: Object.keys(toolArgs || {}),
      argumentCount: Object.keys(toolArgs || {}).length,
      userId: this.userId,
    });

    let result;
    switch (toolName) {
      case "get_weather_forecast":
        result = this._getWeatherForecast(toolArgs);
        break;

      case "get_recent_alerts":
        result = this._getRecentAlerts(toolArgs);
        break;

      case "get_marketplace_summary":
        result = this._getMarketplaceSummary(toolArgs);
        break;

      case "get_commodity_prices":
        result = this._getCommodityPrices(toolArgs);
        break;

      case "get_staff_workload":
        result = this._getStaffWorkload(toolArgs);
        break;

      case "get_documentation_answer":
        result = await this._getDocumentationAnswer(toolArgs);
        break;

      default:
        logWarning(`Unknown tool requested: ${toolName}`);
        result = { error: `Tool '${toolName}' is not available` };
    }

    // Log result summary
    logTrace(`[TOOL RESULT SUMMARY] Tool execution completed: ${toolName}`, {
      toolName,
      hasError: result?.error ? true : false,
      errorMessage: result?.error,
      resultKeys: result && typeof result === "object" ? Object.keys(result) : [],
    });

    return result;
  }

  /**
   * Get documentation answer from docs service
   */
  async _getDocumentationAnswer(args) {
    const { query = "", max_results = 3 } = args || {};

    if (!query || typeof query !== "string" || !query.trim()) {
      return { error: "query is required for get_documentation_answer" };
    }

    try {
      const docsResult = await docsService.search(query.trim(), Number(max_results) || 3);
      return {
        query: docsResult.query,
        totalMatches: docsResult.totalMatches,
        answer: docsResult.answer,
        matches: docsResult.matches,
      };
    } catch (error) {
      return { error: `Docs query failed: ${error.message || String(error)}` };
    }
  }

  /**
   * Get weather forecast for a specific region
   */
  _getWeatherForecast(args) {
    const { region = "all" } = args;

    // Extract weather data from context
    const weather = this.context?.samples?.weather;
    if (!weather) {
      return { error: "No weather data available" };
    }

    if (region.toLowerCase() === "all") {
      // Return summary for all regions
      return {
        regions: weather.map((w) => ({
          name: w.regionName,
          temperature: w.temperature,
          humidity: w.humidity,
          precipitation: w.precipitation,
          windSpeed: w.windSpeed,
          condition: w.condition,
          eto: w.eto,
        })),
        timestamp: new Date().toISOString(),
      };
    }

    // Find specific region (case-insensitive)
    const weatherData = weather.find((w) => w.regionName.toLowerCase().includes(region.toLowerCase()));

    if (!weatherData) {
      return {
        error: `Region '${region}' not found. Available regions: ${weather.map((w) => w.regionName).join(", ")}`,
      };
    }

    return {
      region: weatherData.regionName,
      temperature: weatherData.temperature,
      humidity: weatherData.humidity,
      precipitation: weatherData.precipitation,
      windSpeed: weatherData.windSpeed,
      condition: weatherData.condition,
      eto: weatherData.eto,
      recommendation:
        weatherData.precipitation > 5
          ? "Irrigation may not be needed due to recent rainfall."
          : weatherData.temperature > 25
            ? "Consider irrigation due to high temperature and low precipitation."
            : "Monitor soil moisture levels.",
    };
  }

  /**
   * Get recent farm alerts
   */
  _getRecentAlerts(args) {
    const { limit = 5, severity } = args;

    const alerts = this.context?.samples?.alerts || [];
    let filtered = alerts.slice(0, Math.min(limit, 20));

    if (severity) {
      filtered = filtered.filter((a) => a.severity === severity);
    }

    return {
      total: filtered.length,
      alerts: filtered.map((alert) => ({
        type: alert.type,
        message: alert.message,
        severity: alert.severity,
        timestamp: alert.timestamp,
      })),
    };
  }

  /**
   * Get marketplace summary
   */
  _getMarketplaceSummary(args) {
    const { resource_type = "all", limit = 5 } = args;

    const marketplace = this.context?.samples?.marketplace || {};
    const result = {};

    if (resource_type === "fields" || resource_type === "all") {
      result.fields = {
        available: marketplace.fieldListings?.slice(0, limit) || [],
        count: marketplace.fieldListings?.length || 0,
        avgPrice: marketplace.avgFieldPrice || 0,
      };
    }

    if (resource_type === "animals" || resource_type === "all") {
      result.animals = {
        available: marketplace.animalListings?.slice(0, limit) || [],
        count: marketplace.animalListings?.length || 0,
      };
    }

    return result;
  }

  /**
   * Get commodity prices and trends
   */
  _getCommodityPrices(args) {
    const { commodity = "all", include_history = true } = args;

    const commodities = this.context?.samples?.commodities || [];

    if (commodity === "all" || !commodity) {
      return {
        commodities: commodities.map((c) => ({
          name: c.name,
          currentPrice: c.currentPrice,
          unit: c.unit,
          trend:
            c.priceHistory && c.priceHistory.length > 1 ? (c.currentPrice > c.priceHistory[c.priceHistory.length - 2] ? "↑" : "↓") : "→",
          priceHistory: include_history ? c.priceHistory?.slice(-5) : undefined,
        })),
        timestamp: new Date().toISOString(),
      };
    }

    // Find specific commodity
    const commodityData = commodities.find((c) => c.name.toLowerCase().includes(commodity.toLowerCase()));

    if (!commodityData) {
      return {
        error: `Commodity '${commodity}' not found. Available: ${commodities.map((c) => c.name).join(", ")}`,
      };
    }

    return {
      name: commodityData.name,
      currentPrice: commodityData.currentPrice,
      unit: commodityData.unit,
      priceHistory: include_history ? commodityData.priceHistory : undefined,
      trend:
        commodityData.priceHistory && commodityData.priceHistory.length > 1
          ? commodityData.currentPrice > commodityData.priceHistory[commodityData.priceHistory.length - 2]
            ? "Price is increasing"
            : "Price is decreasing"
          : "No trend data",
    };
  }

  /**
   * Get staff workload and assignments
   */
  _getStaffWorkload(args) {
    const { include_assignments = true } = args;

    const staff = this.context?.samples?.staff || [];

    return {
      total_staff: staff.length,
      staff: staff.map((member) => ({
        name: `${member.name} ${member.surname || ""}`.trim(),
        position: member.position,
        assignments: include_assignments
          ? this.context?.samples?.assignments?.filter((a) => a.assignedTo === member.id).map((a) => ({ task: a.task, status: a.status }))
          : undefined,
      })),
    };
  }
}

module.exports = ToolsExecutor;
