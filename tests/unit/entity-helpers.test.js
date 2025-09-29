import { describe, it, expect } from "vitest";
import { updateEntityTimestamp } from "../../helpers/entity.helpers";

describe("entity.helpers", () => {
  it("should add updatedAt timestamp", () => {
    const entity = { id: 1, name: "Test" };
    const updated = updateEntityTimestamp(entity);
    expect(updated).toHaveProperty("updatedAt");
    expect(updated.id).toBe(1);
    expect(updated.name).toBe("Test");
    expect(new Date(updated.updatedAt).toString()).not.toBe("Invalid Date");
  });
});
