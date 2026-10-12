/**
 * "Native WebMCP or polyfill?" explainer dialog for the WebMCP practice pages
 * (/practice/webmcp-demo.html, /practice/webmcp-seed-shop.html).
 *
 * Usage: RolnopolWebMcpExplainer.attach(buttonElement, { native: true|false, example })
 * The button opens a modal that shows which mode the browser is in, a diagram of
 * both modes, what works in each, and how to get native support.
 */
(function (root) {
  "use strict";

  const FLOWS = {
    native: {
      title: "Native WebMCP",
      steps: [
        { label: "This page", detail: "registerTool(...)" },
        { label: "Browser", detail: "document.modelContext, built in" },
      ],
      callers: [
        { label: "Browser AI agent", works: true },
        { label: "Tool console, DevTools, tests", works: true },
      ],
    },
    polyfill: {
      title: "Polyfill",
      steps: [
        { label: "This page", detail: "registerTool(...)" },
        { label: "Page's own copy", detail: "document.modelContext, added by the page" },
      ],
      callers: [
        { label: "Browser AI agent", works: false, note: "the browser doesn't know about these tools" },
        { label: "Tool console, DevTools, tests", works: true },
      ],
    },
  };

  const CAPABILITIES = [
    ["Tools register", true, true],
    ["Tool console on this page", true, true],
    ["DevTools: getTools() and executeTool()", true, true],
    ["Playwright and other browser tests", true, true],
    ["toolchange and toolactivated events", true, true],
    ["The browser's built-in AI agent can call the tools", true, false],
  ];

  const AGENT_EXAMPLES = {
    inBrowser: [
      ["Gemini in Chrome", "built into Chrome"],
      ["Copilot in Microsoft Edge", "built into Edge"],
      ["Perplexity Comet, ChatGPT Atlas", "browsers built around an AI assistant"],
      ["Claude for Chrome", "a browser extension from Anthropic"],
    ],
    outsideBrowser: [
      ["Claude Code, Claude desktop app", "run on your computer, not in a tab"],
      ["GitHub Copilot in VS Code", "runs in your editor"],
    ],
  };

  function el(tag, attrs = {}, children = []) {
    const node = root.document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    });
    children.filter(Boolean).forEach((child) => node.appendChild(typeof child === "string" ? root.document.createTextNode(child) : child));
    return node;
  }

  function mark(works) {
    return el("span", { className: `wx-mark wx-mark--${works ? "yes" : "no"}`, "aria-label": works ? "works" : "does not work", text: works ? "✓" : "✕" });
  }

  function renderFlow(key, current) {
    const flow = FLOWS[key];
    const isCurrent = key === current;
    const children = [];

    flow.steps.forEach((step) => {
      children.push(el("div", { className: "wx-node" }, [el("strong", { text: step.label }), el("code", { text: step.detail })]));
      children.push(el("div", { className: "wx-arrow", "aria-hidden": "true" }));
    });

    children.push(
      el(
        "div",
        { className: "wx-callers" },
        flow.callers.map((caller) =>
          el("div", { className: `wx-caller${caller.works ? "" : " wx-caller--blocked"}` }, [
            mark(caller.works),
            el("span", {}, [caller.label, caller.note ? el("small", { text: caller.note }) : null]),
          ]),
        ),
      ),
    );

    return el("figure", { className: `wx-flow${isCurrent ? " wx-flow--current" : ""}`, "data-testid": `explainer-flow-${key}` }, [
      el("figcaption", {}, [flow.title, isCurrent ? el("span", { className: "wx-here", text: "Your browser" }) : null]),
      ...children,
    ]);
  }

  /** Which assistants count as browser agents, and which run outside the browser. */
  function renderAgentKinds() {
    return el("div", { className: "wx-agents", "data-testid": "explainer-agent-kinds" }, [
      el("div", { className: "wx-agents__group wx-agents__group--in" }, [
        el("h4", { text: "Browser agents" }),
        el(
          "ul",
          {},
          AGENT_EXAMPLES.inBrowser.map(([name, where]) => el("li", {}, [el("strong", { text: name }), ` ${where}`])),
        ),
      ]),
      el("div", { className: "wx-agents__group wx-agents__group--out" }, [
        el("h4", { text: "Not browser agents" }),
        el(
          "ul",
          {},
          AGENT_EXAMPLES.outsideBrowser.map(([name, where]) => el("li", {}, [el("strong", { text: name }), ` ${where}`])),
        ),
        el("p", {}, [
          "These run outside the browser and can't see ",
          el("code", { text: "document.modelContext" }),
          ", native or polyfill. To give them these tools you need a bridge: a small local MCP server connected to the tab, or a Playwright script that calls ",
          el("code", { text: "executeTool()" }),
          ".",
        ]),
      ]),
    ]);
  }

  /**
   * A worked example: what the user asks, which tools the agent calls, what it answers.
   * @param {{ prompt: string, calls: Array<{ tool: string, input: Object, note?: string }>, reply: string }} example
   */
  function renderAgentExample(example, native) {
    if (!example) return null;

    const turns = [el("div", { className: "wx-turn wx-turn--user" }, [el("span", { className: "wx-who", text: "You" }), el("p", { text: example.prompt })])];

    example.calls.forEach((call) => {
      turns.push(
        el("div", { className: "wx-turn wx-turn--tool" }, [
          el("span", { className: "wx-who", text: "Agent calls a tool" }),
          el("pre", { className: "wx-code" }, [el("code", { text: `${call.tool}\n${JSON.stringify(call.input)}` })]),
          call.note ? el("small", { text: call.note }) : null,
        ]),
      );
    });

    turns.push(el("div", { className: "wx-turn wx-turn--agent" }, [el("span", { className: "wx-who", text: "Agent" }), el("p", { text: example.reply })]));

    return el("div", { className: "wx-example", "data-testid": "explainer-example" }, [
      el("div", { className: "wx-chat" }, turns),
      el("p", { className: "wx-footnote" }, [
        native
          ? "Your browser supports WebMCP, so an agent like this can make these calls on this page."
          : "On the polyfill a browser agent can't see these tools. You can make the same calls yourself in the tool console.",
      ]),
    ]);
  }

  function buildDialog(native, example) {
    const current = native ? "native" : "polyfill";

    const closeButton = el("button", { type: "button", className: "wx-close", "aria-label": "Close", "data-testid": "explainer-close" }, ["✕"]);

    const table = el("table", { className: "wx-table" }, [
      el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "What you can do" }), el("th", { scope: "col", text: "Native" }), el("th", { scope: "col", text: "Polyfill" })])]),
      el(
        "tbody",
        {},
        CAPABILITIES.map(([label, nativeWorks, polyfillWorks]) =>
          el("tr", {}, [el("th", { scope: "row", text: label }), el("td", {}, [mark(nativeWorks)]), el("td", {}, [mark(polyfillWorks)])]),
        ),
      ),
    ]);

    const status = native
      ? "Your browser has WebMCP built in. The tools on this page are registered with the browser, so its AI agent can find and call them."
      : "Your browser has no built-in WebMCP, so this page added its own copy of the API. Everything on the page works, but the browser's own AI agent can't see the tools.";

    const dialog = el("dialog", { className: "wx-dialog", "aria-labelledby": "wxTitle", "data-testid": "webmcp-explainer" }, [
      el("div", { className: "wx-header" }, [
        el("div", {}, [el("p", { className: "wx-eyebrow", text: "WebMCP" }), el("h2", { id: "wxTitle", text: native ? "Native WebMCP" : "Running on the polyfill" })]),
        closeButton,
      ]),
      el("p", { className: `wx-status wx-status--${current}`, "data-testid": "explainer-status", text: status }),

      el("h3", { text: "What is a browser AI agent?" }),
      el("p", {}, [
        "An AI assistant that works inside your browser, either built into it or added as an extension. You tell it what you want in plain words. ",
        "Without WebMCP it has to read the screen and click buttons the way a person would. With WebMCP it skips that: it reads the tools the page ",
        "registered, with their names, descriptions and inputs, and calls the right one directly.",
      ]),
      renderAgentKinds(),
      el("p", { className: "wx-footnote" }, [
        "Being a browser agent doesn't mean an assistant uses WebMCP yet. Most of them still read the page and click. WebMCP is a draft, ",
        "so direct tool calls need both the browser and the agent to support it, and for now that means preview builds.",
      ]),
      renderAgentExample(example, native),

      el("h3", { text: "How the tools reach an agent" }),
      el("div", { className: "wx-flows" }, [renderFlow("native", current), renderFlow("polyfill", current)]),

      el("h3", { text: "What works where" }),
      table,

      el("h3", { text: "Getting native WebMCP" }),
      el("p", {}, [
        "WebMCP is a draft from the W3C Web Machine Learning group, so browsers support it only behind preview flags. Recent Chrome builds have a WebMCP entry in ",
        el("code", { text: "chrome://flags" }),
        ". The exact name changes between versions. Turn it on, restart the browser and reload this page. The badge then says Native WebMCP.",
      ]),
      el("p", {}, ["The page checks for support like this:"]),
      el("pre", { className: "wx-code" }, [el("code", { text: "const native = Boolean(document.modelContext || navigator.modelContext);" })]),
      el("p", { className: "wx-footnote" }, [
        "Spec: ",
        el("a", { href: "https://webmachinelearning.github.io/webmcp/", target: "_blank", rel: "noopener", text: "webmachinelearning.github.io/webmcp" }),
      ]),
    ]);

    closeButton.addEventListener("click", () => dialog.close());
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    return dialog;
  }

  /**
   * Turn a button into the WebMCP mode badge and open the explainer on click.
   * @param {HTMLButtonElement} button
   * @param {{ native: boolean, example?: Object }} options - `example` is a worked agent example for this page
   */
  function attach(button, { native, example }) {
    const dialog = buildDialog(native, example);
    root.document.body.appendChild(dialog);

    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", () => dialog.showModal());
    return dialog;
  }

  const api = { attach, FLOWS, CAPABILITIES, AGENT_EXAMPLES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RolnopolWebMcpExplainer = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
