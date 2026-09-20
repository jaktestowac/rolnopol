import { describe, it, expect } from "vitest";

// The per-pillar notification tables (pillars/*/notifications.js).
//
// These exist so the domain services do not carry event payloads in the middle
// of their own logic. Everything here is pure — a table returns a descriptor and
// publishes nothing — which is what lets "which outcomes notify?" be one
// assertion instead of a mutation driven through a store.
//
// The point of every test below is the SILENT case. A payload that changes shape
// is caught by the pillar suites, which drive real mutations; an outcome that
// quietly starts notifying is not caught anywhere else.
const toolsNotifications = require("../../services/crew/pillars/tools/notifications");
const trainingNotifications = require("../../services/crew/pillars/training/notifications");
const leaveNotifications = require("../../services/crew/pillars/leave/notifications");
const profilesNotifications = require("../../services/crew/pillars/profiles/notifications");
const { CREW_EVENTS } = require("../../services/crew/notifier");

const issuance = (overrides = {}) => ({
  id: 12,
  toolId: 5,
  staffId: 7,
  dueBack: "2026-09-01",
  issuedAt: "2026-08-27T09:00:00.000Z",
  returnedAt: null,
  conditionOnReturn: null,
  ...overrides,
});

describe("tools notification table", () => {
  it("describes an issue", () => {
    const event = toolsNotifications.eventFor({
      outcome: "ISSUED",
      issuance: issuance(),
      tool: { id: 5, name: "Chainsaw MS261", status: "on_issue" },
    });

    expect(event.type).toBe(CREW_EVENTS.TOOL_ISSUED);
    expect(event.correlationId).toBe("crew-tool-issuance-12");
    expect(event.payload).toMatchObject({ issuanceId: "12", toolId: 5, toolName: "Chainsaw MS261", staffId: 7 });
  });

  it("describes a return, carrying where the condition sent the tool", () => {
    const event = toolsNotifications.eventFor({
      outcome: "RETURNED",
      issuance: issuance({ returnedAt: "2026-08-30T09:00:00.000Z", conditionOnReturn: "needs_service" }),
      tool: { id: 5, name: "Chainsaw MS261", status: "in_service" },
      late: true,
    });

    expect(event.type).toBe(CREW_EVENTS.TOOL_RETURNED);
    expect(event.payload).toMatchObject({ condition: "needs_service", toolStatus: "in_service", late: true });
  });

  it("gives both halves of a trip ONE correlationId", () => {
    const out = toolsNotifications.eventFor({ outcome: "ISSUED", issuance: issuance(), tool: {} });
    const back = toolsNotifications.eventFor({ outcome: "RETURNED", issuance: issuance(), tool: {} });
    expect(back.correlationId).toBe(out.correlationId);
  });

  it("says nothing for every refusal outcome", () => {
    for (const outcome of [
      "UNAVAILABLE",
      "REQUIRES_CERTIFICATION",
      "CHECK_UNAVAILABLE",
      "NOT_ON_ISSUE",
      "NOT_FOUND",
      "VALIDATION_FAILED",
    ]) {
      expect(toolsNotifications.eventFor({ outcome }), outcome).toBeNull();
    }
    expect(toolsNotifications.eventFor(undefined)).toBeNull();
    expect(toolsNotifications.eventFor({})).toBeNull();
  });

  it("tolerates a tool it could not read back", () => {
    const event = toolsNotifications.eventFor({ outcome: "ISSUED", issuance: issuance(), tool: undefined });
    expect(event.payload.toolName).toBeNull();
  });
});

describe("training notification table", () => {
  const revoked = (overrides = {}) => ({
    outcome: "REVOKED",
    certification: { id: 3, staffId: 7, courseId: 2, revokedReason: "Overturned.", revokedOn: "2026-08-27" },
    gaps: [{ code: "chainsaw" }, { code: "first_aid" }],
    ...overrides,
  });

  it("describes a revocation with the resolved course name and the gap count", () => {
    const event = trainingNotifications.eventFor(revoked(), { courseName: "Chainsaw Operation" });

    expect(event.type).toBe(CREW_EVENTS.CERTIFICATION_REVOKED);
    expect(event.payload).toMatchObject({ certificationId: "3", staffId: 7, courseId: 2, courseName: "Chainsaw Operation", gapCount: 2 });
  });

  it("falls back to a null name rather than failing when the course could not be read", () => {
    expect(trainingNotifications.eventFor(revoked()).payload.courseName).toBeNull();
  });

  it("counts zero gaps rather than reporting undefined", () => {
    expect(trainingNotifications.eventFor(revoked({ gaps: undefined })).payload.gapCount).toBe(0);
  });

  it("says nothing when nothing was revoked", () => {
    for (const outcome of ["NOT_FOUND", "ALREADY_REVOKED", "VALIDATION_FAILED"]) {
      expect(trainingNotifications.eventFor({ outcome }), outcome).toBeNull();
    }
  });
});

describe("leave notification table", () => {
  const request = (overrides = {}) => ({
    id: 4,
    staffId: 7,
    type: "annual",
    from: "2026-10-05",
    to: "2026-10-09",
    workingDays: 5,
    reason: null,
    decidedAt: "2026-08-27T09:00:00.000Z",
    ...overrides,
  });

  it("describes an approval and a rejection", () => {
    expect(leaveNotifications.eventFor(request({ status: "approved" })).type).toBe(CREW_EVENTS.LEAVE_APPROVED);
    expect(leaveNotifications.eventFor(request({ status: "rejected", reason: "cover" })).type).toBe(CREW_EVENTS.LEAVE_REJECTED);
  });

  it("says NOTHING for the two states the requester reached themselves", () => {
    // A withdrawal or a cancellation is the caller calling off their own request.
    expect(leaveNotifications.eventFor(request({ status: "withdrawn" }))).toBeNull();
    expect(leaveNotifications.eventFor(request({ status: "cancelled" }))).toBeNull();
    expect(leaveNotifications.eventFor(request({ status: "requested" }))).toBeNull();
    expect(leaveNotifications.eventFor(undefined)).toBeNull();
  });

  it("puts the status in the correlationId, so a later decision is not a duplicate", () => {
    // Unlike the tools pillar, where a trip out and back share one id on purpose.
    const approved = leaveNotifications.eventFor(request({ status: "approved" }));
    const rejected = leaveNotifications.eventFor(request({ status: "rejected" }));
    expect(approved.correlationId).toBe("crew-leave-4-approved");
    expect(rejected.correlationId).not.toBe(approved.correlationId);
  });
});

describe("profiles notification table", () => {
  it("describes an employment end", () => {
    const event = profilesNotifications.employmentEnded({ staffId: 7, endDate: "2026-09-30", endReason: "end_of_season" });

    expect(event.type).toBe(CREW_EVENTS.EMPLOYMENT_ENDED);
    expect(event.correlationId).toBe("crew-employment-ended-7");
    expect(event.payload).toMatchObject({ staffId: 7, lastDay: "2026-09-30", reason: "end_of_season" });
  });

  it("has no entry for a profile edit", () => {
    // upsertProfile is data entry. The absence is the design, so it is asserted
    // rather than left to be noticed.
    expect(Object.keys(profilesNotifications)).toEqual(["employmentEnded"]);
  });
});
