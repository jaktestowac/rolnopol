(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TerminalOutputRenderer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const DEFAULT_ALLOWED_TAGS = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "i",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
    "hr",
  ]);
  const SELF_CLOSING_TAGS = new Set(["br", "hr"]);
  const DEFAULT_ALLOWED_ATTRS = new Set(["class", "title", "aria-label", "aria-hidden"]);

  function toStringValue(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(text) {
    return toStringValue(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Highlight the literal word "porky" inside escaped HTML.
  // We escape the input first to avoid introducing untrusted HTML, then
  // replace whole-word matches with a safe <span> wrapper.
  const PORKY_WORD_RE = /\b(porky)\b/gi;
  function highlightPorkyEscapedHtml(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(PORKY_WORD_RE, '<span class="terminal-word--porky">$1</span>');
  }

  function wait(ms) {
    const duration = Number(ms);
    if (!Number.isFinite(duration) || duration <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function createCancellationError() {
    const error = new Error("Terminal render cancelled");
    error.name = "TerminalRenderCancelledError";
    error.code = "TERMINAL_RENDER_CANCELLED";
    return error;
  }

  function waitWithSignal(ms, signal) {
    if (signal?.aborted) {
      return Promise.reject(createCancellationError());
    }

    const duration = Number(ms);
    if (!Number.isFinite(duration) || duration <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, duration);

      const onAbort = () => {
        cleanup();
        reject(createCancellationError());
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function normalizeResult(result) {
    if (result == null) {
      return { type: "text", content: "" };
    }

    if (typeof result === "string") {
      return { type: "text", content: result };
    }

    if (typeof result !== "object") {
      return { type: "text", content: toStringValue(result) };
    }

    const normalized = { ...result };
    normalized.type = toStringValue(normalized.type || "text").trim() || "text";

    if (normalized.items && !Array.isArray(normalized.items)) {
      normalized.items = [normalized.items];
    }

    return normalized;
  }

  function getResultDelayMs(result) {
    const directDelay = Number(result?.delayMs);
    if (Number.isFinite(directDelay) && directDelay > 0) {
      return directDelay;
    }

    const metadataDelay = Number(result?.metadata?.delayMs);
    if (Number.isFinite(metadataDelay) && metadataDelay > 0) {
      return metadataDelay;
    }

    return 0;
  }

  function hasTypingEffect(result, config) {
    return (
      result?.type === "typing" ||
      result?.typingEffect === true ||
      result?.metadata?.typingEffect === true ||
      result?.metadata?.typewriter === true ||
      result?.options?.typingEffect === true ||
      config?.typingEffect === true
    );
  }

  function getPresentationType(result) {
    if (!result || typeof result !== "object") {
      return "text";
    }

    if (result.type === "text") {
      if (result.metadata?.warn === true) return "warning";
      if (result.metadata?.success === true) return "success";
      if (result.metadata?.error === true) return "error";
    }

    return result.type || "text";
  }

  function isParallelScript(result) {
    const mode = toStringValue(result?.mode || result?.metadata?.mode)
      .trim()
      .toLowerCase();
    return mode === "parallel" || result?.metadata?.startTogether === true || result?.metadata?.parallel === true;
  }

  function shouldUseTypingEffect(result, config) {
    const presentationType = getPresentationType(result);
    const canType = ["text", "warning", "success", "error"].includes(presentationType);

    return canType && hasTypingEffect(result, config);
  }

  function formatJson(content) {
    if (typeof content === "string") {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch (_) {
        return content;
      }
    }

    try {
      return JSON.stringify(content, null, 2);
    } catch (_) {
      return toStringValue(content);
    }
  }

  function isSafeUrl(value) {
    const url = toStringValue(value).trim();
    if (!url) return false;

    if (/^(https?:|mailto:|tel:|\/|#)/i.test(url)) {
      return true;
    }

    if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(url)) {
      return true;
    }

    return false;
  }

  function sanitizeHtml(inputHtml) {
    const raw = toStringValue(inputHtml);

    const attrPattern = /([a-zA-Z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
    const tagPattern = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;

    let sanitized = "";
    let lastIndex = 0;
    let match;

    while ((match = tagPattern.exec(raw)) !== null) {
      const [fullMatch, tagNameRaw, attrSource] = match;
      const tagName = tagNameRaw.toLowerCase();

      sanitized += escapeHtml(raw.slice(lastIndex, match.index));
      lastIndex = match.index + fullMatch.length;

      if (!DEFAULT_ALLOWED_TAGS.has(tagName)) {
        continue;
      }

      const isClosingTag = fullMatch.startsWith("</");
      if (isClosingTag) {
        sanitized += `</${tagName}>`;
        continue;
      }

      const attrs = [];
      let attrMatch;
      attrPattern.lastIndex = 0;
      while ((attrMatch = attrPattern.exec(attrSource || "")) !== null) {
        const attrName = attrMatch[1].toLowerCase();
        const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";

        if (DEFAULT_ALLOWED_ATTRS.has(attrName)) {
          attrs.push(`${attrName}="${escapeHtml(attrValue)}"`);
          continue;
        }

        if (tagName === "a" && attrName === "href" && isSafeUrl(attrValue)) {
          attrs.push(`href="${escapeHtml(attrValue)}"`);
          continue;
        }

        if (tagName === "a" && attrName === "target") {
          attrs.push(`target="${escapeHtml(attrValue)}"`);
          if (attrValue === "_blank" && !attrs.some((entry) => entry.startsWith("rel="))) {
            attrs.push('rel="noopener noreferrer"');
          }
          continue;
        }

        if (tagName === "a" && attrName === "rel") {
          attrs.push(`rel="${escapeHtml(attrValue)}"`);
        }
      }

      const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
      sanitized += SELF_CLOSING_TAGS.has(tagName) ? `<${tagName}${attrText}>` : `<${tagName}${attrText}>`;
    }

    sanitized += escapeHtml(raw.slice(lastIndex));
    return sanitized;
  }

  function formatTableContent(content) {
    if (Array.isArray(content)) {
      return {
        headers: content.length > 0 ? Object.keys(content[0] || {}) : [],
        rows: content,
      };
    }

    if (content && typeof content === "object") {
      return {
        headers: Array.isArray(content.headers) ? content.headers : [],
        rows: Array.isArray(content.rows) ? content.rows : [],
      };
    }

    return { headers: [], rows: [] };
  }

  function createTerminalOutputRenderer(outputElement, options = {}) {
    if (!outputElement) {
      throw new Error("A terminal output element is required");
    }

    const config = {
      autoScroll: options.autoScroll !== false,
      typingEffect: options.typingEffect === true,
      typingSpeed: Number.isFinite(options.typingSpeed) ? Math.max(1, options.typingSpeed) : 15,
      onAfterRender: typeof options.onAfterRender === "function" ? options.onAfterRender : null,
      documentRef: options.documentRef || (typeof document !== "undefined" ? document : null),
    };

    let counter = 0;

    function nextMeta(type, result) {
      counter += 1;
      return {
        id: `terminal-output-${counter}`,
        type,
        createdAt: new Date().toISOString(),
        result,
      };
    }

    function attachMeta(element, meta) {
      element.dataset.outputId = meta.id;
      element.dataset.outputType = meta.type;
      element.dataset.createdAt = meta.createdAt;
      element.setAttribute("data-output-id", meta.id);
      element.setAttribute("data-output-type", meta.type);
      element.setAttribute("data-created-at", meta.createdAt);
      return element;
    }

    function appendElement(element, meta) {
      attachMeta(element, meta);
      outputElement.appendChild(element);

      if (config.autoScroll) {
        outputElement.scrollTop = outputElement.scrollHeight;
      }

      if (config.onAfterRender) {
        config.onAfterRender(element, meta);
      }

      return element;
    }

    function createShell(type, extraClass = "") {
      const doc = config.documentRef;
      if (!doc) {
        throw new Error("A document is required to render terminal output");
      }

      const element = doc.createElement("div");
      element.className = `terminal-entry terminal-entry--response terminal-output-item terminal-output-item--${type} ${extraClass}`.trim();
      return element;
    }

    function renderTextLike(result, type = "text") {
      const doc = config.documentRef;
      const shell = createShell(type);
      const pre = doc.createElement("pre");
      pre.className = "terminal-output-item__content terminal-output-item__content--pre";
      // Use innerHTML of escaped-and-highlighted text so we can color the
      // literal word "porky" without allowing raw HTML from the source.
      pre.innerHTML = highlightPorkyEscapedHtml(toStringValue(result.content || ""));
      shell.appendChild(pre);
      return appendElement(shell, nextMeta(type, result));
    }

    async function renderTypingText(result, type = "text", signal = null) {
      const doc = config.documentRef;
      const shell = createShell(type);
      const pre = doc.createElement("pre");
      pre.className = "terminal-output-item__content terminal-output-item__content--pre";
      shell.appendChild(pre);
      appendElement(shell, nextMeta(type, result));

      const content = toStringValue(result.content || "");
      for (let index = 0; index < content.length; index += 1) {
        if (signal?.aborted) {
          throw createCancellationError();
        }

        // Update as HTML so the word-highlighting can be applied while typing.
        pre.innerHTML = highlightPorkyEscapedHtml(content.slice(0, index + 1));
        // Keep the renderer responsive but still visible if typing effect is enabled.
        // eslint-disable-next-line no-await-in-loop
        await waitWithSignal(config.typingSpeed, signal);
      }
    }

    function renderAscii(result) {
      return renderTextLike(result, "ascii");
    }

    function renderJson(result) {
      const doc = config.documentRef;
      const shell = createShell("json");
      const pre = doc.createElement("pre");
      pre.className = "terminal-output-item__content terminal-output-item__content--pre terminal-output-item__content--json";
      pre.innerHTML = highlightPorkyEscapedHtml(formatJson(result.content));
      shell.appendChild(pre);
      return appendElement(shell, nextMeta("json", result));
    }

    function renderHtml(result) {
      const doc = config.documentRef;
      const shell = createShell("html");
      const body = doc.createElement("div");
      body.className = "terminal-output-item__content terminal-output-item__content--html";
      // Sanitize first, then walk text nodes and wrap 'porky' occurrences so we don't
      // accidentally insert markup inside tag names or attributes.
      body.innerHTML = sanitizeHtml(result.content);

      // Walk text nodes and replace matches with a span wrapper.
      (function highlightTextNodes(root) {
        if (!root) return;
        const nodeIterator = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let current;
        while ((current = nodeIterator.nextNode())) {
          textNodes.push(current);
        }

        textNodes.forEach((textNode) => {
          const text = textNode.nodeValue || "";
          const re = new RegExp("\\b(porky)\\b", "gi");
          if (!re.test(text)) return;

          re.lastIndex = 0;
          const frag = doc.createDocumentFragment();
          let lastIndex = 0;
          let m;
          while ((m = re.exec(text)) !== null) {
            const before = text.slice(lastIndex, m.index);
            if (before) frag.appendChild(doc.createTextNode(before));
            const span = doc.createElement("span");
            span.className = "terminal-word--porky";
            span.textContent = m[0];
            frag.appendChild(span);
            lastIndex = m.index + m[0].length;
          }
          const after = text.slice(lastIndex);
          if (after) frag.appendChild(doc.createTextNode(after));
          textNode.parentNode.replaceChild(frag, textNode);
        });
      })(body);
      shell.appendChild(body);
      return appendElement(shell, nextMeta("html", result));
    }

    function renderImage(result) {
      const doc = config.documentRef;
      const shell = createShell("image");
      const figure = doc.createElement("figure");
      figure.className = "terminal-output-item__content terminal-output-item__content--figure terminal-output-item__figure";

      const img = doc.createElement("img");
      img.className = "terminal-output-item__image";
      img.loading = "lazy";
      img.alt = toStringValue(result.alt || result.content?.alt || "Terminal image");
      img.src = toStringValue(result.src || result.content?.src || result.content || "");

      const caption = doc.createElement("figcaption");
      caption.className = "terminal-output-item__caption";
      const captionText = toStringValue(result.alt || result.content?.alt || result.content?.caption || "");
      caption.innerHTML = highlightPorkyEscapedHtml(captionText);

      const fallback = () => {
        figure.innerHTML = "";
        const fallbackBlock = doc.createElement("div");
        fallbackBlock.className = "terminal-output-item__fallback";
        fallbackBlock.textContent = `Image unavailable: ${img.alt}`;
        figure.appendChild(fallbackBlock);
      };

      img.addEventListener("error", fallback, { once: true });

      figure.appendChild(img);
      if (caption.textContent) {
        figure.appendChild(caption);
      }

      shell.appendChild(figure);
      return appendElement(shell, nextMeta("image", result));
    }

    function renderTable(result) {
      const doc = config.documentRef;
      const { headers, rows } = formatTableContent(result.content);
      const shell = createShell("table");
      const table = doc.createElement("table");
      table.className = "terminal-output-item__table";

      if (headers.length > 0) {
        const thead = doc.createElement("thead");
        const tr = doc.createElement("tr");
        headers.forEach((header) => {
          const th = doc.createElement("th");
          th.textContent = toStringValue(header);
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
      }

      const tbody = doc.createElement("tbody");
      rows.forEach((row) => {
        const tr = doc.createElement("tr");
        headers.forEach((header) => {
          const td = doc.createElement("td");
          const value = row && typeof row === "object" ? row[header] : "";
          // Allow highlighting the word 'porky' inside table cells as well.
          td.innerHTML = highlightPorkyEscapedHtml(toStringValue(value));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      shell.appendChild(table);
      return appendElement(shell, nextMeta("table", result));
    }

    function renderResult(result, renderOptions = {}) {
      const normalized = normalizeResult(result);
      const signal = renderOptions.signal || config.signal || null;
      const shouldType = shouldUseTypingEffect(normalized, config);

      if (signal?.aborted) {
        return Promise.reject(createCancellationError());
      }

      const delayMs = getResultDelayMs(normalized);
      if (delayMs) {
        return waitWithSignal(delayMs, signal).then(() => {
          const delayedResult = { ...normalized, delayMs: 0, metadata: { ...(normalized.metadata || {}), delayMs: 0 } };

          if (shouldType) {
            return renderTypingText(delayedResult, getPresentationType(normalized), signal);
          }

          return renderResult(delayedResult, renderOptions);
        });
      }

      if (normalized.type === "composite" || normalized.type === "script") {
        const items = Array.isArray(normalized.items) ? normalized.items : Array.isArray(normalized.steps) ? normalized.steps : [];
        if (isParallelScript(normalized)) {
          return Promise.all(items.map((item) => renderResult(item, renderOptions))).then(() => undefined);
        }

        return items.reduce(
          (promise, item) =>
            promise.then(() => {
              if (signal?.aborted) {
                throw createCancellationError();
              }

              return renderResult(item, renderOptions);
            }),
          Promise.resolve(),
        );
      }

      if (normalized.type === "clear") {
        outputElement.innerHTML = "";
        if (config.autoScroll) {
          outputElement.scrollTop = 0;
        }
        return Promise.resolve();
      }

      if (shouldType) {
        return renderTypingText(normalized, getPresentationType(normalized), signal);
      }

      const presentationType = getPresentationType(normalized);

      switch (presentationType) {
        case "text":
        case "error":
        case "warning":
        case "success":
          return Promise.resolve(renderTextLike(normalized, presentationType)).then((element) => {
            if (presentationType === "error" && normalized.metadata?.hint) {
              const doc = config.documentRef;
              const hint = doc.createElement("div");
              hint.className = "terminal-entry terminal-entry--response terminal-entry--muted terminal-output-item__hint";
              hint.textContent = normalized.metadata.hint;
              attachMeta(hint, nextMeta("hint", { content: normalized.metadata.hint }));
              outputElement.appendChild(hint);
              if (config.autoScroll) {
                outputElement.scrollTop = outputElement.scrollHeight;
              }
            }

            return element;
          });
        case "ascii":
          return Promise.resolve(renderAscii(normalized));
        case "json":
          return Promise.resolve(renderJson(normalized));
        case "html":
          return Promise.resolve(renderHtml(normalized));
        case "image":
          return Promise.resolve(renderImage(normalized));
        case "table":
          return Promise.resolve(renderTable(normalized));
        default:
          return Promise.resolve(renderTextLike({ ...normalized, type: "text" }, "text"));
      }
    }

    return {
      clear() {
        outputElement.innerHTML = "";
      },
      render: renderResult,
      normalizeResult,
      sanitizeHtml,
      formatJson,
      getPresentationType,
      shouldUseTypingEffect,
    };
  }

  return {
    createTerminalOutputRenderer,
    normalizeResult,
    sanitizeHtml,
    formatJson,
    formatTableContent,
    getResultDelayMs,
    hasTypingEffect,
    isParallelScript,
    getPresentationType,
    shouldUseTypingEffect,
  };
});
