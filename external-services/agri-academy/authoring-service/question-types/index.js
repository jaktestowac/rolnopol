/**
 * Question-type registry (validation side).
 *
 * The extensibility seam: a new question type is a strategy `{ type, validate }`
 * registered here (and a matching scoring strategy in the grading service) — no
 * proto change, no DB migration. v2/v3 ship `single` and `multi`. The exam center
 * stays type-agnostic; the type string travels on the wire.
 */
const strategies = new Map();

function register(strategy) {
  if (!strategy || !strategy.type || typeof strategy.validate !== "function") {
    throw new Error("a question-type strategy needs { type, validate() }");
  }
  strategies.set(strategy.type, strategy);
}

function resolve(type) {
  return strategies.get(type) || null;
}

function types() {
  return [...strategies.keys()];
}

/**
 * Validate a candidate question. Returns an error string, or null when valid.
 * Rejects unknown types so a half-registered type can't leak into a live exam.
 */
function validate(question) {
  if (!question || typeof question !== "object") return "question required";
  if (!String(question.text || "").trim()) return "text required";
  const strategy = resolve(question.type);
  if (!strategy) return `unknown question type: ${question.type}`;
  return strategy.validate(question);
}

register(require("./single"));
register(require("./multi"));

module.exports = { register, resolve, types, validate };
