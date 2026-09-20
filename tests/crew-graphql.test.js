import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

// The graph endpoint end to end (PRD §14.2).
//
// Covers the transport contract rather than the domain: status codes, the
// `extensions` block, the SDL endpoint, and the refusals that keep the endpoint
// from being a CSRF-simple-request target. Domain behaviour lives in
// crew-write-permissions and crew-scoping.
const {
  app,
  GRAPH,
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

describe("Crew Office GraphQL endpoint", () => {
  let originalFlags;
  let token;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenFor(1); // user 1 owns the seeded staff records
    await setCrewEnabled(true);
  });

  afterAll(async () => {
    await restoreFlags(originalFlags);
  });

  beforeEach(async () => {
    await resetCrewStores();
  });

  describe("the gate still applies to the graph", () => {
    it("404s with the flag off, for an authenticated caller", async () => {
      await setCrewEnabled(false);
      await graph({ query: "{ crewInfo { pillars } }", token }).expect(404);
      await request(app).get(GRAPH).set("Cookie", `rolnopolToken=${token}`).expect(404);
      await setCrewEnabled(true);
    });

    it("401s anonymously and 403s on a bad token", async () => {
      const anonymous = await graph({ query: "{ crewInfo { pillars } }" });
      expect(anonymous.status).toBe(401);

      const badToken = await graph({ query: "{ crewInfo { pillars } }", token: "not-a-real-token" });
      expect(badToken.status).toBe(403);
    });
  });

  describe("queries", () => {
    it("resolves crewInfo with the assembled pillar set", async () => {
      const data = await graphData({ query: "{ crewInfo { pillars crewSize serverTime } }", token });
      expect(data.crewInfo.pillars).toContain("profiles");
      expect(typeof data.crewInfo.crewSize).toBe("number");
      // serverTime is the server's, from the request clock — never the client's.
      expect(data.crewInfo.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it("serves the roster with base identity joined from staff.json", async () => {
      const data = await graphData({
        query: "{ crew { totalCount hasMore nodes { staffId name surname age orphaned assignedFieldIds } } }",
        token,
      });
      expect(Array.isArray(data.crew.nodes)).toBe(true);
      for (const node of data.crew.nodes) {
        expect(node.staffId).toMatch(/^\d+$/);
        expect(node.orphaned).toBe(false);
        expect(Array.isArray(node.assignedFieldIds)).toBe(true);
      }
    });

    it("paginates with first, reporting the filtered total rather than the page size", async () => {
      const all = await graphData({ query: "{ crew { totalCount } }", token });
      if (all.crew.totalCount < 2) return; // this user owns too little to page

      const page = await graphData({ query: "{ crew(first: 1) { totalCount hasMore nodes { staffId } } }", token });
      expect(page.crew.nodes).toHaveLength(1);
      expect(page.crew.totalCount).toBe(all.crew.totalCount);
      expect(page.crew.hasMore).toBe(true);
    });

    it("returns null for an unknown crewMember rather than erroring", async () => {
      const data = await graphData({ query: '{ crewMember(staffId: "999999") { staffId } }', token });
      expect(data.crewMember).toBeNull();
    });

    it("answers a four-field member query in ONE round trip", async () => {
      // The reason the module is graph-shaped at all (§1): this would be four
      // REST calls.
      const res = await graph({
        query: `{
          crewInfo { crewSize }
          crew(first: 2) { nodes { staffId name profile { role employmentStatus } assignedFieldIds } }
          orphanedOverlays { pillar staffId }
        }`,
        token,
      });
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.crewInfo).toBeDefined();
      expect(res.body.data.crew).toBeDefined();
      expect(res.body.data.orphanedOverlays).toBeDefined();
    });
  });

  describe("extensions", () => {
    it("echoes the pillar set, cost, depth and store reads", async () => {
      const res = await graph({ query: "{ crew { nodes { staffId } } }", token });
      // Compared against the registry rather than a hard-coded list, so a new
      // pillar does not break a test that is not about pillars.
      const { assembleCrewSchema } = require("../services/crew/registry");
      const assembled = assembleCrewSchema().pillars.map((pillar) => pillar.name);
      expect(res.body.extensions.pillars).toEqual(assembled);
      expect(res.body.extensions.pillars).toContain("profiles");
      expect(res.body.extensions.cost).toBeGreaterThan(0);
      expect(res.body.extensions.depth).toBeGreaterThan(0);
      expect(typeof res.body.extensions.storeReads).toBe("number");
      expect(typeof res.body.extensions.durationMs).toBe("number");
    });

    it("keeps store reads flat as the query widens — batching, not N+1", async () => {
      // Same roster, one field vs. every field. If reads scaled per member (or
      // per field), the second number would climb.
      const narrow = await graph({ query: "{ crew { nodes { staffId } } }", token });
      const wide = await graph({
        query: "{ crew { nodes { staffId name surname age orphaned assignedFieldIds profile { role fte employmentStatus tenureDays } } } }",
        token,
      });
      expect(wide.body.extensions.storeReads).toBeLessThanOrEqual(narrow.body.extensions.storeReads + 1);
      expect(wide.body.extensions.storeReads).toBeLessThan(6);
    });
  });

  describe("error shapes (§7.3)", () => {
    it("400 with NO data key for an unknown field", async () => {
      const res = await graph({ query: "{ crew { nodes { vacation } } }", token });
      expect(res.status).toBe(400);
      expect("data" in res.body).toBe(false);
      expect(res.body.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
      expect(res.body.errors[0].message).toMatch(/Cannot query field "vacation"/);
    });

    it("400 for a syntax error", async () => {
      const res = await graph({ query: "{ crew { nodes {", token });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].extensions.code).toBe("GRAPHQL_PARSE_FAILED");
    });

    it("400 for a variable that does not match its declared type", async () => {
      const res = await graph({
        query: "query Q($id: ID!) { crewMember(staffId: $id) { staffId } }",
        variables: { id: { nested: "object" } },
        token,
      });
      expect(res.status).toBe(400);
      expect("data" in res.body).toBe(false);
    });

    it("400 for a bad custom-scalar literal, with the scalar's own message", async () => {
      const res = await graph({
        query: 'mutation { recordEmploymentEnd(staffId: "1", lastDay: "2026-02-30") { __typename } }',
        token,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.errors)).toMatch(/not a real calendar date/);
    });

    it("rejects the same bad date supplied as a VARIABLE — coercion parity over HTTP", async () => {
      const res = await graph({
        query: 'mutation M($day: Date!) { recordEmploymentEnd(staffId: "1", lastDay: $day) { __typename } }',
        variables: { day: "2026-02-30" },
        token,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.errors)).toMatch(/not a real calendar date/);
    });

    it("400 with QUERY_TOO_DEEP for an absurdly nested query", async () => {
      // profile → crewMember has no cycle to exploit, so nest through aliases on
      // the connection instead; the guard counts levels, not types.
      let query = "{ crew { nodes { profile { role } } } }";
      for (let index = 0; index < 12; index += 1) query = `{ crew { nodes { ${query.slice(1, -1)} } } }`;
      const res = await graph({ query, token });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].extensions.code).toBe("QUERY_TOO_DEEP");
    });
  });

  describe("transport refusals", () => {
    it("refuses a non-JSON content type, so a form post cannot reach it", async () => {
      const res = await request(app)
        .post(GRAPH)
        .set("Cookie", `rolnopolToken=${token}`)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send("query={ crewInfo { pillars } }");
      expect(res.status).toBe(415);
      expect(res.body.errors[0].extensions.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("refuses an oversized document before parsing it", async () => {
      // 70KB: over this endpoint's own 64KB cap but under express.json()'s 100kb
      // default, so the refusal that fires is the GraphQL-shaped one.
      const res = await graph({ query: `{ crewInfo { pillars } }${" ".repeat(70 * 1024)}`, token });
      expect(res.status).toBe(413);
      expect(res.body.errors[0].extensions.code).toBe("DOCUMENT_TOO_LARGE");
    });

    it("refuses non-object variables", async () => {
      const res = await graph({ query: "{ crewInfo { pillars } }", variables: ["not", "an", "object"], token });
      expect(res.status).toBe(400);
    });

    it("cannot run a mutation over GET — GET serves the SDL and nothing else", async () => {
      const res = await request(app)
        .get(`${GRAPH}?query=${encodeURIComponent("mutation { hireCrewMember(input: {}) { __typename } }")}`)
        .set("Cookie", `rolnopolToken=${token}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(res.text).toMatch(/type CrewMember/); // the schema, not a mutation result
    });
  });

  describe("the SDL endpoint", () => {
    it("serves the assembled schema with the error catalogue above it", async () => {
      const res = await request(app).get(GRAPH).set("Cookie", `rolnopolToken=${token}`).expect(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(res.text).toMatch(/type CrewMember/);
      expect(res.text).toMatch(/MEMBER_NOT_FOUND/);
      expect(res.text).toMatch(/GRAPHQL_VALIDATION_FAILED/);
      expect(res.text).toMatch(/Assembled pillars: profiles/);
      // The promise, printed where a client will read it.
      expect(res.text).toMatch(/hire but never fire/);
    });

    it("introspection works, and never mentions a delete mutation", async () => {
      const data = await graphData({
        query: "{ __schema { mutationType { fields { name } } } }",
        token,
      });
      const names = data.__schema.mutationType.fields.map((field) => field.name);
      expect(names).toContain("hireCrewMember");
      expect(names).toContain("recordEmploymentEnd");
      expect(names.some((name) => /delete|fire|terminate/i.test(name))).toBe(false);
    });
  });

  describe("mutations reach the domain", () => {
    it("hires through the graph and the new member appears in the roster", async () => {
      const hire = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      expect(hire.hireCrewMember.__typename).toBe("CrewMemberHired");
      expect(hire.hireCrewMember.crewMember.name).toBe(VALID_HIRE_INPUT.name);
      expect(hire.hireCrewMember.crewMember.profile.role).toBe(VALID_HIRE_INPUT.role);

      const staffId = hire.hireCrewMember.crewMember.staffId;
      const member = await graphData({
        query: "query M($id: ID!) { crewMember(staffId: $id) { name profile { role version } } }",
        variables: { id: staffId },
        token,
      });
      expect(member.crewMember.name).toBe(VALID_HIRE_INPUT.name);
      expect(member.crewMember.profile.version).toBe(1);
    });

    it("returns a typed union member for a validation failure, not a thrown error", async () => {
      const res = await graph({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, age: 4, fte: 2 } },
        token,
      });
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.hireCrewMember.__typename).toBe("HireValidationFailed");
      const fields = res.body.data.hireCrewMember.fieldErrors.map((error) => error.field);
      expect(fields).toContain("age");
      expect(fields).toContain("fte");
    });
  });

  // Phase 6's exit criterion, and the reason the whole module is a graph rather than
  // five more REST endpoints (§1, §5.2): **the whole four-pillar CrewMember resolves
  // in ONE round trip.** `crewMember { work { … } leave { … } training { … } tools { … } }`
  // is the query the person-detail page makes, and against the existing REST surface
  // it would be four requests whose answers arrive at four different moments.
  //
  // This is deliberately a shape test rather than a data test. It asserts that every
  // pillar contributed its field, that one HTTP request answers all of them, and that
  // the store-read count stays bounded — not what any particular member's hours are,
  // which each pillar's own suite owns.
  describe("the whole four-pillar CrewMember in one round trip (Phase 6 exit)", () => {
    const FOUR_PILLARS = `
      query FourPillars($id: ID!, $asOf: Date!, $week: Date!) {
        crewMember(staffId: $id) {
          staffId
          name
          orphaned
          profile { role fte employmentStatus tenureDays }
          work {
            nextShift { id status }
            shifts { id status }
            weeklyRollup(weekStarting: $week) { hours }
          }
          leave {
            balance(asOf: $asOf) { entitlement accrued taken booked remaining }
            nextBooked { id status }
          }
          training {
            compliant
            certifications { id status }
            expiringSoon { id daysUntilExpiry }
            complianceGaps { reason course { code } }
          }
          tools {
            onIssue { id dueBack isOverdueBack }
            overdue { id daysUntilDueBack }
            history(limit: 5) { id returnedAt conditionOnReturn }
          }
        }
      }
    `;

    const SET_POLICY = `
      mutation SetPolicy($input: LeavePolicyInput!) {
        setLeavePolicy(input: $input) { __typename ... on LeavePolicySet { policy { version } } }
      }
    `;

    /** Monday of the week containing today, which is what weeklyRollup wants. */
    function mondayOf(dateString) {
      const date = new Date(`${dateString}T00:00:00.000Z`);
      const shift = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - shift);
      return date.toISOString().slice(0, 10);
    }

    /**
     * A hired member with a leave policy in place.
     *
     * The policy is not scene-setting: the leave pillar refuses to compute a balance
     * without one, on purpose (§7.3 — "not configured" is a different answer from
     * "zero days"). The last test in this block leaves it out for exactly that reason.
     */
    async function member({ withPolicy = true } = {}) {
      if (withPolicy) {
        const policy = await graphData({
          query: SET_POLICY,
          variables: {
            input: {
              annualEntitlementDaysFullTime: 26,
              accrualMode: "UPFRONT",
              carryOverCapDays: 5,
              carryOverExpiresOn: "12-31",
              leaveYearStart: "01-01",
              publicHolidays: [],
              blackoutWindows: [],
              minNoticeDays: 0,
            },
          },
          token,
        });
        expect(policy.setLeavePolicy.__typename).toBe("LeavePolicySet");
      }

      const hire = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      expect(hire.hireCrewMember.__typename).toBe("CrewMemberHired");
      const today = new Date().toISOString().slice(0, 10);
      return { staffId: hire.hireCrewMember.crewMember.staffId, today, week: mondayOf(today) };
    }

    it("resolves all four pillars plus the profile in a single request", async () => {
      const { staffId, today, week } = await member();

      const res = await graph({ query: FOUR_PILLARS, variables: { id: staffId, asOf: today, week }, token });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const detail = res.body.data.crewMember;
      expect(detail.staffId).toBe(staffId);
      expect(detail.orphaned).toBe(false);
      expect(detail.profile.role).toBe(VALID_HIRE_INPUT.role);

      // Every pillar contributed. A pillar that failed to graft its field on would
      // leave `null` here rather than an object, which is the failure this catches.
      for (const pillar of ["work", "leave", "training", "tools"]) {
        expect(detail[pillar], `${pillar} did not resolve`).not.toBeNull();
      }

      // And each one answered with its own shape, not an empty husk.
      expect(Array.isArray(detail.work.shifts)).toBe(true);
      expect(typeof detail.leave.balance.remaining).toBe("number");
      expect(typeof detail.training.compliant).toBe("boolean");
      expect(Array.isArray(detail.tools.onIssue)).toBe(true);
      expect(Array.isArray(detail.tools.overdue)).toBe(true);
      expect(Array.isArray(detail.tools.history)).toBe(true);

      // The pillar set the request actually ran against, so this test says which
      // pillars it proved rather than merely which ones it asked for.
      expect(res.body.extensions.pillars).toEqual(expect.arrayContaining(["profiles", "work", "leave", "training", "tools"]));
    });

    it("reads each store a bounded number of times, not once per pillar field", async () => {
      // The point of one round trip is undone if the server makes N reads to serve
      // it. Five crew stores plus staff and assignments is the ceiling; a query
      // selecting a dozen fields across four pillars must not exceed it.
      const { staffId, today, week } = await member();

      const res = await graph({ query: FOUR_PILLARS, variables: { id: staffId, asOf: today, week }, token });
      expect(res.body.errors).toBeUndefined();
      expect(res.body.extensions.storeReads).toBeLessThanOrEqual(8);
    });

    it("renders a member with no history at all as empty rather than as an error", async () => {
      // No shifts, no leave booked, no certificates and no tools is the ordinary
      // state on the day somebody is hired. Every pillar has to render it — otherwise
      // the person-detail page cannot be built until somebody has done some work.
      const { staffId, today, week } = await member();

      const res = await graph({ query: FOUR_PILLARS, variables: { id: staffId, asOf: today, week }, token });
      expect(res.body.errors).toBeUndefined();

      const detail = res.body.data.crewMember;
      expect(detail.work.nextShift).toBeNull();
      expect(detail.leave.nextBooked).toBeNull();
      expect(detail.training.certifications).toEqual([]);
      expect(detail.tools.onIssue).toEqual([]);
      expect(detail.tools.overdue).toEqual([]);
      expect(detail.tools.history).toEqual([]);
    });

    it("answers the other three pillars when the leave pillar refuses — one bad field is not a bad response", async () => {
      // The other half of "one round trip", and §7.3's null-propagation contract.
      // With no policy configured the leave pillar deliberately raises
      // LEAVE_POLICY_MISSING rather than reporting zero days, and `balance` is
      // non-null, so the null propagates up to `leave`. What must NOT happen is the
      // whole response collapsing: a page that shows work, training and tools with a
      // "leave not configured" notice is useful, and a blank page is not.
      const { staffId, today, week } = await member({ withPolicy: false });

      const res = await graph({ query: FOUR_PILLARS, variables: { id: staffId, asOf: today, week }, token });
      expect(res.status).toBe(200);

      const detail = res.body.data.crewMember;
      expect(detail.leave).toBeNull();
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].extensions.code).toBe("LEAVE_POLICY_MISSING");
      expect(res.body.errors[0].path).toEqual(["crewMember", "leave", "balance"]);

      // And the three siblings answered anyway, in the same round trip.
      expect(detail.profile.role).toBe(VALID_HIRE_INPUT.role);
      expect(detail.work).not.toBeNull();
      expect(detail.training).not.toBeNull();
      expect(detail.tools).not.toBeNull();
      expect(detail.tools.onIssue).toEqual([]);
    });
  });
});
