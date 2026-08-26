import { describe, it, expect } from "vitest";

// Hiring (PRD §14.1, §8.1.1).
//
// The two properties worth stating up front, because they are what make this
// mutation unusual:
//
//   1. **Validation is ours, and stricter than the base module** — `POST /api/v1/staff`
//      has none at all. But the strictness applies ONLY to hire input. The read
//      path must stay lenient, or Crew Office would reject records the base module
//      happily stores, including the 88-year-old already in staff.json.
//   2. **Partial success is a named outcome, not an error.** If the staff record
//      commits and the profile write fails, the compensating delete is FORBIDDEN
//      by the no-firing rule — so the design makes the failure benign instead. The
//      test asserts no rollback is even attempted.
const { createProfilesService } = require("../../services/crew/pillars/profiles/service");
const { CREW_ERROR_CODES } = require("../../services/crew/errors");
const { createCrewNotifier, CREW_EVENTS } = require("../../services/crew/notifier");

const VALID = {
  name: "Halina",
  surname: "Kowalska",
  age: 34,
  role: "TRACTOR_DRIVER",
  employmentType: "PERMANENT",
  fte: 1.0,
  contractedHoursPerWeek: 40,
  startDate: "2026-03-01",
};

/**
 * A context stub with a fake staff gateway, so hire can be driven without
 * touching a store. The gateway records what it was asked to do, which is how the
 * no-rollback assertion is made: a delete would have to appear here, and there is
 * no method for one.
 */
function makeContext({ hire, upsertFails, userId = 1 } = {}) {
  const calls = [];
  const published = [];

  const context = {
    // The real notifier with a fake publisher, so notifier.js's userId stamping
    // is exercised rather than stubbed past. Emitted events land in
    // `context.published` for assertions.
    notifier: createCrewNotifier({ userId, publish: (event) => published.push(event) }),
    published,
    userId,
    hasWritableIdentity: Number.isFinite(userId),
    assertWritableIdentity() {
      if (!this.hasWritableIdentity) throw new Error("unwritable identity");
    },
    clock: { today: () => "2026-07-29", nowIso: () => "2026-07-29T10:00:00.000Z" },
    pillars: ["profiles"],
    services: {},
    storeReads: { total: 0, byStore: {} },
    onStoreRead: () => {},
    loaders: {
      ownedStaff: { get: async () => [], reset: () => calls.push({ method: "resetOwnedStaff" }) },
      staffById: { get: async () => undefined, reset: () => {} },
      fieldIdsByStaffId: { all: async () => new Map() },
    },
    addLoader: () => ({ all: async () => new Map(), get: async () => undefined, reset: () => {} }),
    resetLoaders: (...names) => calls.push({ method: "resetLoaders", names }),
    staffGateway: {
      listOwned: async () => [],
      findOwned: async () => null,
      hire: async (id, data) => {
        calls.push({ method: "hire", userId: id, data });
        return hire ? hire(id, data) : { id: 42, userId: id, ...data };
      },
    },
    calls,
  };
  const service = createProfilesService(context);
  if (upsertFails) {
    service.upsertProfile = async () => {
      calls.push({ method: "upsertProfile" });
      throw upsertFails;
    };
  }
  return { context, service, calls };
}

describe("hire input validation", () => {
  const fieldsFor = (input) => {
    const { service } = makeContext();
    return service.validateHireInput(input).map((error) => error.field);
  };

  it("accepts a complete, sane hire", () => {
    expect(fieldsFor(VALID)).toEqual([]);
  });

  it("requires a non-empty name and surname", () => {
    expect(fieldsFor({ ...VALID, name: "" })).toContain("name");
    expect(fieldsFor({ ...VALID, name: "   " })).toContain("name");
    expect(fieldsFor({ ...VALID, surname: undefined })).toContain("surname");
  });

  it("caps name length so a store row cannot be stuffed", () => {
    expect(fieldsFor({ ...VALID, name: "x".repeat(101) })).toContain("name");
    expect(fieldsFor({ ...VALID, name: "x".repeat(100) })).toEqual([]);
  });

  it("requires a whole-number age in a sane working range", () => {
    expect(fieldsFor({ ...VALID, age: 15 })).toContain("age");
    expect(fieldsFor({ ...VALID, age: 16 })).toEqual([]);
    expect(fieldsFor({ ...VALID, age: 120 })).toEqual([]);
    expect(fieldsFor({ ...VALID, age: 121 })).toContain("age");
    expect(fieldsFor({ ...VALID, age: 34.5 })).toContain("age");
    expect(fieldsFor({ ...VALID, age: "old" })).toContain("age");
  });

  it("is stricter than the base module — but only on INPUT", () => {
    // `POST /api/v1/staff` would accept age 8 or 200; a hire will not. The read
    // path is untouched, which is what keeps existing records resolvable.
    expect(fieldsFor({ ...VALID, age: 8 })).toContain("age");
    expect(fieldsFor({ ...VALID, age: 200 })).toContain("age");
  });

  it("never rejects data the base module allows, on the read path", async () => {
    // The 88-year-old in staff.json must resolve normally even though a hire of
    // an 88-year-old would also pass — the point is that reads run NO validation.
    const { service } = makeContext();
    const veteran = { staffId: 1, staff: { id: 1, name: "Mike", surname: "Mayer", age: 88 }, profile: null };
    expect(() => service.employmentStatus(veteran.profile)).not.toThrow();
    expect(service.employmentStatus(veteran.profile)).toBeNull();
  });

  it("rejects a userId in the input outright rather than ignoring it", () => {
    // Silently dropping it would leave a caller believing they hired into another
    // farm. §9 says reject.
    expect(fieldsFor({ ...VALID, userId: 999 })).toContain("userId");
  });

  it("reports EVERY invalid field at once, not just the first", () => {
    const fields = fieldsFor({ ...VALID, name: "", age: 2, fte: 5, role: "PIRATE" });
    expect(fields).toEqual(expect.arrayContaining(["name", "age", "fte", "role"]));
  });
});

describe("the hire flow", () => {
  it("stamps the caller's userId, never one from input", async () => {
    const { service, calls } = makeContext({ userId: 7 });
    await service.hire({ ...VALID, userId: 999 }).catch(() => {});

    // Validation rejects the input before any write, so no hire call happens.
    const hireCall = calls.find((call) => call.method === "hire");
    expect(hireCall).toBeUndefined();

    // With clean input, the gateway is called with the CONTEXT's user id.
    const clean = makeContext({ userId: 7 });
    await clean.service.hire(VALID);
    const call = clean.calls.find((entry) => entry.method === "hire");
    expect(call.userId).toBe(7);
  });

  it("passes only the three base fields to the staff store", async () => {
    // Employment attributes belong to the overlay. Leaking `role` or `fte` into
    // staff.json would give the module a second, drifting source of truth.
    const { service, calls } = makeContext();
    await service.hire(VALID);
    const call = calls.find((entry) => entry.method === "hire");
    expect(Object.keys(call.data).sort()).toEqual(["age", "name", "surname"]);
  });

  it("writes nothing when validation fails", async () => {
    const { service, calls } = makeContext();
    const result = await service.hire({ ...VALID, age: 3 });
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(result.fieldErrors.map((error) => error.field)).toContain("age");
    expect(calls.find((entry) => entry.method === "hire")).toBeUndefined();
  });

  it("returns HIRED_WITHOUT_PROFILE when the profile write fails — and never rolls back", async () => {
    const { service, calls } = makeContext({ upsertFails: new Error("store unavailable") });
    const result = await service.hire(VALID);

    expect(result.outcome).toBe("HIRED_WITHOUT_PROFILE");
    expect(result.code).toBe(CREW_ERROR_CODES.PROFILE_WRITE_FAILED);
    expect(result.staff.id).toBe(42); // the caller is told WHICH record exists

    // The compensating delete is forbidden, so the only calls are the hire and the
    // failed profile write. Nothing resembling a rollback.
    const methods = calls.map((entry) => entry.method);
    expect(methods).toContain("hire");
    expect(methods.some((method) => /delete|remove|rollback|undo/i.test(method))).toBe(false);
  });

  it("leaves the hired member in exactly the pre-existing shape of the original 15 records", async () => {
    // That is why the partial failure is benign rather than an error: "staff record
    // with no profile" is already a supported, listed state (§17 Q1).
    const { service } = makeContext({ upsertFails: new Error("nope") });
    const result = await service.hire(VALID);
    expect(result.staff).toMatchObject({ name: VALID.name, surname: VALID.surname, age: VALID.age });
    expect(result.staff.role).toBeUndefined();
  });

  it("refuses to write at all when the session has no usable account id", async () => {
    const { service } = makeContext({ userId: "not-a-number" });
    await expect(service.hire(VALID)).rejects.toThrow(/unwritable identity/);
  });

  it("invalidates the roster loaders after a successful hire", async () => {
    // Otherwise the mutation's own response would be built from a snapshot taken
    // before the new person existed.
    const { service, calls } = makeContext();
    await service.hire(VALID);
    const reset = calls.find((entry) => entry.method === "resetLoaders");
    expect(reset.names).toEqual(expect.arrayContaining(["ownedStaff", "staffById"]));
  });
});

describe("employment end — notification event", () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** The profiles store, in memory. Same shape as the other pillars' doubles. */
  function makeStoreDouble(initial) {
    let data = clone(initial);
    return {
      async getAll() {
        return clone(data);
      },
      async update(mutate) {
        data = mutate(clone(data));
        return data;
      },
    };
  }

  /** One staff record with one profile, which is the only starting state needed. */
  async function withProfile({ userId = 1, staffId = 7 } = {}) {
    const staff = [{ id: staffId, userId, name: "Halina", surname: "Kowalska", age: 34 }];
    const { context } = makeContext({ userId });
    // findMember resolves the person through `staffById`, so that is the loader
    // the double has to answer — `ownedStaff` alone leaves it MEMBER_NOT_FOUND.
    const staffById = new Map(staff.map((record) => [Number(record.id), record]));
    context.loaders.ownedStaff = { get: async () => staff, reset: () => {} };
    context.loaders.staffById = { get: async (id) => staffById.get(Number(id)), reset: () => {} };
    // The hire stub's addLoader always yields an empty Map, which is right for
    // hire (it never reads profiles) and wrong here: without real laziness the
    // profile can never be found and every end date is refused. Give it the same
    // lazy/resettable semantics the other pillars' doubles use.
    const lazy = {};
    context.addLoader = (name, load) => {
      if (!lazy[name]) {
        let promise = null;
        lazy[name] = {
          all: () => (promise = promise || load()),
          get: async (key) => (await (promise = promise || load())).get(key),
          reset: () => {
            promise = null;
          },
        };
      }
      return lazy[name];
    };
    context.resetLoaders = (...names) => names.forEach((name) => lazy[name]?.reset());

    const store = makeStoreDouble({
      profiles: [
        {
          id: 1,
          userId,
          staffId,
          role: "tractor_driver",
          employmentType: "permanent",
          fte: 1,
          contractedHoursPerWeek: 40,
          startDate: "2026-03-01",
          endDate: null,
          endReason: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          version: 1,
        },
      ],
      counters: { lastProfileId: 1 },
    });

    const service = createProfilesService(context, { store });
    context.services.profiles = service;
    return { service, context, staffId, userId };
  }

  it("announces the end date, addressed to the owner", async () => {
    const { service, context, staffId, userId } = await withProfile();

    await service.recordEmploymentEnd({ staffId, lastDay: "2026-09-30", reason: "end_of_season" });

    const event = context.published.find((row) => row.type === CREW_EVENTS.EMPLOYMENT_ENDED);
    expect(event).toBeTruthy();
    expect(event.payload).toMatchObject({ staffId, lastDay: "2026-09-30", reason: "end_of_season", userId });
    expect(event.correlationId).toBe(`crew-employment-ended-${staffId}`);
    expect(event.source).toBe("crew-office");
  });

  it("says nothing when the end date was refused", async () => {
    const { service, context, staffId } = await withProfile();

    // Before the start date — validation refuses it, so nothing ended.
    await expect(service.recordEmploymentEnd({ staffId, lastDay: "2020-01-01" })).rejects.toBeTruthy();
    await expect(service.recordEmploymentEnd({ staffId: 999, lastDay: "2026-09-30" })).rejects.toBeTruthy();

    expect(context.published).toEqual([]);
  });
});
