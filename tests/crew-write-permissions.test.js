import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

// THE §12.2 write-permission matrix (PRD §14.4 item 2).
//
// This is the test that encodes the module's central constraint: **hire yes, fire
// no, assignments never.** Without it the rule is a comment, and a future "tidy up"
// that adds an update path to staff.json would pass review.
//
// It works by spying on the real JSONDatabase write methods for every pre-existing
// store, then driving every crew mutation there is. `add` on staff is permitted
// from the hire flow and from nowhere else; every other write to a pre-existing
// store is a failure.
const {
  app,
  getFlags,
  setCrewEnabled,
  restoreFlags,
  tokenFor,
  resetCrewStores,
  graph,
  graphData,
  HIRE_MUTATION,
  VALID_HIRE_INPUT,
} = require("./helpers/crew-harness");

const dbManager = require("../data/database-manager");
const ResourceService = require("../services/resource.service");

const USER_ID = 1;

/**
 * Wrap every mutating method of a JSONDatabase so calls are recorded rather than
 * merely counted — the assertion needs to name WHICH store was written.
 */
function spyOnStore(label, db, log) {
  const spies = [];
  for (const method of ["add", "update", "remove", "replaceAll", "write", "persist"]) {
    if (typeof db[method] !== "function") continue;
    const original = db[method].bind(db);
    const spy = vi.spyOn(db, method).mockImplementation(async (...args) => {
      log.push({ store: label, method });
      return original(...args);
    });
    spies.push(spy);
  }
  return spies;
}

describe("Crew Office — the write-permission matrix (§12.2)", () => {
  let originalFlags;
  let token;
  let writes;
  let spies;
  let cascadeSpy;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenFor(USER_ID);
    await setCrewEnabled(true);
  });

  afterAll(async () => {
    await restoreFlags(originalFlags);
  });

  beforeEach(async () => {
    await resetCrewStores();
    writes = [];
    spies = [
      ...spyOnStore("staff", dbManager.getStaffDatabase(), writes),
      ...spyOnStore("assignments", dbManager.getAssignmentsDatabase(), writes),
      ...spyOnStore("financial", dbManager.getFinancialDatabase(), writes),
      ...spyOnStore("fields", dbManager.getFieldsDatabase(), writes),
      ...spyOnStore("animals", dbManager.getAnimalsDatabase(), writes),
    ];
    // The forbidden call, watched directly rather than inferred from its effects.
    cascadeSpy = vi.spyOn(ResourceService, "cascadeDelete");
  });

  // Restored unconditionally, so a failing assertion cannot leave the real store
  // methods wrapped for whatever runs next.
  afterEach(() => {
    restoreSpies();
  });

  const restoreSpies = () => {
    for (const spy of spies) spy.mockRestore();
    if (cascadeSpy) cascadeSpy.mockRestore();
  };

  /** Writes to a pre-existing store, excluding the one permitted case. */
  const forbiddenWrites = () =>
    writes.filter((entry) => !(entry.store === "staff" && (entry.method === "add" || entry.method === "persist")));

  describe("hire — the ONE permitted write to a pre-existing store", () => {
    it("creates a staff record and a profile, and touches nothing else", async () => {
      const data = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      expect(data.hireCrewMember.__typename).toBe("CrewMemberHired");

      expect(writes.some((entry) => entry.store === "staff" && entry.method === "add")).toBe(true);
      expect(forbiddenWrites()).toEqual([]);
      expect(cascadeSpy).not.toHaveBeenCalled();
      restoreSpies();
    });

    it("makes the hired member visible through the EXISTING staff REST API", async () => {
      // Indistinguishable downstream: the hire went through ResourceService, so a
      // Crew Office hire and a hire via POST /api/v1/staff produce the same record.
      const data = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = Number(data.hireCrewMember.crewMember.staffId);
      restoreSpies();

      const rest = await request(app).get("/api/v1/staff").set("Cookie", `rolnopolToken=${token}`).expect(200);
      const records = rest.body?.data ?? rest.body;
      const list = Array.isArray(records) ? records : records?.staff || [];
      const found = list.find((record) => Number(record.id) === staffId);
      expect(found).toBeDefined();
      expect(found.name).toBe(VALID_HIRE_INPUT.name);
      // Only the three base fields — no employment attributes leaked into staff.json.
      expect(Object.keys(found).sort()).toEqual(["age", "id", "name", "surname", "userId"]);
    });

    it("stamps the CALLER's userId and rejects one supplied in input", async () => {
      const res = await graph({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, name: "Impostor" } },
        token,
      });
      restoreSpies();
      expect(res.body.data.hireCrewMember.__typename).toBe("CrewMemberHired");

      // `userId` is not even in the input type, so supplying it is a validation
      // error from the schema itself — rejected outright, never ignored.
      const withUserId = await graph({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, userId: 999 } },
        token,
      });
      expect(withUserId.status).toBe(400);
      expect(JSON.stringify(withUserId.body.errors)).toMatch(/userId/);
    });

    it("writes nothing at all when hire input is invalid", async () => {
      const data = await graphData({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, age: 2, fte: 9 } },
        token,
      });
      expect(data.hireCrewMember.__typename).toBe("HireValidationFailed");
      // Nothing created in either store — the check happens before any write.
      expect(writes.filter((entry) => entry.store === "staff")).toEqual([]);
      restoreSpies();
    });
  });

  describe("no crew operation ever updates or deletes a staff record", () => {
    it("upsertCrewProfile writes only the crew overlay", async () => {
      const roster = await graphData({ query: "{ crew(first: 1) { nodes { staffId } } }", token });
      const staffId = roster.crew.nodes[0]?.staffId;
      if (!staffId) return restoreSpies();

      const data = await graphData({
        query: `mutation U($input: CrewProfileInput!) {
          upsertCrewProfile(input: $input) { __typename ... on CrewProfileUpserted { crewMember { profile { role version } } } }
        }`,
        variables: { input: { staffId, role: "AGRONOMIST", employmentType: "PERMANENT", fte: 0.8, startDate: "2025-06-01" } },
        token,
      });
      expect(data.upsertCrewProfile.__typename).toBe("CrewProfileUpserted");
      expect(forbiddenWrites()).toEqual([]);
      // Not even an `add` to staff — an upsert never creates a person.
      expect(writes.filter((entry) => entry.store === "staff" && entry.method === "add")).toEqual([]);
      restoreSpies();
    });

    it("recordEmploymentEnd leaves the staff record and its assignments intact", async () => {
      const hired = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = hired.hireCrewMember.crewMember.staffId;
      writes.length = 0; // measure only the end-employment step

      const ended = await graphData({
        query: `mutation E($id: ID!, $day: Date!) {
          recordEmploymentEnd(staffId: $id, lastDay: $day, reason: "season over") {
            __typename
            ... on EmploymentEnded { lastDay crewMember { staffId name profile { endDate endReason employmentStatus } } }
          }
        }`,
        variables: { id: staffId, day: "2026-11-30" },
        token,
      });

      expect(ended.recordEmploymentEnd.__typename).toBe("EmploymentEnded");
      expect(ended.recordEmploymentEnd.crewMember.profile.endDate).toBe("2026-11-30");
      // The person is still there, with their name — this is not a deletion.
      expect(ended.recordEmploymentEnd.crewMember.name).toBe(VALID_HIRE_INPUT.name);

      expect(forbiddenWrites()).toEqual([]);
      expect(cascadeSpy).not.toHaveBeenCalled();
      restoreSpies();

      // And the staff record survives in the base module.
      const rest = await request(app).get("/api/v1/staff").set("Cookie", `rolnopolToken=${token}`).expect(200);
      const list = rest.body?.data ?? rest.body;
      expect((Array.isArray(list) ? list : []).some((record) => Number(record.id) === Number(staffId))).toBe(true);
    });

    it("financial.json is not even read, let alone written (§2.2 — no money in v1)", async () => {
      await graphData({ query: "{ crew { nodes { staffId profile { role } } } crewInfo { crewSize } }", token });
      expect(writes.filter((entry) => entry.store === "financial")).toEqual([]);
      restoreSpies();
    });
  });

  describe("the forbidden-call list", () => {
    it("cascadeDelete, assignStaffToField and removeAssignment are never invoked", async () => {
      // These two are prototype methods, not statics — spying on the class object
      // would watch something that is never called and pass for the wrong reason.
      const assignSpy = vi.spyOn(ResourceService.prototype, "assignStaffToField");
      const removeSpy = vi.spyOn(ResourceService.prototype, "removeAssignment");

      // Drive every mutation the module has.
      const hired = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = hired.hireCrewMember.crewMember.staffId;
      await graphData({
        query: `mutation U($input: CrewProfileInput!) { upsertCrewProfile(input: $input) { __typename } }`,
        variables: { input: { staffId, notes: "moved to the north barn" } },
        token,
      });
      await graphData({
        query: `mutation E($id: ID!, $day: Date!) { recordEmploymentEnd(staffId: $id, lastDay: $day) { __typename } }`,
        variables: { id: staffId, day: "2026-12-01" },
        token,
      });

      expect(cascadeSpy).not.toHaveBeenCalled();
      expect(assignSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();

      assignSpy.mockRestore();
      removeSpy.mockRestore();
      restoreSpies();
    });

    it("the staff gateway exports no update or delete function — firing is unimplemented, not merely forbidden", () => {
      const { createStaffGateway } = require("../services/crew/staff-gateway");
      const gateway = createStaffGateway({});
      expect(Object.keys(gateway).sort()).toEqual(["findOwned", "hire", "listOwned"]);
      for (const name of Object.keys(gateway)) {
        expect(name).not.toMatch(/update|delete|remove|fire|terminate/i);
      }
      restoreSpies();
    });
  });

  describe("orphans degrade, never crash (§12 rule 4)", () => {
    it("survives a staff record deleted through the REST API from under the overlay", async () => {
      const hired = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = hired.hireCrewMember.crewMember.staffId;
      restoreSpies();

      // The base module's own DELETE — the path the entity's owner controls, and
      // the most likely real crash.
      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`).expect(200);

      // A 500 here is the bug. The overlay row must resolve, null-safe.
      const res = await graph({
        query: `query M($id: ID!) {
          crewMember(staffId: $id) { staffId name surname age orphaned profile { role } }
          orphanedOverlays { pillar staffId rowId detail }
        }`,
        variables: { id: staffId },
        token,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.crewMember.orphaned).toBe(true);
      expect(res.body.data.crewMember.name).toBeNull();
      expect(res.body.data.crewMember.profile.role).toBe(VALID_HIRE_INPUT.role);

      const reported = res.body.data.orphanedOverlays.find((row) => row.staffId === String(staffId));
      expect(reported).toBeDefined();
      expect(reported.pillar).toBe("profiles");
    });

    it("keeps the orphan out of the default roster but shows it on request", async () => {
      const hired = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = hired.hireCrewMember.crewMember.staffId;
      restoreSpies();
      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`).expect(200);

      const normal = await graphData({ query: "{ crew { nodes { staffId } } }", token });
      expect(normal.crew.nodes.some((node) => node.staffId === String(staffId))).toBe(false);

      const including = await graphData({
        query: "{ crew(filter: { includeOrphaned: true }) { nodes { staffId orphaned } } }",
        token,
      });
      const orphan = including.crew.nodes.find((node) => node.staffId === String(staffId));
      expect(orphan).toBeDefined();
      expect(orphan.orphaned).toBe(true);
    });
  });

  describe("optimistic concurrency", () => {
    it("refuses a stale expectedVersion instead of overwriting a newer write", async () => {
      const hired = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = hired.hireCrewMember.crewMember.staffId;
      restoreSpies();

      const MUTATION = `mutation U($input: CrewProfileInput!) {
        upsertCrewProfile(input: $input) {
          __typename
          ... on CrewProfileUpserted { crewMember { profile { version notes } } }
          ... on VersionConflict { staffId expectedVersion actualVersion }
        }
      }`;

      const first = await graphData({ query: MUTATION, variables: { input: { staffId, notes: "first", expectedVersion: 1 } }, token });
      expect(first.upsertCrewProfile.crewMember.profile.version).toBe(2);

      // Second writer still holding version 1 — must lose, not clobber.
      const stale = await graphData({ query: MUTATION, variables: { input: { staffId, notes: "stale", expectedVersion: 1 } }, token });
      expect(stale.upsertCrewProfile.__typename).toBe("VersionConflict");
      expect(stale.upsertCrewProfile).toMatchObject({ expectedVersion: 1, actualVersion: 2 });

      const after = await graphData({
        query: "query M($id: ID!) { crewMember(staffId: $id) { profile { notes version } } }",
        variables: { id: staffId },
        token,
      });
      expect(after.crewMember.profile.notes).toBe("first"); // the winner stands
    });
  });
});
