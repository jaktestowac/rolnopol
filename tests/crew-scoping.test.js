import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// Cross-user data isolation (PRD §9, §14.2). §16 rates leakage the top real-world
// bug this module could introduce, so this suite is non-negotiable: two real users,
// every query and every mutation attempted across the boundary.
//
// The specific contract being pinned is that an unowned id is answered exactly like
// a nonexistent one — `MEMBER_NOT_FOUND`, never `FORBIDDEN`. A distinguishable
// refusal would let a caller enumerate other people's staff ids by probing.
const {
  getFlags,
  setCrewEnabled,
  restoreFlags,
  resetCrewStores,
  graph,
  graphData,
  registerAndLogin,
  HIRE_MUTATION,
  VALID_HIRE_INPUT,
} = require("./helpers/crew-harness");

const MEMBER_QUERY = `query M($id: ID!) { crewMember(staffId: $id) { staffId name surname profile { role notes } } }`;
const UPSERT = `mutation U($input: CrewProfileInput!) {
  upsertCrewProfile(input: $input) {
    __typename
    ... on CrewProfileUpserted { crewMember { staffId profile { role notes } } }
    ... on MemberNotFound { staffId }
  }
}`;
const END = `mutation E($id: ID!, $day: Date!) {
  recordEmploymentEnd(staffId: $id, lastDay: $day) {
    __typename
    ... on EmploymentEnded { crewMember { staffId } }
    ... on MemberNotFound { staffId }
  }
}`;

describe("Crew Office — cross-user scoping", () => {
  let originalFlags;
  let alice;
  let bob;
  let aliceStaffId;
  let bobStaffId;

  beforeAll(async () => {
    originalFlags = await getFlags();
    await setCrewEnabled(true);
    await resetCrewStores();

    alice = await registerAndLogin("crew-alice");
    bob = await registerAndLogin("crew-bob");

    // Each hires one person, so both own a crew member with a real profile.
    const aliceHire = await graphData({
      query: HIRE_MUTATION,
      variables: { input: { ...VALID_HIRE_INPUT, name: "Alicja", surname: "Nowak" } },
      token: alice.token,
    });
    aliceStaffId = aliceHire.hireCrewMember.crewMember.staffId;

    const bobHire = await graphData({
      query: HIRE_MUTATION,
      variables: { input: { ...VALID_HIRE_INPUT, name: "Bogdan", surname: "Wisniewski", role: "MECHANIC" } },
      token: bob.token,
    });
    bobStaffId = bobHire.hireCrewMember.crewMember.staffId;
  });

  afterAll(async () => {
    await restoreFlags(originalFlags);
  });

  it("gives each user their own crew, and only their own", async () => {
    const aliceCrew = await graphData({ query: "{ crew { totalCount nodes { staffId name } } }", token: alice.token });
    const bobCrew = await graphData({ query: "{ crew { totalCount nodes { staffId name } } }", token: bob.token });

    const aliceIds = aliceCrew.crew.nodes.map((node) => node.staffId);
    const bobIds = bobCrew.crew.nodes.map((node) => node.staffId);

    expect(aliceIds).toContain(aliceStaffId);
    expect(aliceIds).not.toContain(bobStaffId);
    expect(bobIds).toContain(bobStaffId);
    expect(bobIds).not.toContain(aliceStaffId);

    // And no name from the other farm appears anywhere in the payload.
    expect(JSON.stringify(aliceCrew)).not.toMatch(/Bogdan/);
    expect(JSON.stringify(bobCrew)).not.toMatch(/Alicja/);
  });

  it("reports crewInfo.crewSize per user, not globally", async () => {
    const aliceInfo = await graphData({ query: "{ crewInfo { crewSize } }", token: alice.token });
    const bobInfo = await graphData({ query: "{ crewInfo { crewSize } }", token: bob.token });
    // Each user hired exactly one person and owns no seeded staff.
    expect(aliceInfo.crewInfo.crewSize).toBe(1);
    expect(bobInfo.crewInfo.crewSize).toBe(1);
  });

  it("answers a cross-user crewMember query with null — no data, no hint", async () => {
    const data = await graphData({ query: MEMBER_QUERY, variables: { id: bobStaffId }, token: alice.token });
    expect(data.crewMember).toBeNull();
  });

  it("makes an unowned id indistinguishable from a nonexistent one", async () => {
    // The anti-enumeration property. If these two answers differed, probing ids
    // would map out another user's crew.
    const unowned = await graph({ query: MEMBER_QUERY, variables: { id: bobStaffId }, token: alice.token });
    const nonexistent = await graph({ query: MEMBER_QUERY, variables: { id: "987654321" }, token: alice.token });

    expect(unowned.status).toBe(nonexistent.status);
    expect(unowned.body.data).toEqual(nonexistent.body.data);
    expect(unowned.body.errors).toEqual(nonexistent.body.errors);
  });

  it("refuses a cross-user upsert with MemberNotFound rather than Forbidden", async () => {
    const data = await graphData({
      query: UPSERT,
      variables: { input: { staffId: bobStaffId, notes: "written by Alice" } },
      token: alice.token,
    });
    expect(data.upsertCrewProfile.__typename).toBe("MemberNotFound");
    // Never a code that admits the record exists.
    expect(data.upsertCrewProfile.__typename).not.toBe("ProfileValidationFailed");
  });

  it("leaves the other user's profile untouched after a refused cross-user write", async () => {
    await graphData({
      query: UPSERT,
      variables: { input: { staffId: bobStaffId, role: "MANAGER", notes: "hostile takeover" } },
      token: alice.token,
    });

    const bobView = await graphData({ query: MEMBER_QUERY, variables: { id: bobStaffId }, token: bob.token });
    expect(bobView.crewMember.profile.role).toBe("MECHANIC"); // unchanged
    expect(bobView.crewMember.profile.notes).not.toBe("hostile takeover");
  });

  it("refuses a cross-user recordEmploymentEnd", async () => {
    const data = await graphData({
      query: END,
      variables: { id: bobStaffId, day: "2026-12-31" },
      token: alice.token,
    });
    expect(data.recordEmploymentEnd.__typename).toBe("MemberNotFound");

    // Bob's man is still employed.
    const bobView = await graphData({
      query: "query M($id: ID!) { crewMember(staffId: $id) { profile { endDate employmentStatus } } }",
      variables: { id: bobStaffId },
      token: bob.token,
    });
    expect(bobView.crewMember.profile.endDate).toBeNull();
  });

  it("scopes orphanedOverlays to the caller", async () => {
    const aliceOrphans = await graphData({ query: "{ orphanedOverlays { staffId } }", token: alice.token });
    const ids = aliceOrphans.orphanedOverlays.map((row) => row.staffId);
    expect(ids).not.toContain(bobStaffId);
  });

  it("stamps a hire with the caller's own userId, so it lands in their crew and no one else's", async () => {
    const hire = await graphData({
      query: HIRE_MUTATION,
      variables: { input: { ...VALID_HIRE_INPUT, name: "Zofia", surname: "Lis" } },
      token: alice.token,
    });
    const newId = hire.hireCrewMember.crewMember.staffId;

    const aliceCrew = await graphData({ query: "{ crew { nodes { staffId } } }", token: alice.token });
    expect(aliceCrew.crew.nodes.map((node) => node.staffId)).toContain(newId);

    const bobSees = await graphData({ query: MEMBER_QUERY, variables: { id: newId }, token: bob.token });
    expect(bobSees.crewMember).toBeNull();
  });

  it("enforces scoping in the SERVICE layer, not in the resolvers", async () => {
    // §9: a future transport must not be able to bypass isolation by calling the
    // service directly, so the check is asserted below the graph entirely.
    const { assembleCrewSchema } = require("../services/crew/registry");
    const { createCrewContext } = require("../services/crew/context");
    const { pillars } = assembleCrewSchema();

    const aliceContext = createCrewContext({ userId: alice.userId, pillars });
    const bobContext = createCrewContext({ userId: bob.userId, pillars });

    // No resolver involved — straight at the service.
    expect(await aliceContext.services.profiles.findMember(bobStaffId)).toBeNull();
    expect(await bobContext.services.profiles.findMember(aliceStaffId)).toBeNull();

    const aliceRoster = await aliceContext.services.profiles.listCrew({});
    expect(aliceRoster.map((member) => String(member.staffId))).not.toContain(String(bobStaffId));
  });
});
