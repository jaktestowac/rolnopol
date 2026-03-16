import { describe, it, expect, vi, afterEach } from "vitest";
import { formatResponseBody, filterInternalFields } from "../../helpers/response-helper";

describe("response-helper", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("should pass through meta payload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T12:00:00"));
    const result = formatResponseBody({ data: { ok: true }, meta: { source: "test" } });
    expect(result.meta).toEqual({ source: "test" });
  });

  it("should include night owl footer between 00:00 and 03:59", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T01:15:00"));
    const result = formatResponseBody({ data: { ok: true } });
    expect(result.meta).toBeDefined();
    expect(result.meta.nightOwlFooter).toContain("Night shift bonus");
  });
});
