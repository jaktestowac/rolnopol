import { describe, it, expect } from "vitest";
import {
  formatResponseBody,
  filterInternalFields,
} from "../../helpers/response-helper";

describe("response-helper", () => {
  it("should format a success response", () => {
    const result = formatResponseBody({ data: { foo: "bar" } });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ foo: "bar" });
    expect(result).not.toHaveProperty("error");
  });

  it("should format an error response", () => {
    const result = formatResponseBody({ error: "fail" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("fail");
  });

  it("should filter internalId for user", () => {
    const data = { id: 1, internalId: 123, name: "Test" };
    const filtered = filterInternalFields(data);
    expect(filtered).not.toHaveProperty("internalId");
    expect(filtered).toMatchObject({ id: 1, name: "Test" });
  });

  it("should not filter internalId for admin", () => {
    const data = { id: 1, internalId: 123, name: "Test" };
    const filtered = filterInternalFields(data, true);
    expect(filtered).toHaveProperty("internalId", 123);
  });

  it("should filter internalId in array for user", () => {
    const arr = [
      { id: 1, internalId: 123 },
      { id: 2, internalId: 456 },
    ];
    const filtered = filterInternalFields(arr);
    expect(filtered[0]).not.toHaveProperty("internalId");
    expect(filtered[1]).not.toHaveProperty("internalId");
  });
});
