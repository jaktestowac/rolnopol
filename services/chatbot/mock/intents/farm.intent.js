const { buildCoreIntentReply } = require("../farm-replies");
const { POOLS, pick, maybeFollowUp } = require("../phrases");

/**
 * Farm-data intent — answers questions about the user's own fields, staff,
 * animals, summary, and finances, grounded in the provided context. Wording for
 * fields/staff/animals/summary is shared with the persona intent via
 * farm-replies to keep numbers consistent; a follow-up nudge is added at random.
 */

function financeReply(context) {
  const summary = (context && context.summary) || {};
  const currency = summary.accountCurrency || "ROL";
  return [
    pick(POOLS.financeIntros),
    `- Balance: ${summary.accountBalance || 0} ${currency}`,
    `- Total income: ${summary.totalIncome || 0} ${currency}`,
    `- Total expense: ${summary.totalExpense || 0} ${currency}`,
    `- Transactions on record: ${summary.transactionCount || 0}`,
  ].join("\n");
}

module.exports = {
  id: "farm",
  match(normalizedPrompt) {
    return /\b(field|fields|pole|staff|worker|workers|employee|pracownik|animal|animals|livestock|cattle|cow|cows|zwierz|summary|overview|podsum|balance|finance|financial|money|income|expense|budget)\b/.test(
      normalizedPrompt,
    );
  },
  respond({ normalizedPrompt, context }) {
    const body = /\b(balance|finance|financial|money|income|expense|budget)\b/.test(normalizedPrompt)
      ? financeReply(context)
      : buildCoreIntentReply(normalizedPrompt, context);
    return `${body}${maybeFollowUp(0.4)}`;
  },
};
