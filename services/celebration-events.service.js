const { CELEBRATION_EVENTS } = require("./celebration-events.data");

function parseDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const [year, month, day] = dateStr.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date value");
  }

  return date;
}

function toDateLabel(date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function getSecondSundayOfMay(year) {
  const firstDay = new Date(Date.UTC(year, 4, 1));
  const firstDayOfWeek = firstDay.getUTCDay();
  const firstSundayOffset = (7 - firstDayOfWeek) % 7;
  const secondSundayDate = 1 + firstSundayOffset + 7;
  return new Date(Date.UTC(year, 4, secondSundayDate));
}

function buildOccurrence(event, year) {
  let start;
  if (event.dateRule === "second-sunday-of-may") {
    start = getSecondSundayOfMay(year);
  } else {
    start = new Date(Date.UTC(year, event.startMonth - 1, event.startDay));
  }
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + Math.max(1, Number(event.durationDays) || 1) - 1);

  return {
    ...event,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dateLabel:
      start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)
        ? toDateLabel(start)
        : `${toDateLabel(start)}–${toDateLabel(end)}`,
  };
}

function isDateWithinOccurrence(date, occurrence) {
  const current = date.getTime();
  const start = Date.parse(`${occurrence.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${occurrence.endDate}T23:59:59.999Z`);
  return current >= start && current <= end;
}

function listCelebrationEvents() {
  return CELEBRATION_EVENTS.map((event) => ({
    ...event,
    durationDays: Math.max(1, Number(event.durationDays) || 1),
  }));
}

function getCelebrationEventsForDate(dateStr) {
  const date = parseDate(dateStr);
  return CELEBRATION_EVENTS.reduce((acc, event) => {
    const occurrence = buildOccurrence(event, date.getUTCFullYear());
    if (isDateWithinOccurrence(date, occurrence)) {
      acc.push({
        ...occurrence,
        seedDate: dateStr,
      });
    }
    return acc;
  }, []);
}

module.exports = {
  buildOccurrence,
  getCelebrationEventsForDate,
  listCelebrationEvents,
  parseDate,
  getSecondSundayOfMay,
};
