const { POOLS, pick } = require("./phrases");

/**
 * Shared builders for replies grounded in the user's farm context (summary,
 * fields, staff, animals). Extracted so both the farm intent and the persona
 * intent (which wraps a "core" reply) can reuse them. Intro lines vary for
 * liveliness; the factual bullets/lists stay stable and testable.
 */

function getSummary(context) {
  return (context && context.summary) || {};
}

function buildSummaryReply(context) {
  const summary = getSummary(context);
  return [
    pick(POOLS.summaryIntros),
    `- Fields: ${summary.fieldsCount || 0}`,
    `- Total field area: ${summary.totalFieldAreaHa || 0} ha`,
    `- Staff members: ${summary.staffCount || 0}`,
    `- Animal records: ${summary.animalRecordsCount || 0}`,
    `- Total animals: ${summary.totalAnimals || 0}`,
  ].join("\n");
}

// Fixed "Your <thing>:" prefix (a smoke-eval health check depends on it) plus a
// varied trailing closer for liveliness.
function withCloser(text) {
  const closer = pick(POOLS.listClosers);
  return closer ? `${text} ${closer}` : text;
}

function buildFieldsReply(context) {
  const fields = (context && context.samples && context.samples.fields) || [];
  if (!fields.length) {
    return "I could not find any fields assigned to your account yet.";
  }
  const list = fields.map((field) => `${field.name || "Unnamed field"} (${field.area || 0} ha)`).join(", ");
  return withCloser(`Your fields: ${list}.`);
}

function buildStaffReply(context) {
  const staff = (context && context.samples && context.samples.staff) || [];
  if (!staff.length) {
    return "I could not find any staff assigned to your account yet.";
  }
  const list = staff
    .map((member) => {
      const fullName = [member.name, member.surname].filter(Boolean).join(" ") || "Unnamed worker";
      return `${fullName}${member.position ? ` (${member.position})` : ""}`;
    })
    .join(", ");
  return withCloser(`Your staff: ${list}.`);
}

function buildAnimalsReply(context) {
  const animals = (context && context.samples && context.samples.animals) || [];
  if (!animals.length) {
    return "I could not find any animals assigned to your account yet.";
  }
  const list = animals.map((animal) => `${animal.type || "unknown"}: ${animal.amount || 0}`).join(", ");
  return withCloser(`Your animals: ${list}.`);
}

// Route a farm-data question to the most specific reply, defaulting to a summary.
function buildCoreIntentReply(normalizedPrompt, context) {
  if (normalizedPrompt.includes("summary") || normalizedPrompt.includes("podsum")) {
    return buildSummaryReply(context);
  }
  if (normalizedPrompt.includes("field") || normalizedPrompt.includes("pole")) {
    return buildFieldsReply(context);
  }
  if (normalizedPrompt.includes("staff") || normalizedPrompt.includes("pracownik")) {
    return buildStaffReply(context);
  }
  if (normalizedPrompt.includes("animal") || normalizedPrompt.includes("zwierz")) {
    return buildAnimalsReply(context);
  }
  return `${buildSummaryReply(context)}\n\n${pick(POOLS.mockedNotes)}`;
}

module.exports = {
  getSummary,
  buildSummaryReply,
  buildFieldsReply,
  buildStaffReply,
  buildAnimalsReply,
  buildCoreIntentReply,
};
