const { randomUUID } = require("crypto");
const { logInfo } = require("../helpers/logger-api");
const { FARMER_TAPE_LIBRARY, FARMER_TAPE_SORT_OPTIONS } = require("../data/farmer-tape-recordings.data");

const DEFAULT_SESSION_ID = "default";
const DEFAULT_SORT = "story";
const HISTORY_LIMIT = 12;
const CABINET_ROOT_LABEL = "Field Archive";

const ACTION_ALIASES = new Map([
  ["selecttape", "selectTape"],
  ["open", "selectTape"],
  ["choose", "selectTape"],
  ["playnext", "playNext"],
  ["next", "playNext"],
  ["advance", "playNext"],
  ["investigate", "playNext"],
  ["revisitfragment", "revisitFragment"],
  ["fragment", "revisitFragment"],
  ["focus", "revisitFragment"],
  ["setsort", "setSort"],
  ["sort", "setSort"],
  ["resetsession", "resetSession"],
  ["reset", "resetSession"],
]);

const SORT_ALIASES = new Map([
  ["story", "story"],
  ["order", "story"],
  ["newest", "newest"],
  ["latest", "newest"],
  ["oldest", "oldest"],
  ["title", "title"],
  ["alphabetical", "title"],
  ["unlocked", "unlocked"],
  ["available", "unlocked"],
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text.length > 0 ? text : fallback;
}

function slugify(value, fallback = "item") {
  const normalized = normalizeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function normalizeSessionId(sessionId) {
  return normalizeString(sessionId, DEFAULT_SESSION_ID);
}

function normalizeCabinetPath(pathSegments = []) {
  const normalizedPath = Array.isArray(pathSegments) ? pathSegments.map((segment) => normalizeString(segment)).filter(Boolean) : [];

  if (normalizedPath[0] === CABINET_ROOT_LABEL) {
    return normalizedPath;
  }

  return [CABINET_ROOT_LABEL, ...normalizedPath];
}

function normalizeActionName(action) {
  const key = normalizeString(action)
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
  return ACTION_ALIASES.get(key) || null;
}

function normalizeSortName(sortName) {
  const key = normalizeString(sortName, DEFAULT_SORT)
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
  return SORT_ALIASES.get(key) || DEFAULT_SORT;
}

function createToken() {
  return typeof randomUUID === "function" ? randomUUID() : `tape-token-${Date.now()}-${Math.random()}`;
}

class FarmerTapeRecorderService {
  constructor() {
    this.library = this._normalizeLibrary(FARMER_TAPE_LIBRARY);
    this.tapeById = new Map(this.library.map((tape) => [tape.id, tape]));
    this.sortOptions = clone(FARMER_TAPE_SORT_OPTIONS);
    this.sessions = new Map();
  }

  _normalizeLibrary(library = []) {
    return library
      .map((tape, tapeIndex) => {
        const tapeId = normalizeString(tape.id, `tape-${tapeIndex + 1}`);
        const fragments = Array.isArray(tape.fragments)
          ? tape.fragments.map((fragment, fragmentIndex) => ({
              id: normalizeString(fragment.id, `${tapeId}-fragment-${fragmentIndex + 1}`),
              marker: normalizeString(fragment.marker, `00:${String(fragmentIndex + 1).padStart(2, "0")}`),
              title: normalizeString(fragment.title, `Fragment ${fragmentIndex + 1}`),
              excerpt: normalizeString(fragment.excerpt),
              mood: normalizeString(fragment.mood, "neutral"),
              partNumber: fragmentIndex + 1,
              evidence: Array.isArray(fragment.evidence) ? fragment.evidence.map((item) => String(item)) : [],
              transcript: Array.isArray(fragment.transcript) ? fragment.transcript.map((item) => String(item)) : [],
              note: normalizeString(fragment.note),
            }))
          : [];

        return {
          id: tapeId,
          order: Number.isFinite(Number(tape.order)) ? Number(tape.order) : tapeIndex + 1,
          title: normalizeString(tape.title, tapeId),
          cabinetPath: normalizeCabinetPath(tape.cabinetPath),
          recordedAt: normalizeString(tape.recordedAt),
          season: normalizeString(tape.season),
          location: normalizeString(tape.location),
          tags: Array.isArray(tape.tags) ? tape.tags.map((item) => String(item)) : [],
          summary: normalizeString(tape.summary),
          hook: normalizeString(tape.hook),
          lockedHint: normalizeString(tape.lockedHint, "Investigate earlier tapes to unlock this recording."),
          unlock: {
            requiresCompleted: Array.isArray(tape.unlock?.requiresCompleted)
              ? tape.unlock.requiresCompleted.map((item) => String(item))
              : [],
          },
          fragments,
        };
      })
      .sort((left, right) => left.order - right.order);
  }

  _createEmptySession(sessionId) {
    return {
      id: sessionId,
      revision: 0,
      sort: DEFAULT_SORT,
      activeTapeId: null,
      progress: {},
      currentFragmentByTape: {},
      advanceToken: null,
      events: [],
    };
  }

  _getSessionContext(sessionId = DEFAULT_SESSION_ID) {
    const key = normalizeSessionId(sessionId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, this._createEmptySession(key));
    }

    return this.sessions.get(key);
  }

  _createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  _ensureProgress(context, tapeId) {
    if (!context.progress[tapeId]) {
      context.progress[tapeId] = {
        discoveredIds: [],
        completedAt: null,
      };
    }

    return context.progress[tapeId];
  }

  _isTapeCompleted(context, tapeId) {
    const tape = this.tapeById.get(tapeId);
    if (!tape) {
      return false;
    }

    const progress = this._ensureProgress(context, tapeId);
    return progress.discoveredIds.length >= tape.fragments.length;
  }

  _isTapeUnlocked(context, tape) {
    const requirements = Array.isArray(tape?.unlock?.requiresCompleted) ? tape.unlock.requiresCompleted : [];
    return requirements.every((requiredTapeId) => this._isTapeCompleted(context, requiredTapeId));
  }

  _getUnlockRequirements(tape) {
    return (Array.isArray(tape?.unlock?.requiresCompleted) ? tape.unlock.requiresCompleted : [])
      .map((requiredTapeId) => {
        const requiredTape = this.tapeById.get(requiredTapeId);
        return {
          id: requiredTapeId,
          title: requiredTape?.title || requiredTapeId,
        };
      })
      .filter(Boolean);
  }

  _getUnlockedTapeIds(context) {
    return this.library.filter((tape) => this._isTapeUnlocked(context, tape)).map((tape) => tape.id);
  }

  _primeContext(context) {
    const activeTape = this.tapeById.get(context.activeTapeId);
    if (!activeTape || !this._isTapeUnlocked(context, activeTape)) {
      context.activeTapeId = null;
      context.advanceToken = null;
      return;
    }

    this._syncAdvanceToken(context, activeTape.id);
  }

  _issueAdvanceToken(context, tapeId) {
    const token = {
      value: createToken(),
      tapeId,
      issuedAt: new Date().toISOString(),
    };

    context.advanceToken = token;
    return token.value;
  }

  _syncAdvanceToken(context, tapeId) {
    const tape = this.tapeById.get(tapeId);
    if (!tape || !this._isTapeUnlocked(context, tape)) {
      context.advanceToken = null;
      return null;
    }

    const progress = this._ensureProgress(context, tape.id);
    const complete = progress.discoveredIds.length >= tape.fragments.length;
    if (complete) {
      context.advanceToken = null;
      return null;
    }

    if (context.advanceToken?.tapeId === tape.id && normalizeString(context.advanceToken.value)) {
      return context.advanceToken.value;
    }

    return this._issueAdvanceToken(context, tape.id);
  }

  _consumeAdvanceToken(context, tapeId, token) {
    const expectedToken = normalizeString(context.advanceToken?.value);
    const providedToken = normalizeString(token);
    if (!expectedToken || context.advanceToken?.tapeId !== tapeId || expectedToken !== providedToken) {
      throw this._createError("Tape advance token expired. Re-open the tape and continue from the cabinet.", 409);
    }

    context.advanceToken = null;
  }

  _recordEvent(context, type, details = {}) {
    context.revision += 1;
    const event = {
      revision: context.revision,
      type,
      details: clone(details),
      occurredAt: new Date().toISOString(),
    };

    context.events = [event, ...context.events].slice(0, HISTORY_LIMIT);
    return event;
  }

  _buildFragmentSummary(fragment, tape, isCurrent = false) {
    return {
      id: fragment.id,
      marker: fragment.marker,
      title: fragment.title,
      excerpt: fragment.excerpt,
      mood: fragment.mood,
      partNumber: fragment.partNumber,
      totalParts: tape?.fragments?.length || 0,
      evidence: clone(fragment.evidence),
      current: isCurrent,
    };
  }

  _buildFragmentPayload(fragment, tape) {
    return {
      id: fragment.id,
      marker: fragment.marker,
      title: fragment.title,
      excerpt: fragment.excerpt,
      mood: fragment.mood,
      partNumber: fragment.partNumber,
      totalParts: tape?.fragments?.length || 0,
      evidence: clone(fragment.evidence),
      transcript: clone(fragment.transcript),
      note: fragment.note,
    };
  }

  _buildCabinetTape(context, tape) {
    const progress = this._ensureProgress(context, tape.id);
    const unlocked = this._isTapeUnlocked(context, tape);
    const completed = progress.discoveredIds.length >= tape.fragments.length;
    const status = !unlocked ? "locked" : completed ? "completed" : progress.discoveredIds.length > 0 ? "in-progress" : "unopened";

    return {
      id: tape.id,
      order: tape.order,
      title: tape.title,
      cabinetPath: clone(tape.cabinetPath || []),
      recordedAt: tape.recordedAt,
      season: tape.season,
      location: tape.location,
      tags: clone(tape.tags),
      summary: unlocked ? tape.summary : tape.lockedHint,
      hook: unlocked ? tape.hook : "Complete the earlier recordings before forcing this cabinet slot.",
      locked: !unlocked,
      status,
      discoveredFragments: progress.discoveredIds.length,
      totalFragments: tape.fragments.length,
      unlock: unlocked
        ? null
        : {
            requiresCompleted: this._getUnlockRequirements(tape),
          },
    };
  }

  _sortTapes(context, sortName = DEFAULT_SORT) {
    const normalizedSort = normalizeSortName(sortName);
    const tapes = this.library.slice();

    if (normalizedSort === "newest") {
      return tapes.sort((left, right) => {
        const leftTime = new Date(left.recordedAt).getTime() || 0;
        const rightTime = new Date(right.recordedAt).getTime() || 0;
        return rightTime - leftTime || left.order - right.order;
      });
    }

    if (normalizedSort === "oldest") {
      return tapes.sort((left, right) => {
        const leftTime = new Date(left.recordedAt).getTime() || 0;
        const rightTime = new Date(right.recordedAt).getTime() || 0;
        return leftTime - rightTime || left.order - right.order;
      });
    }

    if (normalizedSort === "title") {
      return tapes.sort((left, right) => left.title.localeCompare(right.title) || left.order - right.order);
    }

    if (normalizedSort === "unlocked") {
      return tapes.sort((left, right) => {
        const leftUnlocked = this._isTapeUnlocked(context, left) ? 0 : 1;
        const rightUnlocked = this._isTapeUnlocked(context, right) ? 0 : 1;
        if (leftUnlocked !== rightUnlocked) {
          return leftUnlocked - rightUnlocked;
        }

        const leftProgress = this._ensureProgress(context, left.id).discoveredIds.length;
        const rightProgress = this._ensureProgress(context, right.id).discoveredIds.length;
        if (leftProgress !== rightProgress) {
          return rightProgress - leftProgress;
        }

        return left.order - right.order;
      });
    }

    return tapes.sort((left, right) => left.order - right.order);
  }

  _sortCabinetEntryChildren(children = [], tapeSortOrder = new Map()) {
    children.sort((left, right) => {
      if (left.type === right.type) {
        if (left.type === "folder") {
          return String(left.label || "").localeCompare(String(right.label || ""));
        }

        return (tapeSortOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (tapeSortOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      }

      return left.type === "folder" ? -1 : 1;
    });

    children.forEach((child) => {
      if (child.type === "folder") {
        this._sortCabinetEntryChildren(child.children || [], tapeSortOrder);
      }
    });

    return children;
  }

  _decorateFolderNode(folderNode) {
    const childFolders = [];
    let tapeCount = 0;
    let unlockedTapes = 0;
    let discoveredFragments = 0;
    let totalFragments = 0;

    (folderNode.children || []).forEach((child) => {
      if (child.type === "folder") {
        const nested = this._decorateFolderNode(child);
        childFolders.push(nested);
        tapeCount += nested.tapeCount;
        unlockedTapes += nested.unlockedTapes;
        discoveredFragments += nested.discoveredFragments;
        totalFragments += nested.totalFragments;
        return;
      }

      tapeCount += 1;
      unlockedTapes += child.locked === true ? 0 : 1;
      discoveredFragments += Number(child.discoveredFragments) || 0;
      totalFragments += Number(child.totalFragments) || 0;
    });

    folderNode.tapeCount = tapeCount;
    folderNode.unlockedTapes = unlockedTapes;
    folderNode.discoveredFragments = discoveredFragments;
    folderNode.totalFragments = totalFragments;
    folderNode.folderCount = childFolders.length;
    return folderNode;
  }

  _buildCabinetEntries(context) {
    const sortedTapes = this._sortTapes(context, context.sort);
    const tapeSortOrder = new Map(sortedTapes.map((tape, index) => [tape.id, index]));
    const rootEntries = [];
    const folderMap = new Map();

    const ensureFolder = (segments = []) => {
      let children = rootEntries;
      let pathKey = "";

      segments.forEach((segment, index) => {
        const slug = slugify(segment, `folder-${index + 1}`);
        pathKey = pathKey ? `${pathKey}/${slug}` : slug;

        if (!folderMap.has(pathKey)) {
          const folderNode = {
            type: "folder",
            id: `folder-${pathKey}`,
            label: segment,
            path: segments.slice(0, index + 1),
            children: [],
            depth: index,
          };

          folderMap.set(pathKey, folderNode);
          children.push(folderNode);
        }

        children = folderMap.get(pathKey).children;
      });

      return children;
    };

    sortedTapes.forEach((tape) => {
      const tapeEntry = {
        type: "tape",
        depth: Array.isArray(tape.cabinetPath) ? tape.cabinetPath.length : 0,
        ...this._buildCabinetTape(context, tape),
      };

      const targetChildren = ensureFolder(tape.cabinetPath || []);
      targetChildren.push(tapeEntry);
    });

    this._sortCabinetEntryChildren(rootEntries, tapeSortOrder);
    rootEntries.forEach((entry) => {
      if (entry.type === "folder") {
        this._decorateFolderNode(entry);
      }
    });

    return {
      entries: rootEntries,
      totalDirectories: Array.from(folderMap.values()).length,
    };
  }

  _buildCurrentTape(context) {
    const tape = this.tapeById.get(context.activeTapeId);
    if (!tape || !this._isTapeUnlocked(context, tape)) {
      return null;
    }

    const progress = this._ensureProgress(context, tape.id);
    const discoveredIds = progress.discoveredIds.slice();
    const complete = discoveredIds.length >= tape.fragments.length;
    const currentFragmentId = discoveredIds.includes(context.currentFragmentByTape[tape.id])
      ? context.currentFragmentByTape[tape.id]
      : discoveredIds[discoveredIds.length - 1] || null;

    if (currentFragmentId) {
      context.currentFragmentByTape[tape.id] = currentFragmentId;
    }

    const currentFragment = currentFragmentId ? tape.fragments.find((fragment) => fragment.id === currentFragmentId) : null;
    const advanceToken = complete ? null : this._syncAdvanceToken(context, tape.id);

    return {
      id: tape.id,
      title: tape.title,
      cabinetPath: clone(tape.cabinetPath || []),
      recordedAt: tape.recordedAt,
      season: tape.season,
      location: tape.location,
      tags: clone(tape.tags),
      summary: tape.summary,
      hook: tape.hook,
      progress: {
        discoveredFragments: discoveredIds.length,
        totalFragments: tape.fragments.length,
        completed: complete,
        percent: tape.fragments.length > 0 ? Math.round((discoveredIds.length / tape.fragments.length) * 100) : 0,
      },
      currentFragment: currentFragment ? this._buildFragmentPayload(currentFragment, tape) : null,
      discoveredFragments: discoveredIds
        .map((fragmentId) => tape.fragments.find((fragment) => fragment.id === fragmentId))
        .filter(Boolean)
        .map((fragment) => this._buildFragmentSummary(fragment, tape, fragment.id === currentFragmentId)),
      controls: {
        canAdvance: complete === false,
        advanceToken,
      },
    };
  }

  _buildSnapshot(context) {
    const cabinetTapes = this._sortTapes(context, context.sort).map((tape) => this._buildCabinetTape(context, tape));
    const cabinetTree = this._buildCabinetEntries(context);
    return {
      revision: context.revision,
      page: {
        title: "Farmer's Tape Recorder",
        subtitle: "Investigate one fragment at a time. The recorder prefers careful listeners.",
      },
      cabinet: {
        sort: context.sort,
        sortOptions: clone(this.sortOptions),
        totalTapes: cabinetTapes.length,
        unlockedTapes: cabinetTapes.filter((tape) => tape.locked !== true).length,
        totalDirectories: cabinetTree.totalDirectories,
        entries: cabinetTree.entries,
        tapes: cabinetTapes,
      },
      currentTape: this._buildCurrentTape(context),
      activity: clone(context.events),
    };
  }

  getSnapshot(options = {}) {
    const context = this._getSessionContext(options.sessionId);
    this._primeContext(context);
    return this._buildSnapshot(context);
  }

  selectTape(payload = {}, options = {}) {
    const context = this._getSessionContext(options.sessionId);
    this._primeContext(context);

    const tapeId = normalizeString(payload.tapeId);
    const tape = this.tapeById.get(tapeId);
    if (!tape) {
      throw this._createError(`Unknown tape: ${tapeId || "unknown"}`, 404);
    }

    if (!this._isTapeUnlocked(context, tape)) {
      const requirements = this._getUnlockRequirements(tape)
        .map((item) => item.title)
        .join(", ");
      throw this._createError(`Tape locked. Complete earlier recordings first: ${requirements}.`, 403);
    }

    context.activeTapeId = tape.id;
    const progress = this._ensureProgress(context, tape.id);
    if (!context.currentFragmentByTape[tape.id] && progress.discoveredIds.length > 0) {
      context.currentFragmentByTape[tape.id] = progress.discoveredIds[progress.discoveredIds.length - 1];
    }

    this._syncAdvanceToken(context, tape.id);

    const event = this._recordEvent(context, "tapeSelected", {
      tapeId: tape.id,
      title: tape.title,
      message: `Tape ready: ${tape.title}.`,
    });

    return {
      action: "selectTape",
      snapshot: this._buildSnapshot(context),
      event,
      message: event.details.message,
    };
  }

  playNext(payload = {}, options = {}) {
    const context = this._getSessionContext(options.sessionId);
    this._primeContext(context);

    const tapeId = normalizeString(payload.tapeId, context.activeTapeId);
    const tape = this.tapeById.get(tapeId);
    if (!tape) {
      throw this._createError(`Unknown tape: ${tapeId || "unknown"}`, 404);
    }

    if (!this._isTapeUnlocked(context, tape)) {
      throw this._createError(`Tape locked. Complete earlier recordings before investigating ${tape.title}.`, 403);
    }

    context.activeTapeId = tape.id;
    const progress = this._ensureProgress(context, tape.id);
    if (progress.discoveredIds.length >= tape.fragments.length) {
      throw this._createError(`All fragments already recovered for ${tape.title}.`, 409);
    }

    this._consumeAdvanceToken(context, tape.id, payload.token);

    const fragment = tape.fragments[progress.discoveredIds.length];
    progress.discoveredIds.push(fragment.id);
    context.currentFragmentByTape[tape.id] = fragment.id;

    const completed = progress.discoveredIds.length >= tape.fragments.length;
    if (completed) {
      progress.completedAt = new Date().toISOString();
    }

    const newlyUnlockedTape = completed
      ? this.library.find((candidate) => {
          if (candidate.id === tape.id) {
            return false;
          }
          const requirements = Array.isArray(candidate.unlock?.requiresCompleted) ? candidate.unlock.requiresCompleted : [];
          return requirements.includes(tape.id) && this._isTapeUnlocked(context, candidate);
        })
      : null;

    this._syncAdvanceToken(context, tape.id);

    const message = completed
      ? `Tape completed: ${tape.title}.${newlyUnlockedTape ? ` New evidence unlocked: ${newlyUnlockedTape.title}.` : ""}`
      : `Recovered fragment ${progress.discoveredIds.length}/${tape.fragments.length} from ${tape.title}.`;

    const event = this._recordEvent(context, "fragmentRevealed", {
      tapeId: tape.id,
      title: tape.title,
      fragmentId: fragment.id,
      marker: fragment.marker,
      discoveredFragments: progress.discoveredIds.length,
      totalFragments: tape.fragments.length,
      completed,
      unlockedTapeId: newlyUnlockedTape?.id || null,
      unlockedTapeTitle: newlyUnlockedTape?.title || null,
      message,
    });

    if (completed) {
      logInfo("Farmer tape completed", {
        sessionId: context.id,
        tapeId: tape.id,
        unlockedTapeId: newlyUnlockedTape?.id || null,
      });
    }

    return {
      action: "playNext",
      snapshot: this._buildSnapshot(context),
      event,
      message,
    };
  }

  revisitFragment(payload = {}, options = {}) {
    const context = this._getSessionContext(options.sessionId);
    this._primeContext(context);

    const tapeId = normalizeString(payload.tapeId, context.activeTapeId);
    const tape = this.tapeById.get(tapeId);
    if (!tape) {
      throw this._createError(`Unknown tape: ${tapeId || "unknown"}`, 404);
    }

    if (!this._isTapeUnlocked(context, tape)) {
      throw this._createError(`Tape locked. Complete earlier recordings before opening ${tape.title}.`, 403);
    }

    const fragmentId = normalizeString(payload.fragmentId);
    const progress = this._ensureProgress(context, tape.id);
    if (!progress.discoveredIds.includes(fragmentId)) {
      throw this._createError("That fragment has not been recovered in this session yet.", 404);
    }

    const fragment = tape.fragments.find((item) => item.id === fragmentId);
    if (!fragment) {
      throw this._createError(`Unknown fragment: ${fragmentId || "unknown"}`, 404);
    }

    context.activeTapeId = tape.id;
    context.currentFragmentByTape[tape.id] = fragment.id;
    this._syncAdvanceToken(context, tape.id);

    const event = this._recordEvent(context, "fragmentFocused", {
      tapeId: tape.id,
      title: tape.title,
      fragmentId: fragment.id,
      marker: fragment.marker,
      message: `Focused fragment ${fragment.marker} from ${tape.title}.`,
    });

    return {
      action: "revisitFragment",
      snapshot: this._buildSnapshot(context),
      event,
      message: event.details.message,
    };
  }

  setSort(payload = {}, options = {}) {
    const context = this._getSessionContext(options.sessionId);
    this._primeContext(context);

    context.sort = normalizeSortName(payload.sort);
    const sortLabel = this.sortOptions.find((item) => item.name === context.sort)?.label || context.sort;
    const event = this._recordEvent(context, "sortChanged", {
      sort: context.sort,
      message: `Cabinet sorted by ${sortLabel}.`,
    });

    return {
      action: "setSort",
      snapshot: this._buildSnapshot(context),
      event,
      message: event.details.message,
    };
  }

  resetSession(payload = {}, options = {}) {
    const existingContext = this._getSessionContext(options.sessionId);
    const preservedSort = payload.preserveSort === false ? DEFAULT_SORT : existingContext.sort;

    existingContext.revision = 0;
    existingContext.sort = preservedSort;
    existingContext.activeTapeId = null;
    existingContext.progress = {};
    existingContext.currentFragmentByTape = {};
    existingContext.advanceToken = null;
    existingContext.events = [];

    this._primeContext(existingContext);

    const event = this._recordEvent(existingContext, "sessionReset", {
      message: "Tape recorder session reset. Cabinet scrubbed clean.",
    });

    return {
      action: "resetSession",
      snapshot: this._buildSnapshot(existingContext),
      event,
      message: event.details.message,
    };
  }

  applyAction(rawAction, payload = {}, options = {}) {
    const action = normalizeActionName(rawAction);
    if (!action) {
      throw this._createError(`Unknown tape recorder action: ${rawAction || "unknown"}`, 400);
    }

    if (action === "selectTape") {
      return this.selectTape(payload, options);
    }

    if (action === "playNext") {
      return this.playNext(payload, options);
    }

    if (action === "revisitFragment") {
      return this.revisitFragment(payload, options);
    }

    if (action === "setSort") {
      return this.setSort(payload, options);
    }

    if (action === "resetSession") {
      return this.resetSession(payload, options);
    }

    throw this._createError(`Unknown tape recorder action: ${rawAction || "unknown"}`, 400);
  }
}

module.exports = new FarmerTapeRecorderService();
