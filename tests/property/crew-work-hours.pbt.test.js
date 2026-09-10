import { describe, test, expect } from "vitest";
import fc from "fast-check";

// Work-log rollup invariant (PRD §14.3).
//
// The claim: **a rollup equals the sum of the currently-effective entries in its
// range, after any sequence of amendments.** That is the one property the whole
// append-only design exists to guarantee, and it is exactly the kind of arithmetic
// no example-based test will corner — the interesting failures live in overlapping
// amendment chains, entries that share a date, and boundaries of the range.
//
// The model here is deliberately independent of the implementation: it replays the
// log the way a human auditor would ("which row is the last word on each entry?")
// rather than reusing the production reducer.
const { effectiveEntries, rollupOf } = require("../../services/crew/pillars/work/service");

const ACTIVITIES = ["milking", "feeding", "fencing", "harvest"];
const DATES = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-05", "2026-08-09", "2026-08-10"];

/** Quarter-hour values, as the domain requires. */
const hoursArb = fc.integer({ min: 1, max: 96 }).map((quarters) => quarters / 4);

/**
 * A log built by applying operations in order: either a fresh entry, or an
 * amendment of some entry that has not been amended yet (which is exactly what the
 * service allows — amending an already-amended row is refused so a chain cannot
 * fork).
 */
const logArb = fc
  .array(
    fc.oneof(
      fc.record({
        kind: fc.constant("log"),
        date: fc.constantFrom(...DATES),
        hours: hoursArb,
        activity: fc.constantFrom(...ACTIVITIES),
      }),
      fc.record({
        kind: fc.constant("amend"),
        target: fc.nat(),
        hours: hoursArb,
        activity: fc.constantFrom(...ACTIVITIES),
      }),
    ),
    { minLength: 0, maxLength: 40 },
  )
  .map((operations) => {
    const rows = [];
    let nextId = 1;

    for (const operation of operations) {
      if (operation.kind === "log") {
        rows.push({
          id: nextId++,
          staffId: 3,
          date: operation.date,
          hours: operation.hours,
          activity: operation.activity,
          amendsId: null,
        });
        continue;
      }

      // Amend a not-yet-amended row, chosen deterministically from the index the
      // generator produced. If there is nothing amendable, the operation is a no-op.
      const amendable = rows.filter((row) => !rows.some((other) => other.amendsId === row.id));
      if (amendable.length === 0) continue;
      const target = amendable[operation.target % amendable.length];
      rows.push({
        id: nextId++,
        staffId: 3,
        date: target.date,
        hours: operation.hours,
        activity: operation.activity,
        amendsId: target.id,
      });
    }

    return rows;
  });

/** The auditor's model: walk each chain to its last row. */
function lastWordPerEntry(rows) {
  const amendedBy = new Map();
  for (const row of rows) {
    if (row.amendsId !== null && row.amendsId !== undefined) amendedBy.set(Number(row.amendsId), row);
  }

  const roots = rows.filter((row) => row.amendsId === null || row.amendsId === undefined);
  return roots.map((root) => {
    let current = root;
    const seen = new Set([current.id]);
    while (amendedBy.has(current.id)) {
      const next = amendedBy.get(current.id);
      if (seen.has(next.id)) break; // impossible by construction, but never loop
      seen.add(next.id);
      current = next;
    }
    return current;
  });
}

const round2 = (value) => Math.round(value * 100) / 100;

describe("crew work-log rollups — property based", () => {
  test("a rollup equals the sum of the last word on every entry", () => {
    fc.assert(
      fc.property(logArb, (rows) => {
        const expected = round2(lastWordPerEntry(rows).reduce((sum, row) => sum + row.hours, 0));
        expect(rollupOf(rows).hours).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });

  test("the number of effective entries equals the number of logical entries, however often they were amended", () => {
    // An amendment corrects an entry; it never creates a second one. If this drifts,
    // a corrected week would start reporting twice as many entries as it has.
    fc.assert(
      fc.property(logArb, (rows) => {
        const logicalEntries = rows.filter((row) => row.amendsId === null || row.amendsId === undefined).length;
        expect(effectiveEntries(rows)).toHaveLength(logicalEntries);
        expect(rollupOf(rows).entries).toBe(logicalEntries);
      }),
      { numRuns: 300 },
    );
  });

  test("amending an entry never changes another entry's contribution", () => {
    fc.assert(
      fc.property(logArb, hoursArb, fc.nat(), (rows, newHours, pick) => {
        const amendable = rows.filter((row) => !rows.some((other) => other.amendsId === row.id));
        fc.pre(amendable.length > 0);

        const target = amendable[pick % amendable.length];
        const before = rollupOf(rows).hours;
        const amended = [
          ...rows,
          { id: 10_000, staffId: 3, date: target.date, hours: newHours, activity: target.activity, amendsId: target.id },
        ];

        // The whole rollup moves by exactly the delta on the amended entry — no
        // more, no less.
        expect(rollupOf(amended).hours).toBe(round2(before - target.hours + newHours));
      }),
      { numRuns: 300 },
    );
  });

  test("splitting a range in two never loses or double-counts hours", () => {
    fc.assert(
      fc.property(logArb, fc.constantFrom(...DATES), (rows, split) => {
        const whole = rollupOf(rows, { from: DATES[0], to: DATES[DATES.length - 1] }).hours;

        // A split at `split` means [first..split] and (split..last]. Using the
        // next available date as the second range's start keeps the halves disjoint.
        const splitIndex = DATES.indexOf(split);
        const firstHalf = rollupOf(rows, { from: DATES[0], to: split }).hours;
        const secondHalf =
          splitIndex === DATES.length - 1 ? 0 : rollupOf(rows, { from: DATES[splitIndex + 1], to: DATES[DATES.length - 1] }).hours;

        expect(round2(firstHalf + secondHalf)).toBe(whole);
      }),
      { numRuns: 300 },
    );
  });

  test("per-activity hours always sum to the total", () => {
    fc.assert(
      fc.property(logArb, (rows) => {
        const rollup = rollupOf(rows);
        const summed = round2(rollup.byActivity.reduce((sum, bucket) => sum + bucket.hours, 0));
        expect(summed).toBe(rollup.hours);
      }),
      { numRuns: 300 },
    );
  });

  test("hours are never negative, whatever the amendment history", () => {
    fc.assert(
      fc.property(logArb, (rows) => {
        expect(rollupOf(rows).hours).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
});
