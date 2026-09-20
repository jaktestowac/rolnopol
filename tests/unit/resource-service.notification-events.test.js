import ResourceService from "../../services/resource.service.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const notificationCenter = require("../../modules/notification-center");
const { EVENT_TYPES } = require("../../modules/notification-center/core/contracts");

// publishEvent in resource.service is fire-and-forget: it never awaits the
// publisher, so give the microtask queue a turn before asserting.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("resource.service notification events", () => {
  let published;

  beforeEach(() => {
    published = [];
    vi.spyOn(notificationCenter, "publish").mockImplementation(async (event) => {
      published.push(event);
      return { accepted: true };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const typesOf = () => published.map((event) => event.type);
  const eventOf = (type) => published.find((event) => event.type === type);

  const stubUpdate = (service, record) => {
    vi.spyOn(service.db, "updateRecords").mockImplementation(async (_predicate, updater) => [updater(record)]);
  };

  describe("staff", () => {
    it("publishes staff.updated with the changed fields", async () => {
      const service = new ResourceService("staff");
      stubUpdate(service, { id: 7, userId: 2, name: "Ada", surname: "Kowalska" });

      await service.update(2, 7, { position: "Supervisor" });
      await flush();

      const event = eventOf(EVENT_TYPES.STAFF_UPDATED);
      expect(event).toBeTruthy();
      expect(event.payload).toMatchObject({
        userId: 2,
        staffId: 7,
        name: "Ada",
        surname: "Kowalska",
        changes: { position: "Supervisor" },
      });
      expect(event.correlationId).toBe("staff-update-7");
    });

    it("publishes staff.deleted", async () => {
      const service = new ResourceService("staff");
      vi.spyOn(service.db, "remove").mockResolvedValue(true);

      await service.delete(2, 7);
      await flush();

      const event = eventOf(EVENT_TYPES.STAFF_DELETED);
      expect(event).toBeTruthy();
      expect(event.payload).toMatchObject({ userId: 2, staffId: 7 });
      expect(event.correlationId).toBe("staff-deleted-7");
    });
  });

  describe("animals", () => {
    it("publishes animal.updated on every successful update", async () => {
      const service = new ResourceService("animals");
      vi.spyOn(service.db, "findOne").mockResolvedValue({ id: 4, userId: 2, type: "cow", amount: 1, fieldId: 3 });
      stubUpdate(service, { id: 4, userId: 2, type: "cow", amount: 1, fieldId: 3 });

      await service.updateAnimal(2, 4, { amount: "5" });
      await flush();

      const event = eventOf(EVENT_TYPES.ANIMAL_UPDATED);
      expect(event).toBeTruthy();
      expect(event.payload).toMatchObject({
        userId: 2,
        animalId: 4,
        type: "cow",
        amount: 5,
        changes: { amount: "5" },
      });
      expect(typesOf()).not.toContain(EVENT_TYPES.ANIMAL_ASSIGNED);
    });

    it("publishes animal.updated alongside animal.assigned when the field changes", async () => {
      const service = new ResourceService("animals");
      vi.spyOn(service.db, "findOne").mockResolvedValue({ id: 4, userId: 2, type: "cow", amount: 1, fieldId: 3 });
      stubUpdate(service, { id: 4, userId: 2, type: "cow", amount: 1, fieldId: 3 });

      await service.updateAnimal(2, 4, { fieldId: 9 });
      await flush();

      expect(typesOf()).toContain(EVENT_TYPES.ANIMAL_UPDATED);
      expect(typesOf()).toContain(EVENT_TYPES.ANIMAL_ASSIGNED);
    });

    it("publishes animal.deleted", async () => {
      const service = new ResourceService("animals");
      vi.spyOn(service.db, "remove").mockResolvedValue(true);

      await service.delete(2, 4);
      await flush();

      const event = eventOf(EVENT_TYPES.ANIMAL_DELETED);
      expect(event).toBeTruthy();
      expect(event.payload).toMatchObject({ userId: 2, animalId: 4 });
      expect(event.correlationId).toBe("animal-deleted-4");
    });
  });

  describe("fields", () => {
    it("still publishes field.deleted with the field-specific id key", async () => {
      const service = new ResourceService("fields");
      vi.spyOn(service.db, "remove").mockResolvedValue(true);

      await service.delete(2, 11);
      await flush();

      const event = eventOf(EVENT_TYPES.FIELD_DELETED);
      expect(event).toBeTruthy();
      expect(event.payload).toMatchObject({ userId: 2, fieldId: 11 });
      expect(event.correlationId).toBe("field-deleted-11");
    });

    it("does not publish a staff or animal deletion for a field", async () => {
      const service = new ResourceService("fields");
      vi.spyOn(service.db, "remove").mockResolvedValue(true);

      await service.delete(2, 11);
      await flush();

      expect(typesOf()).not.toContain(EVENT_TYPES.STAFF_DELETED);
      expect(typesOf()).not.toContain(EVENT_TYPES.ANIMAL_DELETED);
    });
  });
});
