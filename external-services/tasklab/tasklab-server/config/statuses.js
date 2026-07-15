/**
 * TaskLab status catalog + field limits.
 *
 * A task moves between these statuses. The "archived" flag is orthogonal to
 * status — an archived task keeps whatever status it had.
 */
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 2000;

const STATUSES = [
  { id: "open", label: "Open", emoji: "📋" },
  { id: "in_progress", label: "In progress", emoji: "🚧" },
  { id: "blocked", label: "Blocked", emoji: "⛔" },
  { id: "done", label: "Done", emoji: "✅" },
];

const DEFAULT_STATUS = "open";

const STATUS_IDS = new Set(STATUSES.map((s) => s.id));

function isValidStatus(id) {
  return STATUS_IDS.has(id);
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_CONTENT_LENGTH,
  STATUSES,
  DEFAULT_STATUS,
  isValidStatus,
};
