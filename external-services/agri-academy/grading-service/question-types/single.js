/**
 * `single` scoring strategy — exactly one correct option.
 * Full `weight` iff the one selected id equals the key, else 0.
 */
module.exports = {
  type: "single",
  score(item) {
    const weight = item.weight || 1;
    const key = Array.isArray(item.key) ? item.key : [];
    const answer = Array.isArray(item.answer) ? item.answer : [];
    const max = key.length * weight; // |key| === 1 for a well-formed single
    const correct = answer.length === 1 && key.length === 1 && answer[0] === key[0];
    return { awarded: correct ? weight : 0, max, correct };
  },
};
