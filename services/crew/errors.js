/**
 * Typed crew errors (PRD §15).
 *
 * Every error this module raises on purpose carries a code from the catalogue
 * below, which is what makes it survive `services/graphql/errors.js` unmasked.
 * The corollary is the useful part: anything WITHOUT a code here is by definition
 * unanticipated, and gets masked. Adding a code is therefore a deliberate act of
 * saying "clients may branch on this".
 *
 * `MEMBER_NOT_FOUND` deserves its own note. It is returned for a staff id that
 * does not exist AND for one that exists but belongs to another user. Those are
 * the same answer on purpose: distinguishing them would let a caller enumerate
 * other people's staff ids (§9).
 */

const CREW_ERROR_CODES = {
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  HIRE_VALIDATION_FAILED: "HIRE_VALIDATION_FAILED",
  PROFILE_WRITE_FAILED: "PROFILE_WRITE_FAILED",
  LEAVE_POLICY_MISSING: "LEAVE_POLICY_MISSING",
  CHECK_UNAVAILABLE: "CHECK_UNAVAILABLE",
  ORPHANED_OVERLAY: "ORPHANED_OVERLAY",
  UNAUTHENTICATED: "UNAUTHENTICATED",
};

class CrewError extends Error {
  /**
   * @param {string} code - one of CREW_ERROR_CODES
   * @param {string} message
   * @param {object} [extensions] - merged into `errors[].extensions`
   */
  constructor(code, message, extensions = {}) {
    super(message);
    this.name = "CrewError";
    this.code = code;
    // `extensions.code` is what the graph layer reads; `this.code` is what
    // domain code reads. They are set from one argument so they cannot diverge.
    this.extensions = { ...extensions, code };
  }
}

const memberNotFound = (staffId) =>
  new CrewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND, `No crew member with staffId ${staffId}.`, { staffId: String(staffId) });

const validationFailed = (fieldErrors, message = "One or more fields are invalid.") =>
  new CrewError(CREW_ERROR_CODES.VALIDATION_FAILED, message, { fieldErrors });

const versionConflict = (staffId, expectedVersion, actualVersion) =>
  new CrewError(CREW_ERROR_CODES.VERSION_CONFLICT, `Profile for staffId ${staffId} has changed since it was read.`, {
    staffId: String(staffId),
    expectedVersion,
    actualVersion,
  });

module.exports = { CREW_ERROR_CODES, CrewError, memberNotFound, validationFailed, versionConflict };
