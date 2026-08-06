/**
 * Instrumentality Shadow — the sink the Chaos Engine's "Human Instrumentality Dry
 * Run" preset mirrors traffic into.
 *
 * Chaos mirroring copies a request (same method/path/headers/body) to
 * `mirroring.targetUrl` and appends the original path to it. Pointing that at a
 * live API root would re-execute writes, so the preset aims it HERE instead: this
 * sink swallows every copy, keeps a counter and the last few paths in memory, and
 * returns 204. Nothing is written to disk and no body is ever retained — the
 * shadow absorbs, it does not remember.
 *
 * State is per-process and resets with the app; that is the point of a drill.
 */
const MAX_RECENT = 12;
const MAX_PATH_LEN = 120;

let absorbed = 0;
let since = null;
let recent = []; // newest first, capped at MAX_RECENT
const subscribers = new Set();

/** Record one mirrored request. Returns the resulting count. */
function absorb({ method, path, at } = {}) {
  absorbed += 1;
  const timestamp = at || new Date().toISOString();
  if (!since) since = timestamp;
  recent.unshift({
    method: String(method || "GET").toUpperCase().slice(0, 10),
    path: String(path || "/").slice(0, MAX_PATH_LEN),
    at: timestamp,
  });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  notify();
  return absorbed;
}

/** What the page renders: how much has been absorbed, and the last few paths. */
function snapshot() {
  return { absorbed, since, recent: recent.map((entry) => ({ ...entry })) };
}

function subscribe(listener) {
  if (typeof listener !== "function") return () => {};
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function notify() {
  const state = snapshot();
  for (const listener of subscribers) {
    try {
      listener(state);
    } catch {
      subscribers.delete(listener);
    }
  }
}

function reset() {
  absorbed = 0;
  since = null;
  recent = [];
  notify();
}

module.exports = { absorb, snapshot, subscribe, reset, MAX_RECENT };
