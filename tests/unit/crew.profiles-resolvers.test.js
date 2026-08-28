import { describe, it, expect } from "vitest";

// The profiles and documents pillars' transport boundaries.
//
// Profiles is where `toUnionMember` takes a second argument — the staffId the
// caller asked about — because a MEMBER_NOT_FOUND raised deeper down may not carry
// one, and `MemberNotFound.staffId` is non-null in the SDL. The fallback is the
// difference between a tidy union member and a non-null violation.
//
// Documents is three pass-throughs with one documented rule: a CrewError refuses
// the WHOLE batch and travels as an error, so the mutation must not catch.
const { resolvers, toUnionMember } = require("../../services/crew/pillars/profiles/resolvers");
const { resolvers: documentResolvers } = require("../../services/crew/pillars/documents/resolvers");
const { CrewError, CREW_ERROR_CODES } = require("../../services/crew/errors");
const { unionMembers } = require("../helpers/crew-sdl");

const profilesUnion = (name) => unionMembers("profiles", name);
const crewError = (code, extensions = {}, message = "nope") => new CrewError(code, message, extensions);
const contextWith = (profiles) => ({ services: { profiles } });

describe("profiles resolvers — toUnionMember", () => {
  it("maps MEMBER_NOT_FOUND, preferring the staffId the error carries", () => {
    const error = crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND, { staffId: 7 });

    expect(toUnionMember(error, 99)).toEqual({ __typename: "MemberNotFound", staffId: "7" });
  });

  it("falls back to the requested staffId when the error carries none", () => {
    // MemberNotFound.staffId is non-null in the SDL; without this fallback a
    // deeper error with no extensions would become a non-null violation.
    const error = crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND);

    expect(toUnionMember(error, 42)).toEqual({ __typename: "MemberNotFound", staffId: "42" });
  });

  it("treats a null staffId in the extensions as absent, not as the string 'null'", () => {
    const error = crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND, { staffId: null });

    expect(toUnionMember(error, 42).staffId).toBe("42");
  });

  it("maps VERSION_CONFLICT with the same staffId fallback", () => {
    const carried = crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 3, expectedVersion: 1, actualVersion: 2 });
    expect(toUnionMember(carried, 99)).toEqual({
      __typename: "VersionConflict",
      staffId: "3",
      expectedVersion: 1,
      actualVersion: 2,
    });

    const bare = crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { expectedVersion: 1, actualVersion: 2 });
    expect(toUnionMember(bare, 8).staffId).toBe("8");
  });

  it("maps VALIDATION_FAILED onto ProfileValidationFailed", () => {
    const fieldErrors = [{ field: "role", message: "unknown" }];

    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED, { fieldErrors }), 1)).toEqual({
      __typename: "ProfileValidationFailed",
      fieldErrors,
    });
    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED), 1).fieldErrors).toEqual([]);
  });

  it("rethrows every code it does not map", () => {
    const mapped = [CREW_ERROR_CODES.MEMBER_NOT_FOUND, CREW_ERROR_CODES.VERSION_CONFLICT, CREW_ERROR_CODES.VALIDATION_FAILED];

    for (const code of Object.values(CREW_ERROR_CODES).filter((value) => !mapped.includes(value))) {
      expect(() => toUnionMember(crewError(code), 1)).toThrow(CrewError);
    }
  });

  it("rethrows anything that is not a CrewError", () => {
    const boom = new Error("store unavailable");
    expect(() => toUnionMember(boom, 1)).toThrow(boom);
  });

  it("emits only members the two profile unions declare", () => {
    const produced = new Set([
      toUnionMember(crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND), 1).__typename,
      toUnionMember(crewError(CREW_ERROR_CODES.VERSION_CONFLICT), 1).__typename,
      toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED), 1).__typename,
    ]);

    for (const union of ["UpsertCrewProfileResult", "RecordEmploymentEndResult"]) {
      const declared = new Set(profilesUnion(union));
      for (const typename of produced) {
        expect(declared.has(typename)).toBe(true);
      }
    }
  });
});

describe("profiles resolvers — hireCrewMember", () => {
  const hireWith = (result) => contextWith({ hire: async () => result });

  it("maps VALIDATION_FAILED onto HireValidationFailed", async () => {
    const fieldErrors = [{ field: "name", message: "required" }];
    const result = await resolvers.Mutation.hireCrewMember(null, { input: {} }, hireWith({ outcome: "VALIDATION_FAILED", fieldErrors }));

    expect(result).toEqual({ __typename: "HireValidationFailed", fieldErrors });
  });

  it("maps HIRED_WITHOUT_PROFILE, keeping the reason and code that explain the half-success", async () => {
    const result = await resolvers.Mutation.hireCrewMember(
      null,
      { input: {} },
      hireWith({ outcome: "HIRED_WITHOUT_PROFILE", staff: { id: 5 }, reason: "profile store locked", code: "PROFILE_WRITE_FAILED" }),
    );

    expect(result).toEqual({
      __typename: "CrewMemberHiredWithoutProfile",
      staffId: "5",
      reason: "profile store locked",
      code: "PROFILE_WRITE_FAILED",
    });
  });

  it("maps a success onto CrewMemberHired, with a NUMERIC staffId on the member", async () => {
    // `CrewMemberHiredWithoutProfile.staffId` is an ID (string) while
    // `CrewMember.staffId` is numeric — the two live side by side in one union and
    // the difference is easy to get backwards.
    const staff = { id: "6", name: "Ola" };
    const profile = { id: 2, role: "agronomist" };

    const result = await resolvers.Mutation.hireCrewMember(null, { input: {} }, hireWith({ outcome: "HIRED", staff, profile }));

    expect(result).toEqual({
      __typename: "CrewMemberHired",
      crewMember: { staffId: 6, staff, profile },
    });
    expect(typeof result.crewMember.staffId).toBe("number");
  });

  it("does not catch — a thrown CrewError stays an error rather than becoming a member", async () => {
    const context = contextWith({
      hire: async () => {
        throw crewError(CREW_ERROR_CODES.HIRE_VALIDATION_FAILED);
      },
    });

    await expect(resolvers.Mutation.hireCrewMember(null, { input: {} }, context)).rejects.toThrow(CrewError);
  });

  it("reaches every member HireResult declares", async () => {
    const outcomes = [
      { outcome: "VALIDATION_FAILED", fieldErrors: [] },
      { outcome: "HIRED_WITHOUT_PROFILE", staff: { id: 1 } },
      { outcome: "HIRED", staff: { id: 1 }, profile: {} },
    ];

    const produced = [];
    for (const outcome of outcomes) {
      produced.push((await resolvers.Mutation.hireCrewMember(null, { input: {} }, hireWith(outcome))).__typename);
    }

    expect(new Set(produced)).toEqual(new Set(profilesUnion("HireResult")));
  });
});

describe("profiles resolvers — upsertCrewProfile", () => {
  it("re-reads the member, so what the caller sees is what a later query would see", async () => {
    const written = { id: 1, role: "agronomist" };
    const reRead = { staffId: 3, staff: { name: "Ola" }, profile: { id: 1, role: "agronomist", version: 2 } };
    const context = contextWith({
      upsertProfile: async () => written,
      findMember: async () => reRead,
    });

    const result = await resolvers.Mutation.upsertCrewProfile(null, { input: { staffId: 3 } }, context);
    expect(result).toEqual({ __typename: "CrewProfileUpserted", crewMember: reRead });
    // Not the write result: the re-read is the answer.
    expect(result.crewMember.profile).not.toBe(written);
  });

  it("falls back to a synthesised member when the re-read finds nothing", async () => {
    const written = { id: 1, role: "agronomist" };
    const context = contextWith({
      upsertProfile: async () => written,
      findMember: async () => null,
    });

    const result = await resolvers.Mutation.upsertCrewProfile(null, { input: { staffId: "4" } }, context);
    expect(result.crewMember).toEqual({ staffId: 4, staff: null, profile: written });
    expect(typeof result.crewMember.staffId).toBe("number");
  });

  it("maps a thrown CrewError onto a union member, passing the input staffId as the fallback", async () => {
    const context = contextWith({
      upsertProfile: async () => {
        throw crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND);
      },
    });

    const result = await resolvers.Mutation.upsertCrewProfile(null, { input: { staffId: 12 } }, context);
    expect(result).toEqual({ __typename: "MemberNotFound", staffId: "12" });
  });

  it("lets an unmapped error through rather than inventing a member", async () => {
    const context = contextWith({
      upsertProfile: async () => {
        throw new Error("disk full");
      },
    });

    await expect(resolvers.Mutation.upsertCrewProfile(null, { input: { staffId: 1 } }, context)).rejects.toThrow("disk full");
  });
});

describe("profiles resolvers — recordEmploymentEnd", () => {
  it("returns the re-read member alongside the last day", async () => {
    const member = { staffId: 3, profile: { endDate: "2026-09-30" } };
    const context = contextWith({
      recordEmploymentEnd: async () => undefined,
      findMember: async () => member,
    });

    const result = await resolvers.Mutation.recordEmploymentEnd(null, { staffId: 3, lastDay: "2026-09-30" }, context);
    expect(result).toEqual({ __typename: "EmploymentEnded", crewMember: member, lastDay: "2026-09-30" });
  });

  it("forwards all four arguments to the service", async () => {
    let seen = null;
    const context = contextWith({
      recordEmploymentEnd: async (args) => {
        seen = args;
      },
      findMember: async () => ({ staffId: 3 }),
    });

    await resolvers.Mutation.recordEmploymentEnd(
      null,
      { staffId: "3", lastDay: "2026-09-30", reason: "moved away", expectedVersion: 4 },
      context,
    );
    expect(seen).toEqual({ staffId: "3", lastDay: "2026-09-30", reason: "moved away", expectedVersion: 4 });
  });

  it("maps a version conflict onto its union member", async () => {
    const context = contextWith({
      recordEmploymentEnd: async () => {
        throw crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { expectedVersion: 1, actualVersion: 3 });
      },
    });

    const result = await resolvers.Mutation.recordEmploymentEnd(null, { staffId: 5, lastDay: "2026-09-30" }, context);
    expect(result).toEqual({ __typename: "VersionConflict", staffId: "5", expectedVersion: 1, actualVersion: 3 });
  });
});

describe("profiles resolvers — crew query paging", () => {
  const listOf = (members) => contextWith({ listCrew: async () => members });
  const members = [{ staffId: 1 }, { staffId: 2 }, { staffId: 3 }];

  it("reports the filtered total, not the page size — a UI needs both", async () => {
    const page = await resolvers.Query.crew(null, { first: 2 }, listOf(members));

    expect(page).toEqual({ nodes: [{ staffId: 1 }, { staffId: 2 }], totalCount: 3, hasMore: true });
  });

  it("returns everything and reports no more pages when first is omitted", async () => {
    const page = await resolvers.Query.crew(null, {}, listOf(members));

    expect(page).toEqual({ nodes: members, totalCount: 3, hasMore: false });
  });

  it("ignores a non-positive or non-integer first rather than returning an empty page", async () => {
    for (const first of [0, -3, 1.5, null, undefined, "2"]) {
      const page = await resolvers.Query.crew(null, { first }, listOf(members));
      expect(page.nodes).toHaveLength(3);
      expect(page.hasMore).toBe(false);
    }
  });

  it("reports no more pages when the page exactly covers the set", async () => {
    const page = await resolvers.Query.crew(null, { first: 3 }, listOf(members));

    expect(page).toEqual({ nodes: members, totalCount: 3, hasMore: false });
  });

  it("passes the filter straight through to the service", async () => {
    let seen = null;
    const context = contextWith({
      listCrew: async (args) => {
        seen = args;
        return [];
      },
    });

    await resolvers.Query.crew(null, { filter: { role: "AGRONOMIST" } }, context);
    expect(seen).toEqual({ filter: { role: "AGRONOMIST" } });
  });

  it("copes with an empty crew", async () => {
    const page = await resolvers.Query.crew(null, { first: 5 }, listOf([]));

    expect(page).toEqual({ nodes: [], totalCount: 0, hasMore: false });
  });
});

describe("profiles resolvers — field resolvers", () => {
  it("nulls an absent profile rather than leaving it undefined", () => {
    expect(resolvers.CrewMember.profile({ staffId: 1 })).toBeNull();
    expect(resolvers.CrewMember.profile({ staffId: 1, profile: { id: 2 } })).toEqual({ id: 2 });
  });

  it("stringifies the profile id", () => {
    expect(resolvers.CrewProfile.id({ id: 9 })).toBe("9");
  });

  it("computes the two clock-following fields through the service, never from the row", () => {
    const context = contextWith({
      employmentStatus: (profile) => `status-of-${profile.id}`,
      tenureDays: (profile) => profile.id * 10,
    });

    expect(resolvers.CrewProfile.employmentStatus({ id: 4 }, {}, context)).toBe("status-of-4");
    expect(resolvers.CrewProfile.tenureDays({ id: 4 }, {}, context)).toBe(40);
  });

  it("resolves every union by the stamped __typename", () => {
    for (const union of ["HireResult", "UpsertCrewProfileResult", "RecordEmploymentEndResult"]) {
      expect(resolvers[union].__resolveType({ __typename: "Stamped" })).toBe("Stamped");
    }
  });
});

describe("documents resolvers", () => {
  it("delegates the single document lookup to the service, id and all", async () => {
    let seen = null;
    const context = {
      services: {
        documents: {
          findDocument: async (id) => {
            seen = id;
            return { id };
          },
        },
      },
    };

    await expect(documentResolvers.Query.crewDocument(null, { id: "doc-1" }, context)).resolves.toEqual({ id: "doc-1" });
    expect(seen).toBe("doc-1");
  });

  it("scopes a member's folder by that member's own staffId", async () => {
    let seen = null;
    const context = {
      services: {
        documents: {
          folderFor: async (staffId) => {
            seen = staffId;
            return { documents: [] };
          },
        },
      },
    };

    await documentResolvers.CrewMember.documents({ staffId: 8, profile: { note: "unused" } }, {}, context);
    expect(seen).toBe(8);
  });

  it("does not touch input.files — the Upload scalar has already refused non-multipart parts", async () => {
    let seen = null;
    const files = [{ filename: "contract.pdf" }];
    const context = {
      services: {
        documents: {
          uploadDocuments: async (input) => {
            seen = input;
            return { accepted: [], rejected: [] };
          },
        },
      },
    };

    await documentResolvers.Mutation.uploadCrewDocuments(null, { input: { staffId: 3, files } }, context);
    expect(seen).toEqual({ staffId: 3, files });
    expect(seen.files).toBe(files);
  });

  it("does not catch — a CrewError refuses the whole batch and travels as an error", async () => {
    const context = {
      services: {
        documents: {
          uploadDocuments: async () => {
            throw crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND, { staffId: 4 });
          },
        },
      },
    };

    // Flattening this into `rejected` would say "one file failed" about a request
    // in which nothing was ever going to be stored.
    await expect(documentResolvers.Mutation.uploadCrewDocuments(null, { input: {} }, context)).rejects.toThrow(CrewError);
  });
});
