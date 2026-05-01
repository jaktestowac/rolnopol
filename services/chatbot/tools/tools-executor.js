const { logWarning } = require("../../../helpers/logger-api");
const { logInfo, logTrace } = require("../logger-proxy");
const chatbotContextService = require("../chatbot-context.service");
const docsService = require("../../docs.service");

/**
 * Tools Executor
 * Executes function calls made by the LLM and returns results
 */
class ToolsExecutor {
  constructor(userId, context, { contextService = chatbotContextService } = {}) {
    this.userId = userId;
    this.context = context;
    this.contextService = contextService;
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
      case "get_user_farm_context":
        result = await this._getUserFarmContext(toolArgs);
        break;

      case "get_weather_forecast":
        result = this._getWeatherForecast(toolArgs);
        break;

      case "get_weather_all_regions":
        result = this._getAllWeatherData(toolArgs);
        break;

      case "get_farmlog_blogs":
        result = await this._getFarmlogBlogs(toolArgs);
        break;

      case "get_farmlog_posts":
        result = await this._getFarmlogPosts(toolArgs);
        break;

      case "get_weather_regions":
        result = this._getWeatherRegions(toolArgs);
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
   * Get the user's farm context from the shared context service.
   */
  async _getUserFarmContext(args) {
    const includeSummary = args?.include_summary !== false;
    const includeSamples = args?.include_samples === true;

    if (!includeSummary && !includeSamples) {
      return {
        error: "At least one of include_summary or include_samples must be true",
      };
    }

    try {
      return await this.contextService.getContextForUser(this.userId, {
        includeSummary,
        includeSamples,
      });
    } catch (error) {
      return {
        error: `User farm context lookup failed: ${error.message || String(error)}`,
      };
    }
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
    const { region = "all" } = args || {};

    // Prefer weather samples from context when available
    const weatherSamples = this.context?.samples?.weather;

    // Helper: normalize region input
    const regionInput = String(region || "all").trim();

    // If context contains weather samples, use them (legacy behaviour)
    if (Array.isArray(weatherSamples) && weatherSamples.length > 0) {
      if (regionInput.toLowerCase() === "all") {
        return {
          regions: weatherSamples.map((w) => ({
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

      const weatherData = weatherSamples.find((w) => (w.regionName || "").toLowerCase().includes(regionInput.toLowerCase()));
      if (!weatherData) {
        return {
          error: `Region '${regionInput}' not found. Available regions: ${weatherSamples.map((w) => w.regionName).join(", ")}`,
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

    // If no weather samples in context, fetch from WeatherService directly so tools work standalone
    try {
      const WeatherServiceFactory = require("../../weather.service");
      const weatherService = WeatherServiceFactory();

      // If user asked for all regions, provide a compact summary per region
      if (regionInput.toLowerCase() === "all") {
        const regions = weatherService.getSupportedRegions().map((r) => {
          const day = weatherService.getDaily(new Date().toISOString().slice(0, 10), { region: r.code });
          return {
            code: r.code,
            name: r.name,
            temperatureMinC: day.temperatureMinC,
            temperatureMaxC: day.temperatureMaxC,
            precipitationMm: day.precipitationMm,
            humidityPct: day.humidityPct,
            windKmh: day.windKmh,
            condition: day.condition,
          };
        });

        return { regions, timestamp: new Date().toISOString() };
      }

      // Normalize region using weather service helper (accepts names or codes)
      const regionCode = weatherService.normalizeRegion(regionInput);
      const todayStr = new Date().toISOString().slice(0, 10);
      const today = weatherService.getDaily(todayStr, { region: regionCode });

      // Build a friendly recommendation using advisory and simple heuristics
      const recommendation =
        today.precipitationMm >= 5
          ? "Irrigation may not be needed due to recent rainfall."
          : today.temperatureMaxC > 25
            ? "Consider irrigation due to high temperature and low precipitation."
            : "Monitor soil moisture levels.";

      return {
        region: regionCode,
        name: (weatherService.getSupportedRegions().find((r) => r.code === regionCode) || {}).name || regionCode,
        temperatureMinC: today.temperatureMinC,
        temperatureMaxC: today.temperatureMaxC,
        precipitationMm: today.precipitationMm,
        humidityPct: today.humidityPct,
        windKmh: today.windKmh,
        condition: today.condition,
        advisory: today.advisory,
        recommendation,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { error: `Weather lookup failed: ${err.message || String(err)}` };
    }
  }

  /**
   * Return list of supported weather regions (code + name)
   */
  _getWeatherRegions() {
    try {
      const WeatherServiceFactory = require("../../weather.service");
      const weatherService = WeatherServiceFactory();
      const regions = weatherService.getSupportedRegions().map((r) => ({ code: r.code, name: r.name }));
      return { regions, timestamp: new Date().toISOString() };
    } catch (err) {
      return { error: `Weather regions lookup failed: ${err.message || String(err)}` };
    }
  }

  /**
   * Return detailed weather (today + forecast) for all supported regions
   */
  _getAllWeatherData(args) {
    const { base_date, days } = args || {};

    try {
      const WeatherServiceFactory = require("../../weather.service");
      const weatherService = WeatherServiceFactory();

      // Determine baseDate: default to tomorrow
      const now = new Date();
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const baseDateStr =
        typeof base_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(base_date) ? base_date : tomorrow.toISOString().slice(0, 10);

      // Days: clamp to 1..7
      const daysNum = Number.isFinite(Number(days)) ? Math.max(1, Math.min(7, Number(days))) : 3;

      const regions = weatherService.getSupportedRegions();

      const payload = regions.map((r) => {
        // Today's data
        const todayStr = new Date().toISOString().slice(0, 10);
        const today = weatherService.getDaily(todayStr, { region: r.code });

        // Forecast starting from baseDateStr
        const forecastObj = weatherService.getForecast({ baseDate: baseDateStr, days: daysNum, region: r.code });

        return {
          code: r.code,
          name: r.name,
          today,
          forecast: forecastObj.forecast || [],
          constraints: forecastObj.constraints || null,
        };
      });

      return { regions: payload, baseDate: baseDateStr, days: daysNum, timestamp: new Date().toISOString() };
    } catch (err) {
      return { error: `Weather all-region lookup failed: ${err.message || String(err)}` };
    }
  }

  /**
   * Retrieve public Farmlog blogs (list/search)
   */
  async _getFarmlogBlogs(args) {
    const { search, limit, offset, include_engagement } = args || {};

    try {
      const blogService = require("../../blog.service");

      const opts = {
        search,
        currentUserId: this.userId,
        limit: Number.isFinite(Number(limit)) ? Number(limit) : undefined,
        offset: Number.isFinite(Number(offset)) ? Number(offset) : undefined,
        includeEngagement: include_engagement === true,
      };

      // Use searchBlogs when a search term is provided, otherwise listBlogs
      const blogs = search
        ? await blogService.searchBlogs({
            search,
            currentUserId: this.userId,
            limit: opts.limit,
            offset: opts.offset,
            includeEngagement: opts.includeEngagement,
          })
        : await blogService.listBlogs({
            search: undefined,
            currentUserId: this.userId,
            limit: opts.limit,
            offset: opts.offset,
            includeEngagement: opts.includeEngagement,
          });

      // Add convenient URL for frontend to open the blog directly
      const blogsWithUrl = Array.isArray(blogs)
        ? blogs.map((b) => ({
            ...b,
            url: b && b.slug ? `/farmlog-blog.html?blog=${encodeURIComponent(b.slug)}` : undefined,
          }))
        : blogs;

      return { blogs: blogsWithUrl, timestamp: new Date().toISOString() };
    } catch (err) {
      return { error: `Farmlog blogs lookup failed: ${err.message || String(err)}` };
    }
  }

  /**
   * Retrieve public Farmlog posts (either for a blog slug or global search)
   */
  async _getFarmlogPosts(args) {
    const { blog_slug, search, limit, offset, sort, period, include_engagement } = args || {};

    try {
      const postService = require("../../post.service");

      const opts = {
        search: typeof search === "string" && search.trim().length > 0 ? search.trim() : undefined,
        limit: Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined,
        offset: Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : undefined,
        sort: typeof sort === "string" ? sort : undefined,
        period: typeof period === "string" ? period : undefined,
        includeEngagement: include_engagement === true,
      };

      let posts;
      if (typeof blog_slug === "string" && blog_slug.trim().length > 0) {
        // list posts for a specific blog
        posts = await postService.listPosts(blog_slug, this.userId, opts.limit, opts.offset, {
          sort: opts.sort,
          includeEngagement: opts.includeEngagement,
          period: opts.period,
        });
      } else {
        // global search across public posts
        posts = await postService.searchPosts({
          search: opts.search,
          currentUserId: this.userId,
          limit: opts.limit,
          offset: opts.offset,
          sort: opts.sort,
          period: opts.period,
          includeEngagement: opts.includeEngagement,
        });
      }

      // Add convenient URL for frontend to open the post directly
      const postsWithUrl = Array.isArray(posts)
        ? posts.map((p) => ({
            ...p,
            url:
              p && p.blogSlug && p.slug
                ? `/farmlog-post.html?blog=${encodeURIComponent(p.blogSlug)}&post=${encodeURIComponent(p.slug)}`
                : undefined,
          }))
        : posts;

      return { posts: postsWithUrl, timestamp: new Date().toISOString() };
    } catch (err) {
      return { error: `Farmlog posts lookup failed: ${err.message || String(err)}` };
    }
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
