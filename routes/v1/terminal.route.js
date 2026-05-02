const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");

const { formatResponseBody, sendSuccess } = require("../../helpers/response-helper");
const { parseTerminalInput } = require("../../public/js/pages/terminal-command-system.js");
const porkyService = require("../../services/terminal-porky.service");
const fs = require("fs");
const path = require("path");
const posix = path.posix;

const router = express.Router();
const apiLimiter = createRateLimiter("high");

const BOOT_SEQUENCE = ["Booting operator terminal...", "Loading archive index...", "Synchronizing command registry...", "Terminal online."];

const STATIC_BOOT_STEPS = BOOT_SEQUENCE.map((content) => ({
  type: "text",
  content,
}));

const TERMINAL_COMMANDS = [
  {
    name: "run",
    description: "Run a predefined backend script",
    usage: "run <script-name>",
    category: "script",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "open",
    description: "Display a backend asset or virtual file",
    usage: "open <asset-or-file>",
    category: "content",
    requiresBackend: true,
    aliases: ["cat"],
  },
  {
    name: "list",
    description: "List backend scripts, files, or assets",
    usage: "list <scripts|files|assets>",
    category: "system",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "ls",
    description: "List directory contents (virtual filesystem)",
    usage: "ls [path]",
    category: "system",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "cd",
    description: "Change current directory (virtual filesystem)",
    usage: "cd <path>",
    category: "system",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "pwd",
    description: "Show current directory",
    usage: "pwd",
    category: "system",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "tree",
    description: "Show directory tree",
    usage: "tree [path]",
    category: "system",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "inspect",
    description: "Inspect a backend object",
    usage: "inspect <id>",
    category: "debug",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "search",
    description: "Search backend content",
    usage: "search <query>",
    category: "debug",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "mission",
    description: "Start a predefined scenario",
    usage: "mission <name>",
    category: "script",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "login",
    description: "Start a scripted login flow",
    usage: "login",
    category: "script",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "sync",
    description: "Refresh backend command metadata",
    usage: "sync",
    category: "debug",
    requiresBackend: true,
    aliases: [],
  },
  {
    name: "porky",
    description: "Talk with Porky, the terminal chatbot",
    usage: "porky [message]",
    category: "content",
    requiresBackend: true,
    aliases: [],
  },
];

let TERMINAL_SCRIPTS = {
  "boot-sequence": {
    id: "boot-sequence",
    title: "Boot Sequence",
    description: "Operator startup sequence",
    type: "script",
    tags: ["bootstrap", "demo"],
    author: { name: "system", contact: "ops@archive.local" },
    version: "1.1",
    visibility: "public",
    options: { repeatable: true, showInList: true, estimatedDurationMs: 1200 },
    steps: [
      { id: "boot-1", type: "text", content: "> Initializing operator shell...", delayMs: 150, metadata: { typingEffect: true } },
      { id: "boot-2", type: "text", content: "> Loading internal maps...", delayMs: 120 },
      { id: "boot-3", type: "text", content: "> Reading terminal bootstrap data...", delayMs: 100 },
      {
        id: "boot-art",
        type: "ascii",
        content: [
          "  _   _ _____  ____  ",
          " | | | |_   _|/ __ \\",
          " | |_| | | | | |  | |",
          " |  _  | | | | |  | |",
          " | | | |_| |_| |__| |",
          " |_| |_|_____|\\\\____/",
        ].join("\n"),
        delayMs: 300,
        metadata: { preserveWhitespace: true },
      },
    ],
  },
  diagnostics: {
    id: "diagnostics",
    title: "Diagnostics",
    description: "Basic health summary",
    type: "script",
    tags: ["diagnostic", "health"],
    version: "1.0",
    options: { repeatable: true, showInList: true },
    steps: [
      { id: "diag-collect", type: "text", content: "> Collecting system diagnostics...", delayMs: 200, metadata: { typingEffect: true } },
      {
        id: "diag-json",
        type: "json",
        content: {
          cpu: "OK",
          memory: "OK",
          disk: "OK",
          network: "OK",
        },
        delayMs: 400,
        metadata: { pretty: true },
      },
      { id: "diag-complete", type: "text", content: "> Diagnostics complete.", delayMs: 80 },
    ],
  },
  "login-sequence": {
    id: "login-sequence",
    title: "Login Sequence",
    description: "Secure operator sign-in flow",
    type: "script",
    tags: ["auth", "script"],
    version: "1.0",
    options: { repeatable: false, requiresAuth: false },
    steps: [
      { id: "login-verify", type: "text", content: "> Verifying operator token...", delayMs: 200, metadata: { typingEffect: true } },
      { id: "login-channel", type: "text", content: "> Establishing secure channel...", delayMs: 180 },
      { id: "login-granted", type: "text", content: "Access granted.", delayMs: 100 },
    ],
  },
  intro: {
    id: "intro",
    title: "Field Introduction",
    description: "Short mission introduction",
    type: "script",
    tags: ["intro", "mission"],
    version: "1.0",
    options: { repeatable: true },
    steps: [
      { id: "intro-1", type: "text", content: "> Mission control online.", delayMs: 120 },
      { id: "intro-2", type: "text", content: "> Follow terminal prompts carefully.", delayMs: 140 },
    ],
  },
  redroom: {
    id: "redroom",
    title: "Red Room Scenario",
    description: "High-security simulation environment",
    type: "script",
    tags: ["scenario", "security"],
    version: "2.0",
    options: { repeatable: false, experimental: true, showInList: false },
    steps: [
      { id: "r-1", type: "text", content: "> Entering R3D R00M scenario...", delayMs: 160 },
      { id: "r-2", type: "text", content: "> d00r.status = ȺJȺR", delayMs: 90 },
      { id: "r-3", type: "text", content: "> l̷i̷g̷h̷t̷ leakage detected...", delayMs: 120 },
      { id: "r-4", type: "text", content: "> Initializing security protocols...", delayMs: 120 },
      { id: "r-5", type: "text", content: "> Protocol layer 01: S̷E̷A̷L̷E̷D̷", delayMs: 120 },
      { id: "r-6", type: "text", content: "> Protocol layer 02: ᛋᛠᛋᛚᛖᛞ", delayMs: 120 },
      { id: "r-7", type: "text", content: "> Protocol layer 03: bl33ding", delayMs: 120 },
      { id: "r-8", type: "text", content: "> Checking room integrity...", delayMs: 1220, metadata: { typingEffect: true } },
      { id: "r-9", type: "text", content: "> Integrity: 98%", delayMs: 80 },
      { id: "r-10", type: "text", content: "> Integrity: 74%", delayMs: 80 },
      { id: "r-11", type: "text", content: "> Integrity: 113%", delayMs: 80, metadata: { warn: true } },
      { id: "r-12", type: "text", content: "> !ERR: VALUE_OUTSIDE_ROOM", delayMs: 120, onError: { action: "abort" } },
      { id: "r-13", type: "text", content: "> Recalculating... r̵e̶c̷a̸l̵c̶u̵l̶a̴t̷i̸n̶g̵...", delayMs: 200 },
      { id: "r-14", type: "text", content: "> [SIGNAL] ██░░██░░██░░██░░██", delayMs: 180, metadata: { signal: true } },
      { id: "r-15", type: "text", content: "> 0bserver detected behind glass.", delayMs: 220 },
      { id: "r-16", type: "text", content: "> 0bserver detected in glass.", delayMs: 360 },
      { id: "r-17", type: "text", content: "> 0bserver detected as glass.", delayMs: 400 },
      { id: "r-18", type: "text", content: "> m̷i̶r̵r̸o̵r̴.process returned: MISMATCH", delayMs: 640 },
      { id: "r-19", type: "text", content: "> Silence threshold exceeded: ███████", delayMs: 120 },
      { id: "r-20", type: "text", content: "> Red Room active.", delayMs: 120 },
      { id: "r-21", type: "text", content: "> D̸O̴ ̵N̵O̸T̶ ̴T̸O̸U̶C̶H̷ ̴T̸H̸E̷ ̴W̵A̷L̴L̴S̵.", delayMs: 200 },
    ],
  },
  "composite-demo": {
    id: "composite-demo",
    title: "Composite Demo",
    description: "Demonstrates composite and parallel step groups",
    type: "script",
    tags: ["demo", "composite"],
    version: "1.0",
    options: { repeatable: false },
    steps: [
      {
        id: "group-parallel",
        type: "composite",
        mode: "parallel",
        metadata: { startTogether: true },
        items: [
          { id: "p-a", type: "text", content: "Parallel task A", delayMs: 80 },
          { id: "p-b", type: "text", content: "Parallel task B", delayMs: 160 },
          { id: "p-c", type: "image", assetId: "signal-image", alt: "signal frame", delayMs: 0 },
        ],
      },
      { id: "post-parallel", type: "text", content: "> Parallel group complete.", delayMs: 120 },
    ],
  },
};

let TERMINAL_ASSETS = {
  "signal-image": {
    id: "signal-image",
    title: "Signal Frame",
    type: "image",
    alt: "Abstract terminal signal frame",
    src:
      "data:image/svg+xml;charset=UTF-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240"><rect width="480" height="240" fill="#0b120f"/><circle cx="240" cy="120" r="64" fill="none" stroke="#66ff99" stroke-width="8"/><path d="M40 120h110M330 120h110" stroke="#66ff99" stroke-width="6" stroke-linecap="round"/><path d="M240 56v128M208 88l64 64M304 88l-64 64" stroke="#66ff99" stroke-width="6" stroke-linecap="round"/></svg>',
      ),
  },
  "archive-banner": {
    id: "archive-banner",
    title: "Archive Banner",
    type: "text",
    content: "ARCHIVE NODE ONLINE",
  },
};

let TERMINAL_FILES = {
  "logs/system.log": {
    path: "logs/system.log",
    title: "System Log",
    type: "text",
    contentType: "text/plain",
    content: "[00:00] boot sequence initiated\n[00:01] registry synced\n[00:02] terminal ready",
  },
  "reports/status.json": {
    path: "reports/status.json",
    title: "Status Report",
    type: "json",
    contentType: "application/json",
    content: {
      system: "online",
      backend: "connected",
      latencyMs: 42,
    },
  },
  "images/waveform.svg": {
    path: "images/waveform.svg",
    title: "Waveform",
    type: "image",
    contentType: "image/svg+xml",
    alt: "Terminal waveform graphic",
    src:
      "data:image/svg+xml;charset=UTF-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" fill="#07110f"/><path d="M12 60h40l12-24 14 48 14-36 12 24h32l12-12 12 24 14-60 14 72 12-36 12 12h36" fill="none" stroke="#7dffb2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ),
  },
};

let TERMINAL_DIRECTORIES = new Set([""]);

// Simple per-session working directory map for the virtual file system
const SESSION_PATHS = new Map();

function ensureLeadingSlash(p) {
  if (!p) return "/";
  return String(p).startsWith("/") ? String(p) : `/${String(p)}`;
}

function stripLeadingSlash(p) {
  if (!p) return "";
  return String(p).replace(/^\/+/, "");
}

function normalizeVirtualDirectoryPath(p) {
  const normalized = posix.normalize(ensureLeadingSlash(String(p || "")));
  const stripped = stripLeadingSlash(normalized).replace(/\/$/, "");
  return stripped === "." ? "" : stripped;
}

function registerVirtualDirectory(directorySet, directoryPath) {
  const normalized = normalizeVirtualDirectoryPath(directoryPath);
  directorySet.add(normalized);
  return normalized;
}

function getSessionPath(sessionId) {
  const raw = String(sessionId || "").trim();
  const p = SESSION_PATHS.get(raw) || "/";
  const normalized = posix.normalize(ensureLeadingSlash(p));
  return normalized === "" ? "/" : normalized;
}

function setSessionPath(sessionId, newPath) {
  const raw = String(sessionId || "").trim();
  const resolved = posix.normalize(ensureLeadingSlash(String(newPath || "")));
  const safe = resolved === "" ? "/" : resolved;
  SESSION_PATHS.set(raw || "anonymous-session", safe);
  return safe;
}

function resolvePathForSession(sessionId, requestedPath) {
  const base = getSessionPath(sessionId) || "/";
  const req = String(requestedPath || "").trim();

  if (!req || req === ".") return base;
  if (req === "~") return base; // treat ~ as root for now
  if (req.startsWith("/")) {
    return posix.normalize(req);
  }

  return posix.normalize(posix.join(base, req));
}

function listDirectoryEntries(sessionId, requestedPath) {
  const resolved = resolvePathForSession(sessionId, requestedPath);
  const prefix = stripLeadingSlash(resolved).replace(/\/$/, "");
  const entries = new Map();

  function addDir(name, fullPath) {
    if (!name || entries.has(name)) return;
    entries.set(name, { name, type: "dir", path: fullPath });
  }

  function addFile(name, fullPath, file) {
    if (!name || entries.has(name)) return;
    entries.set(name, {
      name,
      type: file?.type || "file",
      path: fullPath,
      title: file?.title || file?.path || name,
    });
  }

  // Explicit directories (including empty ones)
  Array.from(TERMINAL_DIRECTORIES).forEach((dirPath) => {
    const normalizedDir = String(dirPath || "")
      .replace(/^\/+/, "")
      .replace(/\/$/, "");
    if (!normalizedDir || normalizedDir === prefix) return;

    if (!prefix) {
      const firstSegment = normalizedDir.split("/")[0];
      if (firstSegment) addDir(firstSegment, `/${firstSegment}`);
      return;
    }

    if (normalizedDir.startsWith(prefix + "/")) {
      const remainder = normalizedDir.slice(prefix.length + 1);
      const firstSegment = remainder.split("/")[0];
      if (firstSegment) addDir(firstSegment, `/${prefix}/${firstSegment}`);
    }
  });

  // File entries
  Object.keys(TERMINAL_FILES).forEach((fileKey) => {
    const file = TERMINAL_FILES[fileKey];
    const key = String(fileKey).replace(/^\/+/, "");

    if (!prefix) {
      const idx = key.indexOf("/");
      if (idx >= 0) {
        addDir(key.slice(0, idx), `/${key.slice(0, idx)}`);
      } else {
        addFile(key, `/${key}`, file);
      }
      return;
    }

    if (key === prefix) {
      addFile(key.split("/").pop(), `/${key}`, file);
      return;
    }

    if (key.startsWith(prefix + "/")) {
      const remainder = key.slice(prefix.length + 1);
      const parts = remainder.split("/");
      const name = parts[0];
      if (parts.length > 1) {
        addDir(name, `/${prefix}/${name}`);
      } else {
        addFile(name, `/${prefix}/${name}`, file);
      }
    }
  });

  // Top-level synthetic directories
  if (!prefix) {
    if (Object.keys(TERMINAL_ASSETS).length > 0) addDir("assets", "/assets");
    if (Object.keys(TERMINAL_SCRIPTS).length > 0) addDir("scripts", "/scripts");
  } else if (prefix === "assets") {
    Object.keys(TERMINAL_ASSETS).forEach((assetId) => {
      if (!entries.has(assetId))
        entries.set(assetId, { name: assetId, type: "asset", path: `/assets/${assetId}`, title: TERMINAL_ASSETS[assetId].title });
    });
  } else if (prefix.startsWith("assets/")) {
    const assetId = prefix.slice("assets/".length);
    const asset = TERMINAL_ASSETS[assetId];
    if (asset) {
      const name = assetId.split("/").pop();
      addFile(name, `/${prefix}`, asset);
      entries.get(name).type = "asset";
    }
  } else if (prefix === "scripts") {
    listScripts().forEach((script) => {
      if (!entries.has(script.id))
        entries.set(script.id, { name: script.id, type: "script", path: `/scripts/${script.id}`, title: script.title });
    });
  } else if (prefix.startsWith("scripts/")) {
    const scriptId = prefix.slice("scripts/".length);
    const script = getScript(scriptId);
    if (script) {
      const name = scriptId.split("/").pop();
      if (!entries.has(name)) entries.set(name, { name, type: "script", path: `/${prefix}`, title: script.title });
    }
  }

  // Convert to array sorted by type then name
  const result = Array.from(entries.values()).sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    if (a.type === "dir") return -1;
    if (b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    path: resolved,
    entries: result,
  };
}

function flattenVfsNode(node, currentPath, filesMap, assetsMap, directoriesSet) {
  if (!node) return;

  registerVirtualDirectory(directoriesSet, currentPath || "/");

  // node may be an object with 'children' or directly a map of children
  const children = node.children && typeof node.children === "object" ? node.children : node;

  Object.keys(children).forEach((name) => {
    const child = children[name];
    const childPath = posix.join(currentPath || "/", name);

    if (
      child &&
      typeof child === "object" &&
      (child.children ||
        child.kind === "directory" ||
        child.type === "directory" ||
        child.type === "dir" ||
        Object.keys(child).some(
          (k) => k !== "title" && k !== "type" && k !== "content" && k !== "src" && k !== "contentType" && k !== "alt",
        ))
    ) {
      // treat as directory-ish
      flattenVfsNode(child, childPath, filesMap, assetsMap, directoriesSet);
      return;
    }

    // Determine whether this is an asset or a file
    const rel = String(childPath).replace(/^\/+/, "");
    const pathParts = rel.split("/");
    const top = pathParts[0] || "";
    const isAsset = top === "assets" || child.type === "asset" || child.type === "image";

    if (isAsset) {
      const assetId = name.replace(/\.[^/.]+$/, "").toLowerCase();
      assetsMap[assetId] = {
        id: assetId,
        title: child.title || name,
        type: child.type || "image",
        alt: child.alt || null,
        src: child.src || (typeof child.content === "string" ? child.content : undefined),
        content: child.content,
        contentType: child.contentType || null,
      };
    } else {
      filesMap[rel] = {
        path: rel,
        title: child.title || name,
        type: child.type || "text",
        contentType: child.contentType || null,
        content: child.content || child.src || null,
        alt: child.alt || null,
        src: child.src || null,
      };
    }
  });
}

function loadPersistedTerminalData() {
  try {
    const dataDir = path.resolve(__dirname, "../../data/terminal");
    if (!fs.existsSync(dataDir)) return;

    // Scripts (backwards-compatible format)
    const scriptsFile = path.join(dataDir, "scripts.json");
    if (fs.existsSync(scriptsFile)) {
      const raw = fs.readFileSync(scriptsFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed) {
        if (Array.isArray(parsed)) {
          const map = {};
          parsed.forEach((s) => {
            if (s && s.id) map[s.id] = s;
          });
          TERMINAL_SCRIPTS = map;
        } else if (parsed.scripts && typeof parsed.scripts === "object") {
          TERMINAL_SCRIPTS = parsed.scripts;
        } else if (typeof parsed === "object") {
          TERMINAL_SCRIPTS = parsed;
        }
      }
      console.info(`[terminal.route] Loaded scripts from ${scriptsFile}`);
    }

    // Virtual FS (nested) — preferred if present
    const vfsFile = path.join(dataDir, "vfs.json");

    const newFiles = {};
    const newAssets = {};
    const newDirectories = new Set([""]);

    if (fs.existsSync(vfsFile)) {
      const raw = fs.readFileSync(vfsFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed) {
        flattenVfsNode(parsed, "/", newFiles, newAssets, newDirectories);
      }
      TERMINAL_FILES = newFiles;
      TERMINAL_DIRECTORIES = newDirectories;
      registerVirtualDirectory(TERMINAL_DIRECTORIES, "assets");
      registerVirtualDirectory(TERMINAL_DIRECTORIES, "scripts");
      TERMINAL_ASSETS = Object.keys(newAssets).length ? newAssets : TERMINAL_ASSETS;
      console.info(`[terminal.route] Loaded virtual FS from ${vfsFile}`);
    } else {
      // Fallback to legacy files.json format (flat map)
      const filesFile = path.join(dataDir, "files.json");
      if (fs.existsSync(filesFile)) {
        const raw = fs.readFileSync(filesFile, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed) {
          if (parsed.files && typeof parsed.files === "object") {
            TERMINAL_FILES = parsed.files;
          } else if (typeof parsed === "object") {
            TERMINAL_FILES = parsed;
          }
        }
        TERMINAL_DIRECTORIES = new Set([""]);
        Object.keys(TERMINAL_FILES).forEach((fileKey) => {
          const filePath = String(fileKey).replace(/^\/+/, "");
          const segments = filePath.split("/");
          segments.pop();
          let current = "";
          segments.forEach((segment) => {
            current = current ? `${current}/${segment}` : segment;
            registerVirtualDirectory(TERMINAL_DIRECTORIES, current);
          });
        });
        registerVirtualDirectory(TERMINAL_DIRECTORIES, "assets");
        registerVirtualDirectory(TERMINAL_DIRECTORIES, "scripts");
        console.info(`[terminal.route] Loaded files from ${filesFile}`);
      }
    }
  } catch (err) {
    console.warn("[terminal.route] Failed to load persisted terminal data:", err && err.message);
  }
}

// Initialize at module load
loadPersistedTerminalData();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildErrorResponse(res, statusCode, code, message, hint, details = {}) {
  return res.status(statusCode).json(
    formatResponseBody({
      error: {
        code,
        message,
        hint,
      },
      details,
    }),
  );
}

function buildCommandResult(result, message) {
  return {
    ok: true,
    result,
    message,
  };
}

function isExitPorkyCommand(parsed) {
  const commandName = String(parsed?.commandName || "")
    .trim()
    .toLowerCase();
  const firstArg = String(parsed?.args?.[0] || "")
    .trim()
    .toLowerCase();
  return commandName === "porky" && (firstArg === "exit" || firstArg === "quit");
}

function getScript(scriptId) {
  return (
    TERMINAL_SCRIPTS[
      String(scriptId || "")
        .trim()
        .toLowerCase()
    ] || null
  );
}

function getAsset(assetId) {
  return (
    TERMINAL_ASSETS[
      String(assetId || "")
        .trim()
        .toLowerCase()
    ] || null
  );
}

function getFile(filePath) {
  return (
    TERMINAL_FILES[
      String(filePath || "")
        .trim()
        .replace(/^\/+/, "")
    ] || null
  );
}

function listScripts() {
  // Return a minimal script summary for listing purposes.
  // Avoid including step-level metadata (delayMs, metadata) or script.options
  return Object.values(TERMINAL_SCRIPTS).map((script) => ({
    id: script.id,
    title: script.title,
    description: script.description || "",
    type: script.type || "script",
    stepCount: Array.isArray(script.steps) ? script.steps.length : 0,
  }));
}

function listAssets() {
  return Object.values(TERMINAL_ASSETS).map((asset) => ({
    id: asset.id,
    title: asset.title,
    type: asset.type,
    alt: asset.alt,
  }));
}

function listFiles() {
  return Object.values(TERMINAL_FILES).map((file) => ({
    path: file.path,
    title: file.title,
    type: file.type,
    contentType: file.contentType,
  }));
}

function buildScriptResponse(script) {
  return {
    id: script.id,
    title: script.title,
    description: script.description,
    type: "script",
    tags: clone(script.tags || []),
    author: clone(script.author || {}),
    version: script.version || "1.0",
    options: clone(script.options || {}),
    stepCount: Array.isArray(script.steps) ? script.steps.length : 0,
    steps: clone(script.steps || []),
    items: clone(script.steps || []),
  };
}

function buildAssetResponse(asset) {
  return clone(asset);
}

function buildFileResponse(file) {
  return clone(file);
}

function searchCatalog(query) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return [];

  const matches = [];

  listScripts().forEach((item) => {
    if (item.id.includes(needle) || item.title.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)) {
      matches.push({ kind: "script", ...item });
    }
  });

  listAssets().forEach((item) => {
    if (item.id.includes(needle) || item.title.toLowerCase().includes(needle)) {
      matches.push({ kind: "asset", ...item });
    }
  });

  listFiles().forEach((item) => {
    if (item.path.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)) {
      matches.push({ kind: "file", ...item });
    }
  });

  return matches;
}

function buildExecuteResult(commandName, args, flags, sessionId) {
  const target = args.join(" ").trim();

  switch (commandName) {
    case "pwd": {
      const cwd = getSessionPath(sessionId);
      return buildCommandResult({ type: "text", content: cwd, metadata: { path: cwd } }, cwd);
    }

    case "cd": {
      const dest = target || "/";
      const resolved = resolvePathForSession(sessionId, dest);

      const prefix = stripLeadingSlash(resolved).replace(/\/$/, "");
      const existsAsFile = !!TERMINAL_FILES[prefix] || !!TERMINAL_ASSETS[prefix] || !!TERMINAL_SCRIPTS[prefix];
      const existsAsDir = prefix === "" || TERMINAL_DIRECTORIES.has(prefix) || prefix === "assets" || prefix === "scripts";

      if (existsAsFile && !existsAsDir) {
        return {
          error: {
            code: "NOT_A_DIRECTORY",
            message: `Not a directory: ${dest}`,
            hint: 'Use "cat <file>" or "open <asset>" to view files.',
          },
        };
      }

      if (!existsAsFile && !existsAsDir && prefix !== "") {
        return {
          error: {
            code: "NO_SUCH_DIRECTORY",
            message: `No such file or directory: ${dest}`,
            hint: 'Try "ls" to see nearby files.',
          },
        };
      }

      const newPath = setSessionPath(sessionId, resolved);
      return buildCommandResult(
        { type: "text", content: `Changed directory to ${newPath}`, metadata: { path: newPath } },
        `Changed directory to ${newPath}`,
      );
    }

    case "ls": {
      const listTarget = target || ".";
      const listing = listDirectoryEntries(sessionId, listTarget);
      const lines = listing.entries.length
        ? listing.entries
            .map((entry) => {
              const suffix = entry.type === "dir" ? "/" : "";
              return `${entry.name}${suffix}`;
            })
            .join("\n")
        : "(empty)";

      return buildCommandResult(
        {
          type: "text",
          content: lines,
          metadata: {
            kind: "listing",
            path: listing.path,
            rows: listing.entries,
          },
        },
        `Listed ${listing.path}`,
      );
    }

    case "tree": {
      const treeTarget = target || ".";
      const start = resolvePathForSession(sessionId, treeTarget);

      function buildNode(p, depth) {
        if (depth < 0) return [];
        const listing = listDirectoryEntries(sessionId, p);
        const lines = [];
        listing.entries.forEach((entry) => {
          lines.push(`${p}/${entry.name}`.replace(/\/+/g, "/"));
          if (entry.type === "dir" || entry.type === "scripts" || entry.type === "assets") {
            lines.push(...buildNode(posix.join(p, entry.name), depth - 1));
          }
        });
        return lines;
      }

      const treeLines = buildNode(start, Number(flags.depth || flags.d || 2));
      return buildCommandResult({ type: "text", content: treeLines.join("\n") }, `Tree for ${start}`);
    }
    case "run": {
      const script = getScript(target || "boot-sequence");
      if (!script) {
        return {
          error: {
            code: "SCRIPT_NOT_FOUND",
            message: `Unknown script: ${target}`,
            hint: 'Try "list scripts" to see available scripts.',
          },
        };
      }

      return buildCommandResult(buildScriptResponse(script), `Script ${script.id} loaded`);
    }

    case "open":
    case "cat": {
      const asset = getAsset(target);
      if (asset) {
        return buildCommandResult(buildAssetResponse(asset), `Asset ${asset.id} loaded`);
      }

      const file = getFile(target);
      if (file) {
        return buildCommandResult(buildFileResponse(file), `File ${file.path} loaded`);
      }

      return {
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: `Unable to open ${target}`,
          hint: 'Try "list assets" or "list files".',
        },
      };
    }

    case "list": {
      const subject = String(args[0] || "")
        .trim()
        .toLowerCase();

      if (subject === "scripts") {
        return buildCommandResult({ scripts: listScripts() }, "Scripts listed");
      }

      if (subject === "assets") {
        return buildCommandResult({ assets: listAssets() }, "Assets listed");
      }

      if (subject === "files") {
        return buildCommandResult({ files: listFiles() }, "Files listed");
      }

      return {
        error: {
          code: "LIST_TARGET_REQUIRED",
          message: "Usage: list <scripts|files|assets>",
          hint: "Example: list scripts",
        },
      };
    }

    case "inspect": {
      const script = getScript(target);
      if (script) {
        return buildCommandResult({ kind: "script", script: buildScriptResponse(script) }, `Inspected ${script.id}`);
      }

      const asset = getAsset(target);
      if (asset) {
        return buildCommandResult({ kind: "asset", asset: buildAssetResponse(asset) }, `Inspected ${asset.id}`);
      }

      const file = getFile(target);
      if (file) {
        return buildCommandResult({ kind: "file", file: buildFileResponse(file) }, `Inspected ${file.path}`);
      }

      return {
        error: {
          code: "OBJECT_NOT_FOUND",
          message: `Unable to inspect ${target}`,
          hint: 'Try "search <query>" or "list scripts".',
        },
      };
    }

    case "search": {
      const results = searchCatalog(target);
      return buildCommandResult(
        {
          query: target,
          resultCount: results.length,
          results,
        },
        `Search completed with ${results.length} result(s)`,
      );
    }

    case "mission": {
      const script = getScript(target || "intro");
      if (!script) {
        return {
          error: {
            code: "MISSION_NOT_FOUND",
            message: `Unknown mission: ${target}`,
            hint: 'Try "list scripts" to see available missions.',
          },
        };
      }

      return buildCommandResult(buildScriptResponse(script), `Mission ${script.id} loaded`);
    }

    case "login": {
      const script = getScript("login-sequence");
      return buildCommandResult(buildScriptResponse(script), "Login sequence loaded");
    }

    case "sync": {
      // Reload persisted data from disk when asked to sync
      try {
        loadPersistedTerminalData();
      } catch (err) {
        return {
          error: {
            code: "SYNC_FAILED",
            message: "Failed to reload terminal data",
            hint: "Check server logs for details.",
          },
        };
      }

      return buildCommandResult(
        {
          commands: TERMINAL_COMMANDS,
          scripts: listScripts(),
          assets: listAssets(),
          files: listFiles(),
          sessionId,
        },
        "Terminal metadata synchronized (reloaded from disk)",
      );
    }

    default:
      return {
        error: {
          code: "UNKNOWN_COMMAND",
          message: `Unknown command: ${commandName}`,
          hint: 'Type "help" to see available commands.',
        },
      };
  }
}

router.get("/terminal", (req, res) => {
  sendSuccess(req, res, {
    pageUrl: "/operator/terminal.html",
    prompt: "guest@archive:~$",
    prototype: true,
    bootSequence: BOOT_SEQUENCE,
    commands: TERMINAL_COMMANDS,
    terminal: {
      name: "Archive Terminal",
      version: "0.1.0",
      description: "Retro terminal interface for archive inspection",
    },
  });
});

router.get("/terminal/bootstrap", (req, res) => {
  sendSuccess(req, res, {
    id: "static-terminal-bootstrap",
    title: "Static Terminal Bootstrap",
    steps: STATIC_BOOT_STEPS,
    bootSequence: BOOT_SEQUENCE,
    commands: TERMINAL_COMMANDS,
  });
});

router.get("/terminal/commands", (req, res) => {
  sendSuccess(req, res, {
    commands: TERMINAL_COMMANDS,
  });
});

// Reload persisted terminal data from disk on demand
router.post("/terminal/sync", apiLimiter, express.json(), (req, res) => {
  try {
    loadPersistedTerminalData();
    return sendSuccess(
      req,
      res,
      {
        synced: true,
        scripts: listScripts(),
        assets: listAssets(),
        files: listFiles(),
      },
      "Terminal data reloaded from disk",
    );
  } catch (err) {
    return buildErrorResponse(res, 500, "SYNC_FAILED", err.message || "Failed to reload terminal data", "Check server logs for details.");
  }
});

router.post("/terminal/execute", express.json(), (req, res) => {
  const input = String(req.body?.input || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim() || "anonymous-session";

  if (!input) {
    return buildErrorResponse(res, 400, "EMPTY_INPUT", "Command input is required.", 'Type a command like "help" or "list scripts".');
  }

  const parsed = parseTerminalInput(input);
  if (!parsed.commandName) {
    return buildErrorResponse(
      res,
      400,
      "INVALID_COMMAND",
      `Unable to parse command: ${input}`,
      "Try wrapping multi-word arguments in quotes.",
    );
  }

  const execution = buildExecuteResult(parsed.commandName, parsed.args, parsed.flags, sessionId);

  if (execution.error) {
    return buildErrorResponse(
      res,
      404,
      execution.error.code || "COMMAND_FAILED",
      execution.error.message || "Command failed",
      execution.error.hint || 'Type "help" to see available commands.',
      {
        input,
        commandName: parsed.commandName,
      },
    );
  }

  return sendSuccess(
    req,
    res,
    {
      sessionId,
      input,
      commandName: parsed.commandName,
      args: parsed.args,
      flags: parsed.flags,
      ...execution,
    },
    `Executed ${parsed.commandName}`,
  );
});

router.post("/terminal/porky/start", apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || req.body?.context?.sessionId || "").trim();
    const data = await porkyService.startConversation({
      sessionId,
      context: req.body?.context || {},
    });

    return sendSuccess(req, res, data, "Porky session started");
  } catch (error) {
    return buildErrorResponse(
      res,
      400,
      "PORKY_START_FAILED",
      error.message || "Unable to start Porky session",
      'Try "porky" again or use a simpler prompt.',
    );
  }
});

router.post("/terminal/porky/message", apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || req.body?.context?.sessionId || "").trim();
    const data = await porkyService.sendMessage({
      sessionId,
      message: req.body?.message,
      context: req.body?.context || {},
    });

    return sendSuccess(req, res, data, "Porky message processed");
  } catch (error) {
    return buildErrorResponse(
      res,
      400,
      "PORKY_MESSAGE_FAILED",
      error.message || "Unable to process Porky message",
      'Try a shorter message or type "porky exit" to leave Porky mode.',
    );
  }
});

router.post("/terminal/porky/status", apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || req.body?.context?.sessionId || "").trim();
    const data = await porkyService.getStatus({
      sessionId,
      context: req.body?.context || {},
    });

    return sendSuccess(req, res, data, "Porky status ready");
  } catch (error) {
    return buildErrorResponse(
      res,
      400,
      "PORKY_STATUS_FAILED",
      error.message || "Unable to fetch Porky status",
      'Try "porky status" again.',
    );
  }
});

router.post("/terminal/porky/end", apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || req.body?.context?.sessionId || "").trim();
    const data = await porkyService.endConversation({
      sessionId,
      context: req.body?.context || {},
    });

    return sendSuccess(req, res, data, "Porky session ended");
  } catch (error) {
    return buildErrorResponse(res, 400, "PORKY_END_FAILED", error.message || "Unable to end Porky session", 'Try "porky exit" again.');
  }
});

router.get("/terminal/scripts", (req, res) => {
  sendSuccess(req, res, {
    scripts: listScripts(),
  });
});

router.get("/terminal/scripts/:scriptId", (req, res) => {
  const script = getScript(req.params.scriptId);
  if (!script) {
    return buildErrorResponse(
      res,
      404,
      "SCRIPT_NOT_FOUND",
      `Unknown script: ${req.params.scriptId}`,
      'Try "list scripts" to see available scripts.',
    );
  }

  return sendSuccess(req, res, buildScriptResponse(script));
});

router.get("/terminal/assets", (req, res) => {
  sendSuccess(req, res, {
    assets: listAssets(),
  });
});

router.get("/terminal/assets/:assetId", (req, res) => {
  const asset = getAsset(req.params.assetId);
  if (!asset) {
    return buildErrorResponse(
      res,
      404,
      "ASSET_NOT_FOUND",
      `Unknown asset: ${req.params.assetId}`,
      'Try "list assets" to see available assets.',
    );
  }

  return sendSuccess(req, res, buildAssetResponse(asset));
});

router.get("/terminal/files", (req, res) => {
  sendSuccess(req, res, {
    files: listFiles(),
  });
});

router.get("/terminal/files/*", (req, res) => {
  const requestedPath = decodeURIComponent(req.params[0] || "");
  const file = getFile(requestedPath);

  if (!file) {
    return buildErrorResponse(res, 404, "FILE_NOT_FOUND", `Unknown file: ${requestedPath}`, 'Try "list files" to see available files.');
  }

  return sendSuccess(req, res, buildFileResponse(file));
});

module.exports = router;
