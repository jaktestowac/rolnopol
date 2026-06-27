import { describe, it, expect } from "vitest";

// Regression guard for refactor #2's CREATE cascade (financial-account init).
//
// NOTE: this deliberately does NOT go through POST /api/v1/register. The
// registration path in auth.service ALSO calls financialService.initializeAccount
// directly (auth.service.js), so a register-based test passes even when the
// lifecycle handler is broken — it would be vacuous. The lifecycle create-handler
// is the sole account-creator only for non-registration user creation (e.g. the
// admin restore flow). This test exercises that handler directly against the real
// financial DB, bypassing auth.service's redundant call.
//
// Booting the app loads the databases and self-registers the handler.
const app = require("../api/index.js");
const lifecycle = require("../data/user-lifecycle");
const dbManager = require("../data/database-manager");

async function accountsForUser(userId) {
  const data = await dbManager.getFinancialDatabase().getAll();
  const accounts = Array.isArray(data) ? data : data?.accounts || [];
  return accounts.filter((a) => Number(a.userId) === Number(userId));
}

describe("financial account is created via the user-lifecycle create-cascade (#2)", () => {
  it("creates a real financial account when a userCreated event fires", async () => {
    const userId = 970000 + (Date.now() % 100000); // synthetic id unlikely to collide

    expect(await accountsForUser(userId)).toHaveLength(0); // precondition

    await lifecycle.notifyUserCreated({ id: userId });

    const accounts = await accountsForUser(userId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ currency: "ROL", balance: 0 });
  });
});
