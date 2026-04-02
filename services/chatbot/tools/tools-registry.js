/**
 * LLM Tools/Functions Registry
 * Defines callable functions that the LLM can invoke to get additional context
 */

const tools = [
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
