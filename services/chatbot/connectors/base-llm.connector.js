const ToolsExecutor = require("../tools/tools-executor");
const { logWarning } = require("../../../helpers/logger-api");
const { logInfo, logTrace, logLlmRequest, logLlmResponse } = require("../logger-proxy");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Strip model/template artifacts that some providers (notably free OpenRouter
 * models with tool-calling chat templates) can leak into content: raw tool-call
 * blocks, special <|...|> tokens, bare `call:tool{...}` fragments, and
 * "User Safety:" / "(tool call)" labels. Applied to the final answer as a
 * safety net before it is streamed to the client.
 */
function stripModelArtifacts(text) {
  return String(text)
    // whole tool-call blocks, e.g. <|tool_call>call:get_weather{...}<tool_call|>
    .replace(/<\|?\/?tool_?call[\s\S]*?tool_?call\|?>/gi, "")
    // any leftover special tokens like <|assistant|>, <|/tool_call|>, <|eot|>
    .replace(/<\|[^\n]*?\|>/g, "")
    // stray opening/closing tool_call markers
    .replace(/<\/?\|?tool_?call\|?>/gi, "")
    // bare tool-call fragments: call: get_weather { ... }
    .replace(/\bcall:\s*[\w.-]+\s*\{[^}]*\}/gi, "")
    // safety / tool annotations that leak as content
    .replace(/^[ \t]*User Safety:[ \t]*\w+[ \t]*$/gim, "")
    .replace(/\s*\((?:tool call|function call)\)\s*/gi, " ");
}

/**
 * BaseConnector - Abstract parent class for LLM connectors
 * Handles common prompt building, generation logic, and function calling
 */
class BaseLlmConnector {
  constructor(provider, providerName, options = {}) {
    this.providerName = providerName;
    this.provider = provider;
    this.metrics = options.prometheusMetrics ?? null;
    this.botProfile = options.botProfile || null;
    this.provider.ensureConfigured();
    this.maxToolCalls = 8; // Prevent infinite loops
    this.maxToolCallsPerTool = 4; // Prevent one tool dominating behavior (allows retries, e.g. resolving a region name)
    this.maxConversationTokens = 24000; // Prevent token overflow (rough estimate)
    this.approximateTokensPerMessage = 200; // Rough estimate for pruning
  }

  /**
   * Build system instruction for the LLM
   * Can be overridden for custom system prompts
   */
  _buildSystemInstruction() {
    if (this.botProfile?.systemPrompt) {
      return {
        parts: [
          {
            text: this.botProfile.systemPrompt,
          },
        ],
      };
    }

    return {
      parts: [
        {
          text: [
            "You are Porky, Rolnopol's farm assistant.",
            "Answer clearly, briefly, and using only facts from the provided context when possible.",
            "If data is missing, say so directly and suggest what the user can ask next.",
            "For user-specific farm questions, prefer the get_user_farm_context tool before guessing.",
            "Request include_summary first, and ask for include_samples only when you need concrete examples or records.",
            "You have access to tools that can fetch additional farm data if needed. Use them wisely when the user's question requires current information like weather, alerts, or market prices.",
          ].join(" "),
        },
      ],
    };
  }

  _getPromptLabel() {
    return this.botProfile?.metadata?.userPromptLabel || "User question:";
  }

  _getPromptContextLabel() {
    return this.botProfile?.metadata?.promptContextLabel || "User farm context (JSON):";
  }

  _getPromptRules() {
    const customRules = this.botProfile?.metadata?.promptRules;
    if (Array.isArray(customRules) && customRules.length > 0) {
      return customRules;
    }

    return [
      "Keep response concise and practical.",
      "Do not invent resources that are not present in context.",
      "Respond in the language used by the user if possible.",
      "Use available tools to get additional data when needed (weather, alerts, market info, etc.)",
    ];
  }

  /**
   * Build prompt with context - can be overridden for custom formatting
   */
  _buildPrompt(prompt, context) {
    const promptLines = [this._getPromptLabel(), prompt].join("\n");
    const rules = this._getPromptRules();

    if (context && typeof context === "object" && Object.keys(context).length > 0) {
      return [
        promptLines,
        "",
        this._getPromptContextLabel(),
        JSON.stringify(context, null, 2),
        "",
        "Rules:",
        ...rules.map((rule) => `- ${rule}`),
      ].join("\n");
    }

    return [this._getPromptLabel(), prompt, "", "Rules:", ...rules.map((rule) => `- ${rule}`)].join("\n");
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
  async generateResponse({ prompt, context, promptContext, userId }) {
    const contextWithUserId = { ...context, userId };
    const systemInstruction = this._buildSystemInstruction();
    const useTools = this.botProfile?.supportsTools !== false;

    logTrace(`[LLM GENERATION START] User ID: ${userId}, Function calls enabled`, {
      userId,
      maxToolCalls: this.maxToolCalls,
      provider: this.providerName,
      botId: this.botProfile?.id || null,
      useTools,
    });

    let conversationMessages = [
      {
        role: "user",
        content: this._buildPrompt(prompt, promptContext ?? context),
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

      logLlmRequest({
        provider: this.providerName,
        userId,
        iteration: toolCallCount + 1,
        prompt,
        context: promptContext ?? context,
        messages: conversationMessages,
        systemInstruction,
        generationConfig: {
          temperature: 0.5,
        },
      });

      try {
        response = await this.provider.askText(null, {
          messages: conversationMessages,
          systemInstruction,
          useTools,
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

      logLlmResponse({
        provider: this.providerName,
        userId,
        iteration: toolCallCount + 1,
        text: response?.text ?? null,
        toolCalls: response?.toolCalls ?? null,
        raw: response?.raw ?? null,
        usage: response?.usage ?? null,
      });

      // Check if model wants to call tools
      if (useTools && response.toolCalls && response.toolCalls.length > 0) {
        toolCallCount++;

        const toolNames = response.toolCalls.map((tc) => tc.name);

        logInfo(
          `[LLM TOOL REQUEST] Provider '${this.providerName}' requested ${response.toolCalls.length} tool(s) for user ${userId}: ${toolNames.join(", ")}`,
        );

        // Count and enforce per-tool limits. Rather than aborting with a canned
        // error (which surfaced to users as "Tool usage limit exceeded"), stop
        // looping and synthesize a final answer from the data already gathered.
        let perToolLimitHit = false;
        for (const toolName of toolNames) {
          toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
          if (toolUsage[toolName] > this.maxToolCallsPerTool) {
            logWarning(`Tool '${toolName}' called more than ${this.maxToolCallsPerTool} times; forcing a final answer.`);
            perToolLimitHit = true;
            break;
          }
        }
        if (perToolLimitHit) {
          break;
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
      // The loop stopped without a plain-text answer (per-tool limit hit or max
      // tool calls reached). Make one final, tools-disabled pass so the model
      // answers from the data it already gathered instead of erroring out.
      logTrace(`[LLM GENERATION FORCE FINAL] Synthesizing final answer without tools`, {
        maxToolCalls: this.maxToolCalls,
        totalCallsMade: toolCallCount,
      });
      const forced = await this._forceFinalAnswer(conversationMessages, systemInstruction, userId);
      finalResponse = forced || "I gathered the available data but couldn't compose a final answer. Please try rephrasing your question.";
      this.metrics?.recordChatbotRequest(this.providerName, forced ? "success" : "tool_limit");
    }

    return finalResponse;
  }

  /**
   * Make one final completion with tools disabled, instructing the model to
   * answer using the tool results already in the conversation. Used when the
   * agentic loop stops due to tool-usage limits, to avoid surfacing a raw
   * "limit exceeded" message to the user.
   */
  async _forceFinalAnswer(conversationMessages, systemInstruction, userId) {
    const messages = this._pruneConversation([
      ...conversationMessages,
      {
        role: "user",
        content: "Please provide your final answer now using the information gathered above. Do not call any more tools.",
      },
    ]);

    try {
      const response = await this.provider.askText(null, {
        messages,
        systemInstruction,
        useTools: false,
        generationConfig: { temperature: 0.5 },
      });
      return typeof response?.text === "string" && response.text.trim() ? response.text : null;
    } catch (error) {
      logWarning(`Final-answer synthesis failed for provider '${this.providerName}'`, { error: error.message || error, userId });
      return null;
    }
  }

  /**
   * Stream a response token-by-token. To keep tools working (so the assistant
   * can actually fetch weather, prices, alerts, etc.), this runs the full
   * agentic tool loop via generateResponse() to produce the clean final answer,
   * then streams that answer in small chunks. Streaming the resolved answer —
   * rather than the raw provider stream — is what lets tools run without
   * tool-call/template markup leaking into the output. The "thinking" indicator
   * on the client naturally covers the tool phase (the time before the first
   * chunk arrives).
   *
   * Yields `{ type: "token", delta }` chunks, then `{ type: "done", text, usage }`.
   */
  async *generateResponseStream({ prompt, context, promptContext, userId, signal }) {
    let finalText;
    try {
      finalText = await this.generateResponse({ prompt, context, promptContext, userId });
    } catch (error) {
      logWarning(`LLM provider '${this.providerName}' failed in generateResponseStream`, { error: error.message || error });
      throw error;
    }

    const clean = stripModelArtifacts(typeof finalText === "string" ? finalText : "");

    // Split into words while keeping trailing whitespace, so the reassembled
    // text is byte-identical to `clean`.
    const chunks = clean.match(/\S+\s*|\s+/g) || [];
    // Pace the chunks for a typewriter effect, capped so long answers don't drag.
    const perChunkDelayMs = chunks.length > 0 ? Math.min(22, Math.floor(2500 / chunks.length)) : 0;

    let streamed = "";
    for (const chunk of chunks) {
      if (signal?.aborted) {
        break;
      }
      streamed += chunk;
      yield { type: "token", delta: chunk };
      if (perChunkDelayMs > 0) {
        await sleep(perChunkDelayMs);
      }
    }

    yield { type: "done", text: streamed || clean, usage: null };
  }

  async getRateLimits() {
    return this.provider.getRateLimits();
  }
}

module.exports = BaseLlmConnector;
