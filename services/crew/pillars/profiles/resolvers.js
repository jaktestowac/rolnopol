/**
 * Profiles resolvers (PRD §8.1).
 *
 * These are deliberately thin. Every resolver here does three things and no more:
 * take arguments, call the per-request service, and shape the result into a union
 * member. No scoping, no validation, no store access — those live in the service
 * so a different transport cannot skip them (§9).
 *
 * Result unions rather than thrown errors, for every outcome a caller can act on.
 * `InsufficientBalance` or `VersionConflict` are not exceptional — they are answers
 * — and a union makes them part of the type system, so a client that handles
 * `__typename` exhaustively cannot forget one.
 */
const { CrewError, CREW_ERROR_CODES } = require("../../errors");

/** Map a thrown CrewError onto its union member, or rethrow if it is not ours. */
function toUnionMember(error, staffId) {
  if (!(error instanceof CrewError)) throw error;

  if (error.code === CREW_ERROR_CODES.MEMBER_NOT_FOUND) {
    return { __typename: "MemberNotFound", staffId: String(error.extensions.staffId ?? staffId) };
  }
  if (error.code === CREW_ERROR_CODES.VERSION_CONFLICT) {
    return {
      __typename: "VersionConflict",
      staffId: String(error.extensions.staffId ?? staffId),
      expectedVersion: error.extensions.expectedVersion,
      actualVersion: error.extensions.actualVersion,
    };
  }
  if (error.code === CREW_ERROR_CODES.VALIDATION_FAILED) {
    return { __typename: "ProfileValidationFailed", fieldErrors: error.extensions.fieldErrors || [] };
  }
  throw error;
}

const resolvers = {
  Query: {
    crew: async (_source, { filter, first }, context) => {
      const service = context.services.profiles;
      const members = await service.listCrew({ filter });
      const limit = Number.isInteger(first) && first > 0 ? first : null;
      const nodes = limit === null ? members : members.slice(0, limit);
      return {
        nodes,
        // totalCount is the size of the filtered set, not of the page — a UI
        // showing "12 of 40" needs both, and computing it here is free.
        totalCount: members.length,
        hasMore: limit !== null && members.length > limit,
      };
    },

    crewMember: async (_source, { staffId }, context) => {
      return context.services.profiles.findMember(staffId);
    },
  },

  Mutation: {
    hireCrewMember: async (_source, { input }, context) => {
      const result = await context.services.profiles.hire(input);

      if (result.outcome === "VALIDATION_FAILED") {
        return { __typename: "HireValidationFailed", fieldErrors: result.fieldErrors };
      }
      if (result.outcome === "HIRED_WITHOUT_PROFILE") {
        return {
          __typename: "CrewMemberHiredWithoutProfile",
          staffId: String(result.staff.id),
          reason: result.reason,
          code: result.code,
        };
      }
      return {
        __typename: "CrewMemberHired",
        crewMember: { staffId: Number(result.staff.id), staff: result.staff, profile: result.profile },
      };
    },

    upsertCrewProfile: async (_source, { input }, context) => {
      try {
        const profile = await context.services.profiles.upsertProfile(input);
        const member = await context.services.profiles.findMember(input.staffId);
        return {
          __typename: "CrewProfileUpserted",
          // Re-read rather than trusting the write result, so what the caller
          // sees is what a later query would see.
          crewMember: member || { staffId: Number(input.staffId), staff: null, profile },
        };
      } catch (error) {
        return toUnionMember(error, input.staffId);
      }
    },

    recordEmploymentEnd: async (_source, { staffId, lastDay, reason, expectedVersion }, context) => {
      try {
        await context.services.profiles.recordEmploymentEnd({ staffId, lastDay, reason, expectedVersion });
        const member = await context.services.profiles.findMember(staffId);
        return { __typename: "EmploymentEnded", crewMember: member, lastDay };
      } catch (error) {
        return toUnionMember(error, staffId);
      }
    },
  },

  CrewMember: {
    profile: (member) => member.profile || null,
  },

  CrewProfile: {
    id: (profile) => String(profile.id),
    // Computed, never stored — the two fields that must follow the clock.
    employmentStatus: (profile, _args, context) => context.services.profiles.employmentStatus(profile),
    tenureDays: (profile, _args, context) => context.services.profiles.tenureDays(profile),
  },

  // Unions resolve by the `__typename` the resolvers above stamped. Explicit and
  // dull beats inferring a type from the shape of an object.
  HireResult: { __resolveType: (value) => value.__typename },
  UpsertCrewProfileResult: { __resolveType: (value) => value.__typename },
  RecordEmploymentEndResult: { __resolveType: (value) => value.__typename },
};

module.exports = { resolvers, toUnionMember };
