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

function getNthWeekdayOfMonth(year, monthIndex, weekday, occurrenceIndex) {
  const firstDayOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - firstDayOfMonth.getUTCDay() + 7) % 7;
  const date = 1 + offset + Math.max(0, occurrenceIndex - 1) * 7;
  return new Date(Date.UTC(year, monthIndex, date));
}

function getLastWeekdayOfMonth(year, monthIndex, weekday) {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (lastDayOfMonth.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, lastDayOfMonth.getUTCDate() - offset));
}

function getWeekdayBeforeDate(year, monthIndex, day, weekday) {
  const baseDate = new Date(Date.UTC(year, monthIndex, day));
  let offset = (baseDate.getUTCDay() - weekday + 7) % 7;
  if (offset === 0) {
    offset = 7;
  }

  return new Date(Date.UTC(year, monthIndex, day - offset));
}

function resolveStartDate(event, year) {
  switch (event.dateRule) {
    case "third-monday-of-january":
      return getNthWeekdayOfMonth(year, 0, 1, 3);
    case "friday-before-march-equinox":
      return getWeekdayBeforeDate(year, 2, 20, 5);
    case "last-friday-of-july":
      return getLastWeekdayOfMonth(year, 6, 5);
    case "first-friday-of-october":
      return getNthWeekdayOfMonth(year, 9, 5, 1);
    case "second-sunday-of-may":
      return getSecondSundayOfMay(year);
    default:
      if (typeof event.startMonth !== "number" || typeof event.startDay !== "number") {
        return null;
      }

      return new Date(Date.UTC(year, event.startMonth - 1, event.startDay));
  }
}

function buildOccurrence(event, year) {
  const start = resolveStartDate(event, year);
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return null;
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
    if (!occurrence) {
      return acc;
    }

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
