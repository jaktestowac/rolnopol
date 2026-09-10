import { describe, it, expect } from "vitest";

// The team calendar's grid arithmetic and month browsing.
//
// The calendar was a day-per-row table: 31 rows to read one month, 365 to read a year.
// It is now a month grid, which is denser and readable at a glance — and which brings
// exactly the kind of arithmetic that goes wrong quietly. The failure mode is a date
// landing in the wrong column: a Tuesday under the Friday heading looks like a
// calendar and lies, and nothing throws.
//
// So the layout is a pure function and it is swept here against known months:
//
//   - a month starting on a Sunday (the worst case for a Monday-first grid);
//   - February in a leap year and out of it;
//   - a range that starts mid-month, which must leave a GAP rather than shift the
//     dates left;
//   - and the month-paging maths, which has to keep a quarter a quarter.
const { loadLeavePage } = require("../helpers/crew-leave-harness");

let page;

/** The calendar days for a whole month, with no absences unless asked for. */
function monthDays(year, month, absencesByDay) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(date + "T00:00:00.000Z").getUTCDay();
    days.push({
      date,
      weekend: weekday === 0 || weekday === 6,
      publicHoliday: false,
      blackoutReason: null,
      absences: (absencesByDay || {})[day] || [],
    });
  }
  return days;
}

const board = (days) => ({
  crewInfo: { pillars: ["profiles", "leave", "training", "work"] },
  leavePolicy: {
    annualEntitlementDaysFullTime: 26,
    accrualMode: "MONTHLY",
    carryOverCapDays: 5,
    leaveYearStart: "01-01",
    minNoticeDays: 3,
    publicHolidays: [],
    blackoutWindows: [],
    version: 1,
  },
  leaveCalendar: days,
  pendingLeaveApprovals: [],
  crew: { totalCount: 0, nodes: [] },
});

async function load(days) {
  const run = await loadLeavePage({ data: board(days || []) });
  page = run.page;
  return run;
}

describe("monthsInCalendar", () => {
  it("groups the days the server returned, in order", async () => {
    await load();
    const months = page.monthsInCalendar([...monthDays(2026, 8), ...monthDays(2026, 9)]);
    expect(months.map((month) => month.key)).toEqual(["2026-08", "2026-09"]);
    expect(months.map((month) => month.label)).toEqual(["August 2026", "September 2026"]);
    expect(months[0].days).toHaveLength(31);
  });

  it("sorts across a year boundary", async () => {
    await load();
    const months = page.monthsInCalendar([...monthDays(2027, 1), ...monthDays(2026, 12)]);
    expect(months.map((month) => month.key)).toEqual(["2026-12", "2027-01"]);
  });

  it("never invents a month the server did not send", async () => {
    // A month with no data must not appear as an empty grid.
    await load();
    const months = page.monthsInCalendar(monthDays(2026, 8));
    expect(months).toHaveLength(1);
  });

  it("ignores a malformed entry rather than producing a nonsense month", async () => {
    await load();
    const months = page.monthsInCalendar([{ date: null }, { date: "nope" }, ...monthDays(2026, 8)]);
    expect(months.map((month) => month.key)).toEqual(["2026-08"]);
  });

  it("returns nothing for no days", async () => {
    await load();
    expect(page.monthsInCalendar([])).toEqual([]);
    expect(page.monthsInCalendar(null)).toEqual([]);
  });
});

describe("monthGrid — the column a date lands in", () => {
  const gridFor = (year, month, days) =>
    page.monthGrid({ key: `${year}-${String(month).padStart(2, "0")}`, year, month, days: days || monthDays(year, month) });

  it("puts every date under its own weekday, Monday first", async () => {
    await load();
    // The property that matters, checked against the calendar itself rather than
    // against a hand-written expectation: column 0 is Monday, column 6 is Sunday.
    for (const [year, month] of [
      [2026, 8],
      [2026, 2],
      [2028, 2],
      [2026, 11],
    ]) {
      for (const week of gridFor(year, month)) {
        week.forEach((day, column) => {
          if (!day) return;
          const weekday = new Date(day.date + "T00:00:00.000Z").getUTCDay();
          expect((weekday + 6) % 7, `${day.date} is in column ${column}`).toBe(column);
        });
      }
    }
  });

  it("pads the front for a month that does not start on a Monday", async () => {
    await load();
    // 1 August 2026 is a Saturday, so five blanks come first.
    const weeks = gridFor(2026, 8);
    expect(weeks[0].slice(0, 5).every((cell) => cell === null)).toBe(true);
    expect(weeks[0][5].date).toBe("2026-08-01");
  });

  it("handles a month starting on a SUNDAY — the worst case for a Monday grid", async () => {
    await load();
    // 1 November 2026 is a Sunday: six blanks, then the 1st in the last column.
    const weeks = gridFor(2026, 11);
    expect(weeks[0].slice(0, 6).every((cell) => cell === null)).toBe(true);
    expect(weeks[0][6].date).toBe("2026-11-01");
  });

  it("gives every week exactly seven cells and pads the tail", async () => {
    await load();
    for (const [year, month] of [
      [2026, 8],
      [2026, 2],
      [2028, 2],
      [2026, 11],
    ]) {
      for (const week of gridFor(year, month)) expect(week).toHaveLength(7);
    }
  });

  it("asks the calendar how long February is", async () => {
    await load();
    const shortFeb = gridFor(2026, 2).flat().filter(Boolean);
    const leapFeb = gridFor(2028, 2).flat().filter(Boolean);
    expect(shortFeb).toHaveLength(28);
    expect(leapFeb).toHaveLength(29);
    expect(leapFeb[leapFeb.length - 1].date).toBe("2028-02-29");
  });

  it("leaves a GAP for days the range did not include, rather than shifting dates left", async () => {
    // The bug this prevents: a range starting on the 10th, rendered without gaps, puts
    // the 10th in Monday's column and every date after it under the wrong heading.
    await load();
    const partial = monthDays(2026, 8).filter((day) => Number(day.date.slice(8, 10)) >= 10);
    const weeks = gridFor(2026, 8, partial);

    const tenth = weeks.flat().find((day) => day && day.date === "2026-08-10");
    const weekday = new Date("2026-08-10T00:00:00.000Z").getUTCDay();
    expect(weeks.flat().indexOf(tenth) % 7).toBe((weekday + 6) % 7);
    // The 1st to the 9th are absent, and their cells are blank.
    expect(
      weeks
        .flat()
        .filter(Boolean)
        .map((day) => day.date),
    ).not.toContain("2026-08-01");
  });

  it("keeps the grid to five or six weeks", async () => {
    // The whole point of the redesign. A 31-day month starting on a Sunday is the
    // longest it ever gets.
    await load();
    for (const [year, month] of [
      [2026, 2],
      [2026, 8],
      [2026, 11],
      [2028, 2],
    ]) {
      const weeks = gridFor(year, month).length;
      expect(weeks).toBeGreaterThanOrEqual(4);
      expect(weeks).toBeLessThanOrEqual(6);
    }
  });
});

describe("initialsFor", () => {
  it("takes one letter from each name", async () => {
    await load();
    expect(page.initialsFor({ name: "Halina", surname: "Kowalska", staffId: "19" })).toBe("HK");
  });

  it("copes with one name only", async () => {
    await load();
    expect(page.initialsFor({ name: "Halina", surname: null, staffId: "19" })).toBe("H");
  });

  it("falls back to the staff id rather than rendering blank", async () => {
    // An unnamed absence is still somebody being away; an empty chip looks like a bug.
    await load();
    expect(page.initialsFor({ name: null, surname: null, staffId: "19" })).toBe("#19");
    expect(page.initialsFor({ name: "  ", surname: "", staffId: "7" })).toBe("#7");
  });
});

describe("monthOpensExpanded", () => {
  it("opens a month with somebody off", async () => {
    await load();
    const month = { key: "2026-08", days: monthDays(2026, 8, { 24: [{ staffId: "1" }] }) };
    expect(page.monthOpensExpanded(month, "2026-01-15")).toBe(true);
  });

  it("opens the month containing today, even when nobody is off", async () => {
    await load();
    const month = { key: "2026-08", days: monthDays(2026, 8) };
    expect(page.monthOpensExpanded(month, "2026-08-03")).toBe(true);
  });

  it("leaves a quiet month collapsed", async () => {
    // A year-long range would otherwise open twelve grids.
    await load();
    const month = { key: "2026-08", days: monthDays(2026, 8) };
    expect(page.monthOpensExpanded(month, "2026-01-15")).toBe(false);
  });
});

describe("month browsing", () => {
  it("counts the months a range spans", async () => {
    await load();
    expect(page.monthsSpan({ from: "2026-08-01", to: "2026-08-31" })).toBe(1);
    expect(page.monthsSpan({ from: "2026-08-15", to: "2026-08-20" })).toBe(1);
    expect(page.monthsSpan({ from: "2026-08-01", to: "2026-10-31" })).toBe(3);
    expect(page.monthsSpan({ from: "2026-12-01", to: "2027-01-31" })).toBe(2);
  });

  it("moves forward and back by a whole month", async () => {
    await load();
    expect(page.shiftMonths({ from: "2026-08-01", to: "2026-08-31" }, 1)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(page.shiftMonths({ from: "2026-08-01", to: "2026-08-31" }, -1)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("keeps a quarter a quarter while paging", async () => {
    await load();
    expect(page.shiftMonths({ from: "2026-08-01", to: "2026-10-31" }, 1)).toEqual({ from: "2026-09-01", to: "2026-11-30" });
  });

  it("crosses a year boundary in both directions", async () => {
    await load();
    expect(page.shiftMonths({ from: "2026-12-01", to: "2026-12-31" }, 1)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(page.shiftMonths({ from: "2026-01-01", to: "2026-01-31" }, -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("lands on the right end-of-month, including February", async () => {
    await load();
    expect(page.shiftMonths({ from: "2026-01-01", to: "2026-01-31" }, 1).to).toBe("2026-02-28");
    expect(page.shiftMonths({ from: "2028-01-01", to: "2028-01-31" }, 1).to).toBe("2028-02-29");
  });

  it("SNAPS a partial range to whole months, which is the documented trade", async () => {
    // Pressing a month arrow means you have started browsing by month; a range that
    // drifted by 30 days at a time would never line up with a grid again.
    await load();
    expect(page.shiftMonths({ from: "2026-08-10", to: "2026-08-20" }, 1)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("builds a quarter and a year from a starting month", async () => {
    await load();
    expect(page.monthsFrom("2026-08-15", 3)).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(page.monthsFrom("2026-01-01", 12)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("keeps a whole year inside the server's 400-day calendar cap", async () => {
    await load();
    const year = page.monthsFrom("2026-01-01", 12);
    const days = (new Date(year.to + "T00:00:00Z") - new Date(year.from + "T00:00:00Z")) / 86400000 + 1;
    expect(days).toBeLessThanOrEqual(400);
  });

  it("returns null for an unusable date rather than a wrong range", async () => {
    await load();
    expect(page.monthsFrom("nonsense", 3)).toBeNull();
    expect(page.monthsFrom(null, 3)).toBeNull();
  });
});

describe("the navigation buttons", () => {
  it("page back and forward by a month, reloading each time", async () => {
    const run = await loadLeavePage({ data: board(monthDays(2026, 8)) });
    const { elements, calls, CrewApi } = run;
    const boardLoads = () => calls.filter((call) => call.operation === CrewApi.OPERATIONS.LEAVE_BOARD);

    const before = boardLoads().length;
    elements.get("leaveFrom").value = "2026-08-01";
    elements.get("leaveTo").value = "2026-08-31";

    await elements.get("leaveNext").listeners.click();
    expect(elements.get("leaveFrom").value).toBe("2026-09-01");
    expect(boardLoads().length).toBe(before + 1);

    await elements.get("leavePrev").listeners.click();
    expect(elements.get("leaveFrom").value).toBe("2026-08-01");
  });

  it("switches to a quarter and to a whole year", async () => {
    const run = await loadLeavePage({ data: board(monthDays(2026, 8)) });
    const { elements } = run;
    elements.get("leaveFrom").value = "2026-08-01";
    elements.get("leaveTo").value = "2026-08-31";

    await elements.get("leaveQuarter").listeners.click();
    expect(elements.get("leaveFrom").value).toBe("2026-08-01");
    expect(elements.get("leaveTo").value).toBe("2026-10-31");

    await elements.get("leaveYear").listeners.click();
    expect(elements.get("leaveFrom").value).toBe("2026-01-01");
    expect(elements.get("leaveTo").value).toBe("2026-12-31");
  });

  it("renders one grid per month once a quarter is showing", async () => {
    const days = [...monthDays(2026, 8), ...monthDays(2026, 9), ...monthDays(2026, 10)];
    const run = await loadLeavePage({ data: board(days) });
    const html = run.elements.get("leaveCalendar").innerHTML;

    expect((html.match(/<details/g) || []).length).toBe(3);
    for (const label of ["August 2026", "September 2026", "October 2026"]) expect(html).toContain(label);
  });

  it("names the month each arrow leads to, so a click is not a guess", async () => {
    const run = await loadLeavePage({ data: board(monthDays(2026, 8)) });
    const { elements } = run;

    // `setRange` relabels, so pressing a nav button updates both arrows.
    await elements.get("leaveThisMonth").listeners.click();
    expect(elements.get("leavePrevLabel").textContent).toBeTruthy();
    expect(elements.get("leaveNextLabel").textContent).toBeTruthy();

    elements.get("leaveFrom").value = "2026-08-01";
    elements.get("leaveTo").value = "2026-08-31";
    await elements.get("leaveNext").listeners.click();
    // Now showing September, so back is August and forward is October.
    expect(elements.get("leavePrevLabel").textContent).toBe("Aug");
    expect(elements.get("leaveNextLabel").textContent).toBe("Oct");
  });

  it("adds the year to the label only when the arrow crosses one", async () => {
    // Paging inside a year stays terse; crossing a boundary has to be obvious.
    const run = await loadLeavePage({ data: board(monthDays(2026, 1)) });
    const { elements } = run;
    elements.get("leaveFrom").value = "2026-01-01";
    elements.get("leaveTo").value = "2026-01-31";
    await elements.get("leaveReload").listeners.click();

    expect(elements.get("leavePrevLabel").textContent).toBe("Dec 2025");
    expect(elements.get("leaveNextLabel").textContent).toBe("Feb");
  });
});

describe("the month arrows are visible without Font Awesome", () => {
  // The regression this pins. Both arrows were icon-only, and were reported as simply
  // missing from the page. Font Awesome is a CDN dependency, so when it does not arrive
  // the `<i>` renders as nothing — and a button with no other content collapses to its
  // own padding. An invisible control, on the one row whose whole job is navigation.
  //
  // An `aria-label` did not help: it is exactly the users who can SEE the page who lost
  // the button.
  const fsNode = require("fs");
  const pathNode = require("path");
  const PUBLIC = pathNode.join(__dirname, "..", "..", "public");
  const html = fsNode.readFileSync(pathNode.join(PUBLIC, "crew-leave.html"), "utf8");
  const css = fsNode.readFileSync(pathNode.join(PUBLIC, "css", "pages", "crew.css"), "utf8");

  /** The markup of one button, found by the id it contains. */
  function buttonHtml(id) {
    const at = html.indexOf('id="' + id + '"');
    expect(at, id + " is not in the page").toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
  }

  it.each(["leavePrev", "leaveNext"])("%s carries visible text, not only an icon", (id) => {
    const markup = buttonHtml(id);
    expect(markup).toMatch(/<span id="leave(Prev|Next)Label">\w+<\/span>/);
    // The icon is decoration on top of the label, and hidden from screen readers
    // because the text already says what the button does.
    expect(markup).toContain('aria-hidden="true"');
  });

  it("gives the arrows a width that does not depend on the icon", () => {
    expect(html).toMatch(/id="leavePrev" class="crew-btn crew-btn--nav"/);
    expect(css).toMatch(/\.crew-btn--nav\s*\{[^}]*min-width/);
  });

  it("keeps a floor under any icon that is a button's only child", () => {
    // The general guard, so the next icon-only button somebody adds cannot vanish.
    expect(css).toMatch(/\.crew-btn > i:only-child\s*\{[^}]*min-width/);
  });

  it("ships no crew page with a button whose only content is an icon", () => {
    // The class of bug rather than the two instances of it.
    const offenders = [];
    for (const file of fsNode.readdirSync(PUBLIC).filter((name) => /^crew.*\.html$/.test(name))) {
      const markup = fsNode.readFileSync(pathNode.join(PUBLIC, file), "utf8");
      for (const match of markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
        const withoutIcons = match[1].replace(/<i\b[^>]*><\/i>/g, "").replace(/\s+/g, "");
        if (withoutIcons === "") offenders.push(file + " → " + match[0].replace(/\s+/g, " ").slice(0, 90));
      }
    }
    expect(offenders).toEqual([]);
  });
});
