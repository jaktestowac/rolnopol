const ToolsExecutor = require("../tools/tools-executor");
const { logInfo, logWarning, logTrace } = require("../../../helpers/logger-api");

/**
 * BaseConnector - Abstract parent class for LLM connectors
 * Handles common prompt building, generation logic, and function calling
 */
class BaseLlmConnector {
  constructor(provider, providerName, prometheusMetrics = null) {
    this.providerName = providerName;
    this.provider = provider;
    this.metrics = prometheusMetrics;
    this.provider.ensureConfigured();
    this.maxToolCalls = 5; // Prevent infinite loops
    this.maxToolCallsPerTool = 2; // Prevent one tool dominating behavior
    this.maxConversationTokens = 8000; // Prevent token overflow (rough estimate)
    this.approximateTokensPerMessage = 200; // Rough estimate for pruning
  }

  /**
   * Build system instruction for the LLM
   * Can be overridden for custom system prompts
   */
  _buildSystemInstruction() {
    return {
      parts: [
        {
          text: [
            "You are Porky, Rolnopol's farm assistant.",
            "Answer clearly, briefly, and using only facts from the provided context when possible.",
            "If data is missing, say so directly and suggest what the user can ask next.",
            "You have access to tools that can fetch additional farm data if needed. Use them wisely when the user's question requires current information like weather, alerts, or market prices.",
          ].join(" "),
        },
      ],
    };
  }

  /**
   * Build prompt with context - can be overridden for custom formatting
   */
  _buildPrompt(prompt, context) {
    return [
      "User question:",
      prompt,
      "",
      "User farm context (JSON):",
      JSON.stringify(context || {}, null, 2),
      "",
      "Rules:",
      "- Keep response concise and practical.",
      "- Do not invent resources that are not present in context.",
      "- Respond in the language used by the user if possible.",
      "- Use available tools to get additional data when needed (weather, alerts, market info, etc.)",
    ].join("\n");
  }

  /**
   * Estimate tokens in a message (rough approximation)
   */
  _estimateTokens(text) {
    // Very rough estimate: ~4 characters per token
    return Math.ceil((text?.length || 0) / 4);
  }

  /**
   * Get estimated token count for conversation
   */
  _getConversationTokenCount(messages) {
    return messages.reduce((total, msg) => total + this._estimateTokens(msg.content), 0);
  }

  /**
   * Prune old messages to stay within token budget
   * Keeps first (system context) message and recent messages
   */
  _pruneConversation(messages) {
    const tokenCount = this._getConversationTokenCount(messages);

    if (tokenCount <= this.maxConversationTokens) {
      return messages;
    }

    logWarning(`Conversation tokens (${tokenCount}) exceed limit (${this.maxConversationTokens}). Pruning old messages.`);

    // Keep first message (system context + initial prompt)
    const firstMessage = messages[0];
    const remainingMessages = messages.slice(1);

    // Remove messages from middle, keeping recent ones
    const pruned = [firstMessage, ...remainingMessages.slice(-4)]; // Keep last 4 + first

    const newTokenCount = this._getConversationTokenCount(pruned);
    logInfo(`Pruned conversation from ${messages.length} to ${pruned.length} messages (tokens: ${tokenCount} → ${newTokenCount})`);

    return pruned;
  }

  /**
   * Execute tool calls and compile their results
   */
  async _executeToolCalls(toolCalls, context) {
    const executor = new ToolsExecutor(context.userId, context);
    const results = [];

    for (const toolCall of toolCalls) {
      logInfo(`Executing tool: ${toolCall.name}`);
      logTrace(`[TOOL EXECUTION] Tool: ${toolCall.name}`, {
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        userId: context.userId,
      });

      const startTime = Date.now();
      const result = await executor.execute(toolCall.name, toolCall.arguments);
      const executionTime = Date.now() - startTime;

      this.metrics?.recordChatbotToolCall(toolCall.name);

      logTrace(`[TOOL RESULT] Tool '${toolCall.name}' completed`, {
        toolName: toolCall.name,
        executionTimeMs: executionTime,
        resultType: typeof result,
        hasError: result?.error ? true : false,
      });

      results.push({
        tool: toolCall.name,
        result: result,
      });
    }

    return results;
  }

  /**
   * Format tool results as text for the LLM to consume
   */
  _formatToolResults(toolResults) {
    return toolResults.map((tr) => `Tool: ${tr.tool}\nResult:\n${JSON.stringify(tr.result, null, 2)}`).join("\n\n");
  }

  /**
   * Generate response from LLM with support for function calling
   * Implements agentic loop: ask → check for tool calls → execute → ask again
   */
  async generateResponse({ prompt, context, userId }) {
    const contextWithUserId = { ...context, userId };
    const executor = new ToolsExecutor(userId, contextWithUserId);

    logTrace(`[LLM GENERATION START] User ID: ${userId}, Function calls enabled`, {
      userId,
      maxToolCalls: this.maxToolCalls,
      provider: this.providerName,
    });

    let conversationMessages = [
      {
        role: "user",
        content: this._buildPrompt(prompt, context),
      },
    ];

    let toolCallCount = 0;
    let finalResponse = null;
    const toolUsage = {}; // toolName -> times used in this request

    // Agentic loop - keep asking until we get a final response (no tool calls)
    while (toolCallCount < this.maxToolCalls) {
      // Prune conversation if needed to avoid token overflow
      conversationMessages = this._pruneConversation(conversationMessages);

      logTrace(`[LLM QUERY] Iteration ${toolCallCount + 1}, Messages in conversation: ${conversationMessages.length}`, {
        iteration: toolCallCount + 1,
        conversationLength: conversationMessages.length,
        maxToolCalls: this.maxToolCalls,
      });

      // Get response from LLM - pass FULL conversation history
      const llmStart = Date.now();
      let response;

      try {
        response = await this.provider.askText(null, {
          messages: conversationMessages,
          systemInstruction: this._buildSystemInstruction(),
          generationConfig: {
            temperature: 0.5,
          },
        });
      } catch (error) {
        logWarning(`LLM provider '${this.providerName}' failed in askText`, { error: error.message || error });
        this.metrics?.recordChatbotRequest(this.providerName, "failure");
        throw error;
      } finally {
        const llmDurationMs = Date.now() - llmStart;
        this.metrics?.recordChatbotDuration(this.providerName, llmDurationMs / 1000);
      }

      // Record estimated tokens for the model reply (best-effort)
      if (response && typeof response.text === "string") {
        const tokenEstimate = this._estimateTokens(response.text);
        this.metrics?.recordChatbotTokenUsage(this.providerName, tokenEstimate);
      }

      // Check if model wants to call tools
      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCallCount++;

        const toolNames = response.toolCalls.map((tc) => tc.name);

        // Count and enforce per-tool limits
        for (const toolName of toolNames) {
          toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
          if (toolUsage[toolName] > this.maxToolCallsPerTool) {
            logWarning(`Tool '${toolName}' called more than ${this.maxToolCallsPerTool} times`);
            finalResponse = `Tool usage limit exceeded for '${toolName}'. Please try a more specific query.`;
            return finalResponse;
          }
        }

        logInfo(`Tool call #${toolCallCount}: ${toolNames.join(", ")}`);

        logTrace(`[LLM TOOLS REQUESTED] Agentic iteration #${toolCallCount}`, {
          iteration: toolCallCount,
          totalToolsRequested: response.toolCalls.length,
          toolNames: toolNames,
          llmResponse: response.text?.substring(0, 100), // First 100 chars for context
        });

        // Execute all tool calls
        const toolResults = await this._executeToolCalls(response.toolCalls, contextWithUserId);

        logTrace(`[TOOLS EXECUTED] All tools completed for iteration #${toolCallCount}`, {
          iteration: toolCallCount,
          toolsExecuted: toolResults.length,
          toolsWithErrors: toolResults.filter((tr) => tr.result?.error).length,
        });

        // Add LLM's tool call request to conversation (for context)
        conversationMessages.push({
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls,
        });

        // Add tool results as system message
        const toolResultsText = this._formatToolResults(toolResults);
        conversationMessages.push({
          role: "user",
          content: `Tool execution results:\n\n${toolResultsText}\n\nPlease provide your response based on the above information.`,
        });

        // Continue loop to get final response
        continue;
      }

      // No tool calls - this is the final response
      finalResponse = response.text;
      logTrace(`[LLM GENERATION END] Final response generated`, {
        totalIterations: toolCallCount + 1,
        toolCallsMade: toolCallCount,
        finalResponseLength: finalResponse?.length || 0,
      });

      this.metrics?.recordChatbotRequest(this.providerName, "success");
      break;
    }

    if (!finalResponse) {
      finalResponse = "I reached the maximum number of information lookups. Please try again with a more specific question.";
      logTrace(`[LLM GENERATION MAX CALLS] Reached maximum tool calls limit`, {
        maxToolCalls: this.maxToolCalls,
        totalCallsMade: toolCallCount,
      });
      this.metrics?.recordChatbotRequest(this.providerName, "tool_limit");
    }

    return finalResponse;
  }
}

module.exports = BaseLlmConnector;
