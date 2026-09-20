import { describe, it, expect } from "vitest";

// How the training panel presents the AgriAcademy link.
//
// The behaviour worth pinning is WHEN THE PANEL STAYS QUIET, because that is the
// half a "show an error when it breaks" change usually gets wrong. Two silences
// are deliberate:
//
//   - nothing in this farm references an academy exam ⇒ say nothing. Telling
//     somebody a service they have never used is not linked is noise, and noise is
//     how a panel's warnings stop being read;
//   - the link is working ⇒ say nothing. A green banner for "a thing you may not
//     care about is fine" is the same noise from the other direction.
//
// And when it does speak, the message must carry the reassurance: an unavailable
// external link on a TRAINING page reads as "this person's certificates may be
// wrong" unless it explicitly says otherwise. The wording lives on the server so
// every surface says the same thing; this file checks it is passed through and
// given the right tone.
const CrewApi = require("../../public/js/pages/crew-api.js");

const link = (overrides) => ({
  state: "READY",
  available: true,
  message: "AgriAcademy is linked and answering.",
  linkedCourses: 1,
  ...overrides,
});

describe("academyNotice — when to stay quiet", () => {
  it("says nothing when no course references an academy exam", () => {
    expect(CrewApi.academyNotice(link({ state: "NOT_LINKED", available: false, linkedCourses: 0 }))).toBeNull();
  });

  it("says nothing when the link is working", () => {
    expect(CrewApi.academyNotice(link({ state: "READY", available: true }))).toBeNull();
  });

  it("says nothing when the flag is off AND nothing is linked", () => {
    // Both halves matter: an operator with the flag off and no linked courses has
    // made a choice and has nothing to fix.
    expect(CrewApi.academyNotice(link({ state: "DISABLED", available: false, linkedCourses: 0 }))).toBeNull();
  });

  it("says nothing when there is no link field at all", () => {
    // A build without the training pillar, or an older server. The panel must
    // render either way rather than throwing on a missing field.
    expect(CrewApi.academyNotice(null)).toBeNull();
    expect(CrewApi.academyNotice(undefined)).toBeNull();
    expect(CrewApi.academyNotice({})).toBeNull();
  });
});

describe("academyNotice — when to speak, and how loudly", () => {
  it("warns when the academy is OFFLINE, carrying the server's own sentence", () => {
    const notice = CrewApi.academyNotice(
      link({ state: "OFFLINE", available: false, message: "AgriAcademy is not responding, so exam links are unavailable." }),
    );
    expect(notice).toMatchObject({ state: "OFFLINE", tone: "warning" });
    expect(notice.message).toBe("AgriAcademy is not responding, so exam links are unavailable.");
  });

  it("warns when the academy answered UNREADABLY", () => {
    // Distinct from offline because restarting the service will not fix it — this
    // one is worth somebody looking at.
    expect(CrewApi.academyNotice(link({ state: "UNREADABLE", available: false }))).toMatchObject({ tone: "warning" });
  });

  it("INFORMS rather than warns when the flag is simply off, with courses linked", () => {
    // Somebody switched it off on purpose. A warning triangle for a deliberate
    // configuration trains people to ignore warning triangles.
    expect(CrewApi.academyNotice(link({ state: "DISABLED", available: false, linkedCourses: 2 }))).toMatchObject({
      state: "DISABLED",
      tone: "info",
    });
  });

  it("falls back to its own sentence if the server sent none", () => {
    const notice = CrewApi.academyNotice({ state: "OFFLINE", available: false, message: "", linkedCourses: 1 });
    // The fallback still says the important half.
    expect(notice.message).toMatch(/training records are unaffected/i);
  });

  it("never reports available:true as something to warn about", () => {
    for (const state of ["READY"]) {
      expect(CrewApi.academyNotice(link({ state, available: true }))).toBeNull();
    }
  });
});

describe("the reassurance every unavailable message has to carry", () => {
  // Asserted against the SERVER's wording, because that is where it lives — the
  // panel shows it verbatim. If someone rewrites these strings and drops the
  // reassurance, this fails rather than the page quietly becoming alarming.
  const { createAcademyGateway } = require("../../services/crew/academy-gateway");

  it.each([
    ["DISABLED", { isEnabled: async () => false }],
    ["OFFLINE", { isEnabled: async () => true, client: { listCertificates: async () => ({ status: 503, body: {} }) } }],
    ["UNREADABLE", { isEnabled: async () => true, client: { listCertificates: async () => ({ status: 200, body: { nope: true } }) } }],
  ])("%s says the farm's own training records are unaffected", async (expectedState, options) => {
    const status = await createAcademyGateway(options).status({ userId: 1 });
    expect(status.state).toBe(expectedState);
    expect(status.available).toBe(false);
    expect(status.message).toMatch(/training records are unaffected/i);
  });

  it("READY says it is linked, and is the only available state", async () => {
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: { listCertificates: async () => ({ status: 200, body: [] }) },
    });
    const status = await gateway.status({ userId: 1 });
    expect(status).toMatchObject({ state: "READY", available: true });
  });

  it("NOT_LINKED explains what to do, and never dials the academy", async () => {
    let called = false;
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: {
        listCertificates: async () => {
          called = true;
          return { status: 200, body: [] };
        },
      },
    });

    const status = await gateway.status({ userId: 1, probe: false });
    expect(status).toMatchObject({ state: "NOT_LINKED", available: false });
    expect(status.message).toMatch(/exam id/i);
    // A farm that never uses the link does not pay for a request to discover that.
    expect(called).toBe(false);
  });

  it("shares ONE fetch between the banner and the per-course links", async () => {
    let calls = 0;
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: {
        listCertificates: async () => {
          calls += 1;
          return { status: 200, body: [{ examId: "exam-7", certificateNo: "AC-1" }] };
        },
      },
    });

    await Promise.all([gateway.status({ userId: 1 }), gateway.certificateForExam(1, "exam-7"), gateway.certificateForExam(1, "exam-8")]);
    expect(calls).toBe(1);
  });

  it("never throws, whatever the academy does", async () => {
    const exploding = createAcademyGateway({
      isEnabled: async () => true,
      client: {
        listCertificates: async () => {
          throw new Error("socket hang up");
        },
      },
    });
    await expect(exploding.status({ userId: 1 })).resolves.toMatchObject({ state: "OFFLINE", available: false });

    // A flag lookup that throws must not take the page down with it either. This
    // used to reject: the catch lived inside the DEFAULT lookup only, so the
    // guarantee depended on whoever injected an override remembering to catch.
    const brokenFlag = createAcademyGateway({
      isEnabled: async () => {
        throw new Error("flag store on fire");
      },
    });
    await expect(brokenFlag.status({ userId: 1 })).resolves.toMatchObject({ state: "DISABLED", available: false });
  });

  it("still resolves a certificate lookup when the flag lookup throws", async () => {
    const brokenFlag = createAcademyGateway({
      isEnabled: async () => {
        throw new Error("flag store on fire");
      },
      client: { listCertificates: async () => ({ status: 200, body: [{ examId: "exam-7" }] }) },
    });
    await expect(brokenFlag.certificateForExam(1, "exam-7")).resolves.toBeNull();
  });
});

describe("the training labels the panel renders", () => {
  it("names all four certificate states, and the absence of one", () => {
    expect(CrewApi.labelForCertificationStatus("VALID")).toBe("Valid");
    expect(CrewApi.labelForCertificationStatus("EXPIRING_SOON")).toBe("Expiring soon");
    expect(CrewApi.labelForCertificationStatus("EXPIRED")).toBe("Expired");
    expect(CrewApi.labelForCertificationStatus("REVOKED")).toBe("Revoked");
    // Null is a real value: never certified is not one of the four states.
    expect(CrewApi.labelForCertificationStatus(null)).toBe("Not certified");
    expect(CrewApi.labelForCertificationStatus(undefined)).toBe("Not certified");
  });

  it("names every enrollment state", () => {
    for (const status of ["PLANNED", "IN_PROGRESS", "PASSED", "FAILED", "CANCELLED"]) {
      expect(CrewApi.labelForEnrollmentStatus(status)).not.toBe(status);
    }
  });

  it("names every compliance-gap reason", () => {
    expect(CrewApi.labelForGapReason("MISSING")).toBe("never certified");
    expect(CrewApi.labelForGapReason("EXPIRED")).toBe("certificate expired");
    expect(CrewApi.labelForGapReason("REVOKED")).toBe("certificate revoked");
  });

  it("falls back to the raw value rather than rendering blank", () => {
    // A status the server adds before this file knows about it must still print
    // something a human can read out over the phone.
    expect(CrewApi.labelForCertificationStatus("SUSPENDED")).toBe("SUSPENDED");
    expect(CrewApi.labelForEnrollmentStatus("DEFERRED")).toBe("DEFERRED");
  });
});

describe("the label maps match the graph's enums", () => {
  // The same drift guard the roster's filter options have: a state added to the
  // schema and not to the label map would render as a raw SCREAMING_CASE token.
  const { assembleCrewSchema } = require("../../services/crew/registry");

  it("covers every CertificationStatus", () => {
    const enumValues = assembleCrewSchema()
      .schema.getType("CertificationStatus")
      .getValues()
      .map((value) => value.name);
    expect(Object.keys(CrewApi.CERTIFICATION_STATUS_LABELS).sort()).toEqual(enumValues.sort());
  });

  it("covers every EnrollmentStatus", () => {
    const enumValues = assembleCrewSchema()
      .schema.getType("EnrollmentStatus")
      .getValues()
      .map((value) => value.name);
    expect(Object.keys(CrewApi.ENROLLMENT_STATUS_LABELS).sort()).toEqual(enumValues.sort());
  });

  it("covers every ComplianceGapReason", () => {
    const enumValues = assembleCrewSchema()
      .schema.getType("ComplianceGapReason")
      .getValues()
      .map((value) => value.name);
    expect(Object.keys(CrewApi.GAP_REASON_LABELS).sort()).toEqual(enumValues.sort());
  });
});
