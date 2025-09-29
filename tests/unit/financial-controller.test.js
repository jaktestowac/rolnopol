const financialController = require("../../controllers/financial.controller");
import { describe, it, expect } from "vitest";

describe("financial.controller", () => {
  it("should export an object", () => {
    expect(typeof financialController).toBe("object");
  });

  [
    "getAccount",
    "addTransaction",
    "getTransactionHistory",
    "getFinancialStats",
    "getTotalMarketplaceVolume",
    "getMarketplaceStats",
    "transferFunds",
    "getAllAccounts",
    "updateAccountBalance",
    "getTransactionById",
    "getAllTransactionsAdmin",
  ].forEach((method) => {
    it(`should have a ${method} method`, () => {
      expect(typeof financialController[method]).toBe("function");
    });
  });
});
