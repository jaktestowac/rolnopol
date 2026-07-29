/**
 * Incremental HTTP reader for streaming bridge tests (NDJSON / SSE).
 *
 * supertest buffers the whole response, which makes it structurally unable to
 * tell a re-streaming bridge from a buffering one — the single assertion that
 * matters most for a stream bridge. This helper drives a raw `http.request` and
 * hands back "give me the next line / next SSE event" promises, so a test can
 * read frame 1 **while the upstream stream is still open** and prove the bridge
 * never collected the stream before answering.
 *
 * `close()` destroys the request, which is how a test plays "the browser went
 * away" and asserts the bridge cancels its upstream gRPC call.
 */
const http = require("http");

function parseSseBlock(block) {
  // `id` is the browser's reconnect cursor (replayed as Last-Event-ID), so a test
  // that asserts resumption has to be able to read it.
  const out = { event: "message", data: "", retry: null, comment: null, id: null };
  for (const raw of block.split("\n")) {
    if (raw.startsWith("event:")) out.event = raw.slice(6).trim();
    else if (raw.startsWith("data:")) out.data += raw.slice(5).trim();
    else if (raw.startsWith("retry:")) out.retry = Number(raw.slice(6).trim());
    else if (raw.startsWith("id:")) out.id = raw.slice(3).trim();
    else if (raw.startsWith(":")) out.comment = raw.slice(1).trim();
  }
  out.json = out.data ? JSON.parse(out.data) : null;
  return out;
}

/**
 * Open a streaming GET and resolve once the response HEADERS arrive (not the body).
 *
 * @returns {Promise<{status:number, headers:object, nextLine:Function, nextJson:Function,
 *   nextEvent:Function, nextBlock:Function, rest:Function, buffered:Function,
 *   ended:boolean, close:Function}>}
 */
function openStream({ port, path, headers = {}, host = "127.0.0.1", method = "GET" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers }, (res) => {
      let buf = "";
      let ended = false;
      let failure = null;
      const waiters = [];

      const pump = () => {
        while (waiters.length) {
          const waiter = waiters[0];
          const sep = waiter.kind === "block" ? "\n\n" : "\n";
          const at = buf.indexOf(sep);
          if (at >= 0) {
            const chunk = buf.slice(0, at);
            buf = buf.slice(at + sep.length);
            if (waiter.kind === "line" && chunk.trim() === "") continue; // skip blank lines
            waiters.shift();
            waiter.resolve(chunk);
            continue;
          }
          if (ended || failure) {
            waiters.shift();
            waiter.reject(failure || new Error(`stream ended before the next ${waiter.kind}; buffered=${JSON.stringify(buf)}`));
            continue;
          }
          return; // nothing complete yet — wait for more data
        }
      };

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        pump();
      });
      res.on("end", () => {
        ended = true;
        pump();
      });
      res.on("error", (err) => {
        failure = err;
        pump();
      });

      const take = (kind) =>
        new Promise((ok, no) => {
          waiters.push({ kind, resolve: ok, reject: no });
          pump();
        });

      const handle = {
        status: res.statusCode,
        headers: res.headers,
        /** Next non-empty `\n`-terminated line (NDJSON). */
        nextLine: () => take("line"),
        /** Next NDJSON line, parsed. */
        nextJson: async () => JSON.parse(await handle.nextLine()),
        /** Next raw `\n\n`-delimited SSE block (including a bare `retry:` hint). */
        nextBlock: async () => parseSseBlock(await take("block")),
        /** Next SSE block that actually carries an event or data. */
        nextEvent: async () => {
          for (;;) {
            const block = await handle.nextBlock();
            if (block.event === "message" && !block.data) continue; // retry hint / comment
            return block;
          }
        },
        /** Everything still unread, once the response ends. */
        rest: () =>
          new Promise((ok) => {
            if (ended) return ok(buf);
            res.on("end", () => ok(buf));
          }),
        buffered: () => buf,
        get ended() {
          return ended;
        },
        /** Play "the browser went away". */
        close: () => req.destroy(),
      };
      resolve(handle);
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Resolve once `predicate()` is truthy, polling on the macrotask queue.
 *
 * This is NOT a substitute for the injectable clock: it never waits for a
 * DEADLINE to pass, only for an event-loop callback (a gRPC `cancelled` event, a
 * cleared interval) to have run. Deadline-crossing is always done by moving
 * AGRI_ACADEMY_TIME_OFFSET_MS instead.
 */
async function waitUntil(predicate, { timeoutMs = 2000, label = "condition" } = {}) {
  const giveUpAt = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > giveUpAt) throw new Error(`waitUntil timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

module.exports = { openStream, parseSseBlock, waitUntil };
