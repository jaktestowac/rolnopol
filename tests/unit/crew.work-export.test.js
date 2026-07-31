import { describe, it, expect } from "vitest";

// Work board — calendar ranges, board indexing and export (PRD Phase 3C).
//
// Every function here is pure, which is the point: the range maths and the CSV
// escaping are exactly the places a browser-only feature usually hides its bugs.
// The controller is requireable from Node precisely so these can be swept without a
// DOM.
const CrewWorkPage = require("../../public/js/pages/crew-work.js");
const {
  datesInRange,
  presetRange,
  csvCell,
  buildCsv,
  exportRows,
  indexBoard,
  computeBoardTotals,
  boardMembers,
  hoursLabel,
  addDays,
  MAX_RANGE_DAYS,
} = CrewWorkPage;

describe("calendar date ranges", () => {
  it("includes both ends of the range", () => {
    expect(datesInRange("2026-08-03", "2026-08-05")).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("returns a single day for a one-day range", () => {
    expect(datesInRange("2026-08-03", "2026-08-03")).toEqual(["2026-08-03"]);
  });

  it("returns nothing for an INVERTED range instead of looping forever", () => {
    // The bug this guards: `while (cursor <= to)` on an inverted range never
    // terminates, and an inverted range is a one-keystroke user typo.
    expect(datesInRange("2026-08-05", "2026-08-03")).toEqual([]);
  });

  it("returns nothing for invalid dates", () => {
    for (const [from, to] of [
      ["2026-8-3", "2026-08-05"],
      ["2026-08-03", "nope"],
      ["", "2026-08-05"],
      [null, undefined],
      ["03/08/2026", "05/08/2026"],
    ]) {
      expect(datesInRange(from, to), `${from} → ${to}`).toEqual([]);
    }
  });

  it("crosses a month boundary", () => {
    expect(datesInRange("2026-07-30", "2026-08-02")).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });

  it("crosses a year boundary", () => {
    expect(datesInRange("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("handles the leap day", () => {
    expect(datesInRange("2024-02-28", "2024-03-01")).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    // …and does not invent one in a non-leap year.
    expect(datesInRange("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });

  it("caps the number of columns it will build", () => {
    // One column per day per member, so an unbounded range would lock the tab. The
    // caller reports the cap rather than silently truncating — see the controller.
    expect(datesInRange("2026-01-01", "2026-12-31")).toHaveLength(MAX_RANGE_DAYS);
  });

  it("can be asked for an uncapped count, which is how the controller detects an over-long range", () => {
    expect(datesInRange("2026-01-01", "2026-12-31", { limit: Infinity })).toHaveLength(365);
  });

  it("adds days across boundaries and rejects malformed input", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("nope", 1)).toBeNull();
  });
});

describe("range presets", () => {
  it("gives a Monday-based week", () => {
    // Monday because the server's weeklyRollup is Monday-based. A client that
    // disagreed would show a total that never matches the graph's.
    expect(presetRange("week", "2026-07-29")).toEqual({ from: "2026-07-27", to: "2026-08-02" }); // Wednesday
  });

  it("puts Sunday in the week that started the previous Monday", () => {
    expect(presetRange("week", "2026-08-02")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("keeps Monday as its own week's start", () => {
    expect(presetRange("week", "2026-07-27")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("gives the whole calendar month, February included", () => {
    expect(presetRange("month", "2026-08-15")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("month", "2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("month", "2024-02-15")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("returns null for an unknown preset or an unusable anchor", () => {
    expect(presetRange("fortnight", "2026-07-29")).toBeNull();
    expect(presetRange("week", "nope")).toBeNull();
  });
});

describe("CSV escaping", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("milking")).toBe("milking");
    expect(csvCell(3.5)).toBe("3.5");
  });

  it("quotes a value containing a comma, a quote or a newline", () => {
    expect(csvCell("Kowalska, Halina")).toBe('"Kowalska, Halina"');
    expect(csvCell('he said "yes"')).toBe('"he said ""yes"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders null and undefined as empty, not as the words", () => {
    // "null" in a spreadsheet cell is worse than a blank: it looks like data.
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("neutralises a formula so a spreadsheet cannot execute it", () => {
    // CSV injection. An activity named `=cmd|...` is executable content in Excel;
    // prefixing an apostrophe makes it text.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell('=HYPERLINK("http://evil","x")')).toMatch(/^"'=HYPERLINK/);
  });

  it("does not mangle a negative number that arrived as a number", () => {
    // Numbers are stringified, and a leading "-" is neutralised — deliberately, since
    // the alternative is deciding at export time whether a leading dash is data or a
    // formula. Text is always the safe reading.
    expect(csvCell(-3)).toBe("'-3");
  });

  it("joins rows with CRLF, as the format specifies", () => {
    expect(buildCsv([["a", "b"], ["c"]])).toBe("a,b\r\nc");
  });

  it("survives empty and missing rows", () => {
    expect(buildCsv([])).toBe("");
    expect(buildCsv(null)).toBe("");
    expect(buildCsv([[], ["x"]])).toBe("\r\nx");
  });
});

describe("the export table", () => {
  const members = [
    { staffId: "3", name: "Halina", surname: "Kowalska", orphaned: false },
    { staffId: "9", name: null, surname: null, orphaned: true },
  ];

  const data = {
    shifts: [
      {
        id: "1",
        staffId: "3",
        date: "2026-08-03",
        status: "CONFIRMED",
        hours: 3,
        note: "early",
        cancelReason: null,
        dutyType: { name: "Early milking" },
      },
      {
        id: "2",
        staffId: "3",
        date: "2026-08-04",
        status: "CANCELLED",
        hours: 3,
        note: null,
        cancelReason: "storm",
        dutyType: { name: "Early milking" },
      },
    ],
    workLog: [
      { id: "1", staffId: "3", date: "2026-08-03", hours: 3, activity: "milking", note: null, effective: false, amendedByReason: null },
      {
        id: "2",
        staffId: "3",
        date: "2026-08-03",
        hours: 2.5,
        activity: "milking",
        note: null,
        effective: true,
        amendedByReason: "finished early",
      },
    ],
  };

  it("starts with a header row", () => {
    const rows = exportRows(data, members);
    expect(rows[0]).toEqual(["Type", "Date", "Staff id", "Crew member", "Duty / activity", "Status", "Hours", "Counts", "Note"]);
  });

  it("emits one row per shift and one per work-log entry, tagged by type", () => {
    const rows = exportRows(data, members).slice(1);
    expect(rows.filter((row) => row[0] === "shift")).toHaveLength(2);
    expect(rows.filter((row) => row[0] === "work_log")).toHaveLength(2);
  });

  it("resolves names, and labels a deleted staff record rather than leaving a blank", () => {
    const rows = exportRows(
      { shifts: [{ id: "3", staffId: "9", date: "2026-08-03", status: "PLANNED", hours: 1, dutyType: null }], workLog: [] },
      members,
    );
    expect(rows[1][3]).toBe("(deleted staff record)");
  });

  it("exports superseded rows too, marked as such", () => {
    // The log is append-only; an export that dropped the superseded rows would hide
    // the correction history that is the whole reason for the design.
    const rows = exportRows(data, members).filter((row) => row[0] === "work_log");
    expect(rows.map((row) => row[7])).toEqual(["superseded", "yes"]);
    expect(rows[1][8]).toBe("amended: finished early");
  });

  it("carries the cancellation reason in the note column", () => {
    const rows = exportRows(data, members).filter((row) => row[0] === "shift");
    expect(rows[1][8]).toBe("cancelled: storm");
  });

  it("produces a CSV whose row count matches the data", () => {
    const csv = buildCsv(exportRows(data, members));
    expect(csv.split("\r\n")).toHaveLength(5); // header + 2 shifts + 2 log rows
  });

  it("survives an empty board", () => {
    expect(exportRows({ shifts: [], workLog: [] }, [])).toHaveLength(1); // header only
    expect(exportRows({}, undefined)).toHaveLength(1);
  });
});

describe("board indexing", () => {
  const data = {
    shifts: [
      { id: "1", staffId: "3", date: "2026-08-03", status: "PLANNED" },
      { id: "2", staffId: "3", date: "2026-08-03", status: "CONFIRMED" },
      { id: "3", staffId: "4", date: "2026-08-04", status: "PLANNED" },
    ],
    workLog: [
      { id: "1", staffId: "3", date: "2026-08-03", hours: 3, effective: false },
      { id: "2", staffId: "3", date: "2026-08-03", hours: 2.5, effective: true },
      { id: "3", staffId: "3", date: "2026-08-03", hours: 1, effective: true },
      { id: "4", staffId: "4", date: "2026-08-04", hours: 8, effective: true },
    ],
  };

  it("groups several shifts into one cell", () => {
    const { shiftsByCell, key } = indexBoard(data);
    expect(shiftsByCell.get(key("3", "2026-08-03")).map((shift) => shift.id)).toEqual(["1", "2"]);
  });

  it("sums only the EFFECTIVE hours in a cell", () => {
    // The superseded 3 h must not be added to the 2.5 h that replaced it — otherwise
    // an amended day shows both the wrong and the right figure at once.
    const { hoursByCell, key } = indexBoard(data);
    expect(hoursByCell.get(key("3", "2026-08-03"))).toBe(3.5); // 2.5 + 1, not 6.5
  });

  it("keeps members and dates in separate cells", () => {
    const { hoursByCell, key } = indexBoard(data);
    expect(hoursByCell.get(key("4", "2026-08-04"))).toBe(8);
    expect(hoursByCell.get(key("4", "2026-08-03"))).toBeUndefined();
  });

  it("treats a numeric and a string staff id as the same cell", () => {
    // The graph returns ID! as a string; a filter value could be either.
    const { hoursByCell, key } = indexBoard({
      shifts: [],
      workLog: [{ id: "1", staffId: 3, date: "2026-08-03", hours: 2, effective: true }],
    });
    expect(hoursByCell.get(key("3", "2026-08-03"))).toBe(2);
  });

  it("survives a missing collection", () => {
    const { shiftsByCell, hoursByCell } = indexBoard({});
    expect(shiftsByCell.size).toBe(0);
    expect(hoursByCell.size).toBe(0);
  });
});

describe("board totals", () => {
  // The bug these cover: the board summed LOGGED hours only, so a roster full of
  // shifts with nothing logged yet showed a column of zeroes — which is what
  // "does not display valid info about hours" looked like. Scheduled and logged are
  // now separate figures, and both are computed here rather than inside the renderer.
  const members = [
    { staffId: "3", name: "Halina", surname: "Kowalska", orphaned: false },
    { staffId: "4", name: "Ted", surname: "Bun", orphaned: false },
  ];
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05"];

  const board = {
    crew: { nodes: members },
    shifts: [
      { id: "1", staffId: "3", date: "2026-08-03", status: "CONFIRMED", hours: 3 },
      { id: "2", staffId: "3", date: "2026-08-03", status: "PLANNED", hours: 12 },
      { id: "3", staffId: "4", date: "2026-08-04", status: "CANCELLED", hours: 8 },
    ],
    workLog: [
      { id: "1", staffId: "3", date: "2026-08-03", hours: 3, effective: false },
      { id: "2", staffId: "3", date: "2026-08-03", hours: 2.5, effective: true },
      { id: "3", staffId: "4", date: "2026-08-04", hours: 8, effective: true },
    ],
  };

  it("reports SCHEDULED hours from the shifts, not only logged ones", () => {
    // The headline fix. A board with shifts and an empty work log used to total 0.
    const totals = computeBoardTotals(board, members, dates);
    expect(totals.perMember.get("3").scheduled).toBe(15); // 3 + 12
    expect(totals.grand.scheduled).toBe(15);
  });

  it("excludes a CANCELLED shift from scheduled hours", () => {
    // It stays on the board for the audit trail, but nobody is expected to work it.
    const totals = computeBoardTotals(board, members, dates);
    expect(totals.perMember.get("4").scheduled).toBe(0);
  });

  it("sums only EFFECTIVE work-log rows into logged hours", () => {
    const totals = computeBoardTotals(board, members, dates);
    expect(totals.perMember.get("3").logged).toBe(2.5); // not 5.5
    expect(totals.grand.logged).toBe(10.5);
  });

  it("splits each day into scheduled and logged", () => {
    const totals = computeBoardTotals(board, members, dates);
    expect(totals.perDay.get("2026-08-03")).toEqual({ scheduled: 15, logged: 2.5 });
    expect(totals.perDay.get("2026-08-04")).toEqual({ scheduled: 0, logged: 8 });
    expect(totals.perDay.get("2026-08-05")).toEqual({ scheduled: 0, logged: 0 });
  });

  it("makes the day totals add up to the grand total, on both figures", () => {
    const totals = computeBoardTotals(board, members, dates);
    const sum = (pick) => Math.round([...totals.perDay.values()].reduce((total, day) => total + day[pick], 0) * 100) / 100;
    expect(sum("scheduled")).toBe(totals.grand.scheduled);
    expect(sum("logged")).toBe(totals.grand.logged);
  });

  it("makes the member totals add up to the grand total too", () => {
    const totals = computeBoardTotals(board, members, dates);
    const sum = (pick) => Math.round([...totals.perMember.values()].reduce((total, row) => total + row[pick], 0) * 100) / 100;
    expect(sum("scheduled")).toBe(totals.grand.scheduled);
    expect(sum("logged")).toBe(totals.grand.logged);
  });

  it("counts nothing outside the rendered date range", () => {
    const totals = computeBoardTotals(board, members, ["2026-08-05"]);
    expect(totals.grand).toEqual({ scheduled: 0, logged: 0 });
  });

  it("keeps quarter-hour sums clean rather than leaking float noise", () => {
    const quarterBoard = {
      crew: { nodes: [members[0]] },
      shifts: [],
      workLog: Array.from({ length: 29 }, (_, index) => ({
        id: String(index),
        staffId: "3",
        date: "2026-08-03",
        hours: 0.25,
        effective: true,
      })),
    };
    expect(computeBoardTotals(quarterBoard, [members[0]], ["2026-08-03"]).grand.logged).toBe(7.25);
  });

  it("gives every cell an entry, so the renderer never reads undefined", () => {
    const totals = computeBoardTotals(board, members, dates);
    expect(totals.perCell.size).toBe(members.length * dates.length);
    expect(totals.perCell.get(totals.key("4", "2026-08-05"))).toEqual({ scheduled: 0, logged: 0 });
  });

  it("survives an empty board", () => {
    const totals = computeBoardTotals({ crew: { nodes: [] }, shifts: [], workLog: [] }, [], dates);
    expect(totals.grand).toEqual({ scheduled: 0, logged: 0 });
    expect(totals.perDay.get("2026-08-03")).toEqual({ scheduled: 0, logged: 0 });
  });
});

describe("which members appear on the board", () => {
  const live = { staffId: "3", name: "Halina", surname: "Kowalska", orphaned: false };
  const orphan = { staffId: "9", name: null, surname: null, orphaned: true };
  const dates = ["2026-08-03", "2026-08-04"];

  it("hides an orphaned member with nothing in the range — they are not crew", () => {
    const board = { crew: { nodes: [live, orphan] }, shifts: [], workLog: [] };
    expect(boardMembers(board, "", dates).map((member) => member.staffId)).toEqual(["3"]);
  });

  it("INCLUDES an orphaned member who has hours in the range", () => {
    // Otherwise hours somebody actually worked vanish from the totals because their
    // staff record was deleted later, and the grand total stops matching the
    // server's rollup (PRD section 12 rule 4).
    const board = {
      crew: { nodes: [live, orphan] },
      shifts: [],
      workLog: [{ id: "1", staffId: "9", date: "2026-08-03", hours: 4, effective: true }],
    };
    expect(boardMembers(board, "", dates).map((member) => member.staffId)).toEqual(["3", "9"]);
  });

  it("includes an orphaned member who has a shift in the range", () => {
    const board = {
      crew: { nodes: [live, orphan] },
      shifts: [{ id: "1", staffId: "9", date: "2026-08-04", status: "PLANNED", hours: 3 }],
      workLog: [],
    };
    expect(boardMembers(board, "", dates).map((member) => member.staffId)).toEqual(["3", "9"]);
  });

  it("ignores rows OUTSIDE the range when deciding", () => {
    const board = {
      crew: { nodes: [live, orphan] },
      shifts: [],
      workLog: [{ id: "1", staffId: "9", date: "2026-09-01", hours: 4, effective: true }],
    };
    expect(boardMembers(board, "", dates).map((member) => member.staffId)).toEqual(["3"]);
  });

  it("narrows to exactly one member when the filter is set", () => {
    const board = { crew: { nodes: [live, orphan] }, shifts: [], workLog: [] };
    expect(boardMembers(board, "3", dates).map((member) => member.staffId)).toEqual(["3"]);
    // Including an orphan, if that is who was asked for.
    expect(boardMembers(board, "9", dates).map((member) => member.staffId)).toEqual(["9"]);
  });

  it("survives a board with no crew", () => {
    expect(boardMembers({ crew: { nodes: [] }, shifts: [], workLog: [] }, "", dates)).toEqual([]);
    expect(boardMembers({}, "", dates)).toEqual([]);
  });
});

describe("hours labels", () => {
  it("carries the unit, so a total never reads as a bare count", () => {
    // The original defect: the per-day footer printed "3" and "10.5" with no unit
    // beside a grand total of "13.5 h".
    expect(hoursLabel(3)).toBe("3 h");
    expect(hoursLabel(13.5)).toBe("13.5 h");
  });

  it("shows an em dash for nothing rather than a zero", () => {
    // "0" in a cell looks like recorded data; a dash reads as "nothing here".
    expect(hoursLabel(0)).toBe("—");
  });
});
