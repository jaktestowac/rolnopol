/**
 * `single` question type — exactly one correct option.
 * Validation strategy used by authoring before a question is written to the bank.
 */
module.exports = {
  type: "single",
  validate(q) {
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length < 2) return "at least 2 options required";
    const ids = new Set(options.map((o) => o.id));
    if (ids.size !== options.length) return "option ids must be unique";
    if (options.some((o) => !o.id || !String(o.text || "").trim())) return "every option needs an id and text";
    const correct = Array.isArray(q.correct) ? q.correct : [];
    if (correct.length !== 1) return "single questions need exactly one correct option";
    if (!correct.every((c) => ids.has(c))) return "correct must reference option ids";
    return null;
  },
};
