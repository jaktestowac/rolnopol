/**
 * LLM Tools/Functions Registry
 * Defines callable functions that the LLM can invoke to get additional context
 */

const tools = [
  {
    name: "get_user_farm_context",
    description:
      "Get detailed context about the user's farm including fields, staff, animals, and a summary of key stats. Use this to provide the LLM with up-to-date information about the farm when answering user questions or making recommendations.",
    parameters: {
      type: "object",
      properties: {
        include_samples: {
          type: "boolean",
          description: "Whether to include sample data for fields, staff, and animals (default: false)",
        },
        include_summary: {
          type: "boolean",
          description: "Whether to include a summary of key farm stats (default: true)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_farmlog_blogs",
    description: "Retrieve public Farmlog blogs. Use search, pagination, and optionally include engagement stats (likes/favorites).",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search term to filter blogs by title, slug, or tags" },
        limit: { type: "number", description: "Maximum number of blogs to return" },
        offset: { type: "number", description: "Offset for pagination" },
        include_engagement: { type: "boolean", description: "Include engagement metrics (likes/favorites) where available" },
      },
      required: [],
    },
  },
  {
    name: "get_farmlog_posts",
    description:
      "Retrieve public Farmlog posts. Can target a specific blog via blog_slug or search across all public posts. Supports pagination, sorting, and optional engagement metrics.",
    parameters: {
      type: "object",
      properties: {
        blog_slug: { type: "string", description: "Slug of the blog to list posts for (optional)" },
        search: { type: "string", description: "Search term to filter posts by title or content (optional)" },
        limit: { type: "number", description: "Maximum number of posts to return" },
        offset: { type: "number", description: "Offset for pagination" },
        sort: { type: "string", description: "Sort order: newest, oldest, title-asc, title-desc, most-liked" },
        period: { type: "string", description: "Time period to consider for engagement (e.g., '7d', '30d', 'all')" },
        include_engagement: { type: "boolean", description: "Include engagement metrics (likes counts) where available" },
      },
      required: [],
    },
  },
  {
    name: "get_weather_forecast",
    description:
      "Get current weather forecast and conditions for a specific Polish region. Use this if the user asks about weather, irrigation needs, or farming weather-related decisions.",
    parameters: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "Polish region name or code (e.g., 'Greater Poland', 'Masovian', 'Silesian', etc.)",
        },
      },
      required: ["region"],
    },
  },
  {
    name: "get_weather_regions",
    description:
      "Get the list of supported Polish regions (codes and names) that Rolnopol can provide weather for. Use this when the LLM needs to show region options or validate user-specified regions.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_weather_all_regions",
    description:
      "Get detailed weather data (today + short forecast) for all supported Polish regions. Use this when the LLM needs weather for the whole country and the user did not specify a region.",
    parameters: {
      type: "object",
      properties: {
        base_date: {
          type: "string",
          description: "Base date for the forecast in YYYY-MM-DD format. Defaults to tomorrow.",
        },
        days: {
          type: "number",
          description: "Number of forecast days (1-7). Defaults to 3.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_recent_alerts",
    description:
      "Retrieve recent farm alerts including weather warnings, irrigation recommendations, pest alerts, and disease warnings. Use this when the user asks about farm health or current issues.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of recent alerts to retrieve (default: 5, max: 20)",
        },
        severity: {
          type: "string",
          enum: ["critical", "warning", "info"],
          description: "Filter alerts by severity level (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_marketplace_summary",
    description:
      "Get a summary of current marketplace offerings: available fields for sale, animals available, and recent transactions. Use when the user asks about buying/selling opportunities.",
    parameters: {
      type: "object",
      properties: {
        resource_type: {
          type: "string",
          enum: ["fields", "animals", "all"],
          description: "Type of marketplace resource to fetch (default: all)",
        },
        limit: {
          type: "number",
          description: "Maximum number of offers to retrieve (default: 5, max: 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_commodity_prices",
    description:
      "Get current commodity prices and trends for the farm (wheat, corn, milk, potatoes, etc.). Use when the user asks about market prices or trading opportunities.",
    parameters: {
      type: "object",
      properties: {
        commodity: {
          type: "string",
          description: "Specific commodity name to query (e.g., 'wheat', 'corn', 'milk') or 'all'",
        },
        include_history: {
          type: "boolean",
          description: "Include recent price history and trends",
        },
      },
      required: [],
    },
  },
  {
    name: "get_staff_workload",
    description:
      "Get current workload and status information for farm staff members. Use when the user asks about staff capacity or task assignments.",
    parameters: {
      type: "object",
      properties: {
        include_assignments: {
          type: "boolean",
          description: "Include current task assignments for each staff member",
        },
      },
      required: [],
    },
  },
  {
    name: "get_documentation_answer",
    description:
      "Retrieve relevant documentation snippets based on a user query. Useful when the LLM should answer from Rolnopol docs in a precise and concise way.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The question or topic to search in the documentation.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of top matching results to return (default 3).",
        },
      },
      required: ["query"],
    },
  },
];

/**
 * Get tool definition for Gemini API format
 * Gemini uses "tools" with "googleSearch" style
 */
function getToolsForGemini() {
  return {
    tools: [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "OBJECT",
            properties: Object.entries(tool.parameters.properties).reduce((acc, [key, value]) => {
              acc[key] = {
                type: (value.type || "STRING").toUpperCase(),
                description: value.description,
                enum: value.enum,
              };
              return acc;
            }, {}),
            required: tool.parameters.required,
          },
        })),
      },
    ],
  };
}

/**
 * Get tool definition for OpenRouter/OpenAI format
 * OpenRouter uses standard OpenAI function calling format
 */
function getToolsForOpenRouter() {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Find a tool definition by name
 */
function getToolByName(toolName) {
  return tools.find((t) => t.name === toolName);
}

module.exports = {
  tools,
  getToolsForGemini,
  getToolsForOpenRouter,
  getToolByName,
};
