/**
 * `multi` scoring strategy — one or more correct options.
 * Partial credit: `(correctSelected − wrongSelected)` floored at 0, ×weight.
 * Max for the question is `|key| × weight`, so a fully-correct set scores full.
 */
module.exports = {
  type: "multi",
  score(item) {
    const weight = item.weight || 1;
    const key = new Set(Array.isArray(item.key) ? item.key : []);
    const answer = Array.isArray(item.answer) ? item.answer : [];
    let correctSelected = 0;
    let wrongSelected = 0;
    for (const a of new Set(answer)) {
      if (key.has(a)) correctSelected += 1;
      else wrongSelected += 1;
    }
    const raw = Math.max(0, correctSelected - wrongSelected);
    const max = key.size * weight;
    const awarded = raw * weight;
    const correct = correctSelected === key.size && wrongSelected === 0;
    return { awarded, max, correct };
  },
};
