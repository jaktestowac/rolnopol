import { describe, it, expect, beforeEach } from "vitest";

// The crew store critical section (PRD §14.4 item 4).
//
// This file exists to stop `withStoreLock` from being removed as redundant. It is
// not redundant, and the first test proves why by reproducing the lost update it
// prevents: `JSONDatabase.update()` awaits between reading the document and
// assigning the new one, so two writers whose awaits line up both read the
// pre-write document and the second silently discards the first's change.
//
// That window is usually missed in production — the file write in between is slow
// enough to hide it — which is exactly what makes it dangerous. A booking quietly
// overwritten tells nobody, and every balance computed afterwards is wrong.
const { withStoreLock, resetStoreLocks } = require("../../services/crew/serialise");
const { transact } = require("../../services/crew/pillars/leave/store");

/**
 * A store double that reproduces `JSONDatabase.update()`'s shape faithfully,
 * including the await between the read and the assignment. Without that await it
 * would be atomic by accident and would prove nothing.
 */
function makeRacyStore(initial) {
  const state = { data: initial };
  return {
    /** What is actually "on disk" right now. */
    document: () => state.data,
    async getAll() {
      return state.data;
    },
    async update(mutate) {
      const current = state.data; // read
      const next = mutate(current); // decide
      await Promise.resolve(); // <-- the window inside replaceAll()
      state.data = next; // write
      return next;
    },
  };
}

const emptyDocument = () => ({
  policies: [],
  requests: [],
  adjustments: [],
  counters: { lastPolicyId: 0, lastRequestId: 0, lastAdjustmentId: 0 },
});

/** Append one request, the way the leave service does. */
const appendRequest = (label) => (document) => {
  const nextId = document.counters.lastRequestId + 1;
  return {
    document: {
      ...document,
      requests: [...document.requests, { id: nextId, label }],
      counters: { ...document.counters, lastRequestId: nextId },
    },
    result: { id: nextId, label },
  };
};

describe("the lost update `withStoreLock` prevents", () => {
  beforeEach(() => {
    resetStoreLocks();
  });

  it("loses a write when two callers use the raw store directly", async () => {
    // The bug, demonstrated. Both callers read the empty document, both compute a
    // one-request document from it, and the second assignment wins — so one
    // request vanishes and both callers were told they succeeded.
    const store = makeRacyStore(emptyDocument());

    const raw = (label) =>
      store.update((current) => {
        const { document } = appendRequest(label)(current);
        return document;
      });

    await Promise.all([raw("first"), raw("second")]);

    expect(store.document().requests).toHaveLength(1);
    expect(store.document().counters.lastRequestId).toBe(1); // two writes, one id
  });

  it("keeps both writes when they go through the lock", async () => {
    // Same store, same racy update, but serialised: the second caller now reads a
    // document that already contains the first caller's request.
    const store = makeRacyStore(emptyDocument());

    const [first, second] = await Promise.all([transact(store, appendRequest("first")), transact(store, appendRequest("second"))]);

    expect(store.document().requests.map((row) => row.label)).toEqual(["first", "second"]);
    expect([first.id, second.id]).toEqual([1, 2]);
    expect(store.document().counters.lastRequestId).toBe(2);
  });

  it("lets a decision inside the section see the previous writer's row", async () => {
    // The shape the leave pillar actually relies on: a check and an append in one
    // section. Only ONE of these may append, and that is only true if the second
    // reads the first's work.
    const store = makeRacyStore(emptyDocument());

    const bookOnce = () =>
      transact(store, (document) => {
        if (document.requests.length > 0) return { document, result: { outcome: "REFUSED" } };
        return { ...appendRequest("only")(document), result: { outcome: "BOOKED" } };
      });

    const outcomes = (await Promise.all([bookOnce(), bookOnce(), bookOnce()])).map((result) => result.outcome);
    expect(outcomes.filter((outcome) => outcome === "BOOKED")).toHaveLength(1);
    expect(store.document().requests).toHaveLength(1);
  });
});

describe("withStoreLock", () => {
  beforeEach(() => {
    resetStoreLocks();
  });

  it("runs queued work one at a time, in order", async () => {
    const events = [];
    const job = (name) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([withStoreLock("s", job("a")), withStoreLock("s", job("b")), withStoreLock("s", job("c"))]);

    expect(results).toEqual(["a", "b", "c"]);
    // No start appears between another job's start and end.
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("does not serialise across different resources", async () => {
    // A leave write must not queue behind a work write. Sharing one global lock
    // would turn every unrelated store into a bottleneck.
    const events = [];
    const job = (name) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${name}:end`);
    };

    await Promise.all([withStoreLock("crewLeave", job("leave")), withStoreLock("crewWork", job("work"))]);
    expect(events.slice(0, 2)).toEqual(["leave:start", "work:start"]);
  });

  it("releases the lock when the work throws, and reports the real failure", async () => {
    // A write that threw must not wedge every later write behind its rejection.
    const boom = new Error("store exploded");
    await expect(
      withStoreLock("s", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    await expect(withStoreLock("s", async () => "still works")).resolves.toBe("still works");
  });

  it("does not leak one caller's rejection into the next caller", async () => {
    const failing = withStoreLock("s", async () => {
      throw new Error("first");
    });
    const following = withStoreLock("s", async () => "second");

    await expect(failing).rejects.toThrow("first");
    await expect(following).resolves.toBe("second");
  });
});
