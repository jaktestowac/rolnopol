/**
 * Crew Office — the one GraphQL client the pages share (PRD §10.3, §9.1.4).
 *
 * Three rules, and they are the reason this file exists rather than each page
 * calling `fetch` for itself:
 *
 *   1. **Named operations as constants.** Pages never build a query ad hoc, so the
 *      module's whole operation set is enumerable — and `crew-pages.test.js`
 *      validates every one of them against the real assembled schema. A typo'd
 *      field fails a test rather than a browser.
 *   2. **Variables are always variables.** Nothing is interpolated into query text.
 *   3. **One error renderer.** It understands `errors[].extensions.code` and
 *      result-union `__typename`s, so every page reports failures the same way.
 *
 * The session guard here is UX, never security (§9.1.4): `isLoggedIn()` only reads
 * a cookie and is trivially forgeable. The real barriers are the page gate in
 * `api/index.js` and `authenticateSessionUser` on the router — this just turns a
 * dead-looking page into a login prompt.
 *
 * Wrapped UMD-style, like `harvest-archive.js`, so the operation strings can be
 * required by a Node test as well as loaded by the browser.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.CrewApi = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const ENDPOINT = "/api/graphql/crew";

  // --- the operation set ----------------------------------------------------
  // Every query and mutation the pages can issue. Nothing else is allowed.

  const OPERATIONS = {
    CREW_INFO: `
      query CrewInfo {
        crewInfo { pillars crewSize serverTime }
      }
    `,

    ROSTER: `
      query Roster($filter: CrewFilter, $first: Int) {
        # Which pillars this build has, so the tab strip can drop the ones that are
        # absent (§10.1) without a second round trip for one array.
        crewInfo { pillars }
        crew(filter: $filter, first: $first) {
          totalCount
          hasMore
          nodes {
            staffId
            name
            surname
            age
            orphaned
            assignedFieldIds
            profile {
              role
              employmentType
              fte
              contractedHoursPerWeek
              startDate
              endDate
              employmentStatus
              tenureDays
              version
            }
          }
        }
      }
    `,

    MEMBER: `
      query Member($staffId: ID!) {
        # Which pillars this build has, so the detail page can drop the tabs whose
        # pillar is absent (§10.1) without a second round trip for one array.
        crewInfo { pillars }
        crewMember(staffId: $staffId) {
          staffId
          name
          surname
          age
          orphaned
          assignedFieldIds
          profile {
            id
            role
            employmentType
            fte
            contractedHoursPerWeek
            startDate
            endDate
            endReason
            notes
            employmentStatus
            tenureDays
            createdAt
            updatedAt
            version
            emergencyContact { name phone }
          }
        }
      }
    `,

    ORPHANED_OVERLAYS: `
      query OrphanedOverlays {
        orphanedOverlays { pillar staffId rowId detail }
      }
    `,

    MEMBER_WORK: `
      query MemberWork($staffId: ID!, $weekStarting: Date!) {
        crewMember(staffId: $staffId) {
          staffId
          work {
            nextShift { id date status hours dutyType { code name startTime endTime } }
            shifts { id date status hours cancelReason dutyType { code name startTime endTime colour } }
            workLog { id date hours activity effective amendsId amendedByReason }
            weeklyRollup(weekStarting: $weekStarting) { from to hours entries byActivity { activity hours } }
          }
        }
      }
    `,

    DUTY_TYPES: `
      query DutyTypes {
        dutyTypes { id code name startTime endTime hours crossesMidnight requiredRole colour }
      }
    `,

    /**
     * Everything the holidays page needs, in ONE round trip (§10.1, §1).
     *
     * The calendar, the approval queue and the per-person balances are three views of
     * the same data, and asking for them separately would be three chances to render
     * a page whose halves disagree. `crew` carries a `balance` per member, which is
     * the breakdown column — one query, one consistent snapshot.
     */
    LEAVE_BOARD: `
      query LeaveBoard($from: Date!, $to: Date!, $asOf: Date!) {
        crewInfo { pillars }
        leavePolicy {
          annualEntitlementDaysFullTime
          accrualMode
          carryOverCapDays
          carryOverExpiresOn
          leaveYearStart
          minNoticeDays
          publicHolidays
          blackoutWindows { from to reason }
          version
        }
        leaveCalendar(from: $from, to: $to) {
          date
          weekend
          publicHoliday
          blackoutReason
          absences { staffId name surname type status requestId halfDay }
        }
        pendingLeaveApprovals {
          id
          staffId
          type
          from
          to
          halfDayStart
          halfDayEnd
          workingDays
          reason
          createdAt
          version
        }
        crew {
          totalCount
          nodes {
            staffId
            name
            surname
            orphaned
            profile { role fte employmentStatus }
            leave {
              balance(asOf: $asOf) {
                leaveYear
                entitlement
                accrued
                carriedOver
                taken
                booked
                expiringSoon
                carryOverExpiresOn
                remaining
              }
              nextBooked { id from to type status }
            }
          }
        }
      }
    `,

    /**
     * The owner's leave policy (§6.3).
     *
     * One policy per ACCOUNT, not per crew member: entitlement, accrual, carry-over,
     * the leave year, notice and the farm's holidays are properties of the farm. What
     * varies per person is their FTE and start date, which live on their profile and
     * are what the accrual is pro-rated by.
     *
     * `expectedVersion` travels with it so two people editing the policy at once get
     * a conflict rather than one silently overwriting the other.
     */
    SET_LEAVE_POLICY: `
      mutation SetLeavePolicy($input: LeavePolicyInput!) {
        setLeavePolicy(input: $input) {
          __typename
          ... on LeavePolicySet {
            policy {
              annualEntitlementDaysFullTime
              accrualMode
              carryOverCapDays
              carryOverExpiresOn
              leaveYearStart
              minNoticeDays
              publicHolidays
              blackoutWindows { from to reason }
              version
            }
          }
          ... on LeaveValidationFailed { fieldErrors { field message } }
          ... on VersionConflict { expectedVersion actualVersion }
        }
      }
    `,

    REQUEST_LEAVE: `
      mutation RequestLeave($input: RequestLeaveInput!) {
        requestLeave(input: $input) {
          __typename
          ... on LeaveBooked { request { id from to workingDays status } balance { remaining } }
          ... on LeaveBookedWithWarning { request { id from to workingDays status } balance { remaining } warnings { code message } }
          ... on InsufficientBalance { requested remaining shortfall asOf }
          ... on OverlapsExistingLeave { conflictingRequestId from to }
          ... on BlackoutPeriod { from to reason firstClash }
          ... on InsufficientNotice { minNoticeDays requestedStart earliestStart }
        }
      }
    `,

    APPROVE_LEAVE: `
      mutation ApproveLeave($requestId: ID!, $expectedVersion: Int) {
        approveLeave(requestId: $requestId, expectedVersion: $expectedVersion) {
          __typename
          ... on LeaveRequestDecided { request { id status version } balance { remaining } }
          ... on LeaveRequestNotFound { requestId }
          ... on IllegalLeaveTransition { requestId from to allowed }
          ... on InsufficientBalance { requested remaining shortfall }
          ... on VersionConflict { expectedVersion actualVersion }
          ... on LeaveValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    REJECT_LEAVE: `
      mutation RejectLeave($requestId: ID!, $reason: NonEmptyString!, $expectedVersion: Int) {
        rejectLeave(requestId: $requestId, reason: $reason, expectedVersion: $expectedVersion) {
          __typename
          ... on LeaveRequestDecided { request { id status version reason } }
          ... on LeaveRequestNotFound { requestId }
          ... on IllegalLeaveTransition { requestId from to allowed }
          ... on VersionConflict { expectedVersion actualVersion }
          ... on LeaveValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    CANCEL_LEAVE: `
      mutation CancelLeave($requestId: ID!, $reason: String, $expectedVersion: Int) {
        cancelLeave(requestId: $requestId, reason: $reason, expectedVersion: $expectedVersion) {
          __typename
          ... on LeaveRequestDecided { request { id status version } }
          ... on LeaveRequestNotFound { requestId }
          ... on IllegalLeaveTransition { requestId from to allowed }
          ... on VersionConflict { expectedVersion actualVersion }
          ... on LeaveValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    /** One member's holidays, for the detail page's Holidays tab. */
    MEMBER_LEAVE: `
      query MemberLeave($staffId: ID!, $asOf: Date!) {
        crewMember(staffId: $staffId) {
          staffId
          leave {
            balance(asOf: $asOf) {
              leaveYear
              from
              to
              entitlement
              accrued
              carriedOver
              taken
              booked
              expiringSoon
              carryOverExpiresOn
              remaining
              byType { type taken booked }
            }
            requests { totalCount hasMore nodes { id type from to halfDayStart halfDayEnd workingDays status reason decidedAt version } }
            nextBooked { id from to type status }
          }
        }
      }
    `,

    /**
     * One member's training, plus the AgriAcademy link's state.
     *
     * `academyLink` is in the SAME query on purpose. The panel has to say something
     * about the link whatever it is doing, and a second round trip for a banner is
     * a second thing that can fail while the page is already rendering.
     */
    MEMBER_TRAINING: `
      query MemberTraining($staffId: ID!) {
        academyLink { state available message linkedCourses }
        crewMember(staffId: $staffId) {
          staffId
          training {
            compliant
            certifications {
              id
              status
              issuedOn
              expiresOn
              daysUntilExpiry
              reference
              revokedOn
              revokedReason
              superseded
              course { code name provider validMonths academyExamId academyCertificate { certificateNo examTitle issuedOn score } }
            }
            enrollments {
              id
              status
              scheduledFor
              completedOn
              score
              note
              course { code name }
            }
            complianceGaps { reason role course { code name } }
          }
        }
      }
    `,

    /**
     * One member's tools, for the detail page's Tools tab (§8.5).
     *
     * `onIssue` and `overdue` overlap on purpose — `overdue` is a subset — because the
     * two answer different questions ("what have they got?" and "what is late?") and a
     * page that had to compute the second from the first would be re-implementing the
     * server's date rule in the browser, where it would drift.
     */
    MEMBER_TOOLS: `
      query MemberTools($staffId: ID!) {
        crewMember(staffId: $staffId) {
          staffId
          tools {
            onIssue {
              id
              issuedAt
              dueBack
              isOverdueBack
              daysUntilDueBack
              note
              tool { id assetTag name category requiresCertification serviceStatus storageLocation }
            }
            overdue { id dueBack daysUntilDueBack tool { id assetTag name } }
            history(limit: 20) {
              id
              issuedAt
              dueBack
              returnedAt
              conditionOnReturn
              returnedLate
              tool { id assetTag name }
            }
          }
        }
      }
    `,

    /**
     * Everything the work board needs, in ONE round trip: the crew to put in the
     * rows, the duty types for the assign form, and the shifts and work log for the
     * range. Four REST calls collapsed into one query is the reason this module is
     * graph-shaped at all (§1).
     */
    WORK_BOARD: `
      query WorkBoard($from: Date, $to: Date, $staffId: ID) {
        # Which pillars this build has, so the tab strip can drop the ones that are
        # absent (§10.1) without a second round trip for one array.
        crewInfo { pillars }
        crew {
          totalCount
          nodes { staffId name surname orphaned profile { role employmentStatus } }
        }
        dutyTypes { id code name startTime endTime hours crossesMidnight requiredRole colour }
        shifts(from: $from, to: $to, staffId: $staffId) {
          id
          staffId
          date
          status
          hours
          note
          cancelReason
          version
          fieldId
          dutyType { id code name startTime endTime colour }
        }
        workLog(from: $from, to: $to, staffId: $staffId) {
          id
          staffId
          shiftId
          date
          hours
          activity
          note
          effective
          amendsId
          amendedByReason
        }
        workRollup(from: $from, to: $to, staffId: $staffId) {
          from
          to
          hours
          entries
          byActivity { activity hours }
        }
      }
    `,

    DEFINE_DUTY_TYPE: `
      mutation DefineDutyType($input: DutyTypeInput!) {
        defineDutyType(input: $input) {
          __typename
          ... on DutyTypeDefined { dutyType { id code name startTime endTime hours crossesMidnight } }
          ... on WorkValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    PLAN_SHIFT: `
      mutation PlanShift($input: PlanShiftInput!) {
        planShift(input: $input) {
          __typename
          ... on ShiftPlanned { shift { id staffId date status hours version } warnings { code message } }
          ... on ShiftOverlap { conflictingShiftId }
          ... on ShiftConflictsLeave { staffId date }
          ... on MemberNotFound { staffId }
          ... on DutyTypeNotFound { dutyTypeId }
          ... on WorkValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    CONFIRM_SHIFT: `
      mutation ConfirmShift($shiftId: ID!, $expectedVersion: Int) {
        confirmShift(shiftId: $shiftId, expectedVersion: $expectedVersion) {
          __typename
          ... on ShiftTransitioned { shift { id status version } }
          ... on ShiftNotFound { shiftId }
          ... on IllegalShiftTransition { shiftId from to allowed }
          ... on VersionConflict { expectedVersion actualVersion }
        }
      }
    `,

    COMPLETE_SHIFT: `
      mutation CompleteShift($shiftId: ID!, $expectedVersion: Int) {
        completeShift(shiftId: $shiftId, expectedVersion: $expectedVersion) {
          __typename
          ... on ShiftTransitioned { shift { id status version } }
          ... on ShiftNotFound { shiftId }
          ... on IllegalShiftTransition { shiftId from to allowed }
          ... on VersionConflict { expectedVersion actualVersion }
        }
      }
    `,

    CANCEL_SHIFT: `
      mutation CancelShift($shiftId: ID!, $reason: String, $expectedVersion: Int) {
        cancelShift(shiftId: $shiftId, reason: $reason, expectedVersion: $expectedVersion) {
          __typename
          ... on ShiftTransitioned { shift { id status version cancelReason } }
          ... on ShiftNotFound { shiftId }
          ... on IllegalShiftTransition { shiftId from to allowed }
          ... on VersionConflict { expectedVersion actualVersion }
        }
      }
    `,

    LOG_WORK: `
      mutation LogWork($input: LogWorkInput!) {
        logWork(input: $input) {
          __typename
          ... on WorkLogged { entry { id staffId date hours activity effective } }
          ... on MemberNotFound { staffId }
          ... on ShiftNotFound { shiftId }
          ... on WorkValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    AMEND_WORK_LOG: `
      mutation AmendWorkLog($entryId: ID!, $hours: Float, $activity: NonEmptyString, $reason: NonEmptyString!) {
        amendWorkLog(entryId: $entryId, hours: $hours, activity: $activity, reason: $reason) {
          __typename
          ... on WorkLogAmended { correction { id hours activity effective } original { id hours effective } }
          ... on WorkLogEntryNotFound { entryId }
          ... on WorkValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    /**
     * The tool registry, in ONE round trip (§8.5): the crew for the issue form, every
     * tool with its derived status and holder, and the overdue-returns list.
     *
     * `status` and `currentHolder` are computed server-side from the issuance ledger
     * on every read — there is no `heldBy` column to fetch. That is why this page can
     * never show a holder that disagrees with the ledger: it has no second source to
     * disagree with.
     *
     * The per-tool LEDGER is deliberately not here. A farm with 200 tools and years of
     * history would ship tens of thousands of rows to render a table that shows none of
     * them; `TOOL_DETAIL` fetches one tool's history when somebody opens it.
     */
    TOOL_BOARD: `
      query ToolBoard($filter: ToolFilter) {
        # Which pillars this build has, so the tab strip can drop the ones that are
        # absent (§10.1) without a second round trip for one array.
        crewInfo { pillars }
        crew {
          totalCount
          nodes { staffId name surname orphaned profile { role employmentStatus } }
        }
        tools(filter: $filter) {
          id
          assetTag
          name
          category
          icon
          requiresCertification
          serviceIntervalDays
          lastServicedOn
          nextServiceDue
          serviceStatus
          daysUntilService
          status
          storageLocation
          retiredOn
          retiredReason
          version
          currentIssuance { id staffId issuedAt dueBack isOverdueBack daysUntilDueBack note }
          currentHolder { staffId name surname orphaned }
        }
        overdueReturns {
          id
          staffId
          issuedAt
          dueBack
          daysUntilDueBack
          tool { id assetTag name }
          member { staffId name surname orphaned }
        }
      }
    `,

    /**
     * One tool's full history, fetched when it is selected.
     *
     * `issuanceHistory` is the append-only ledger in append order — including the
     * closed rows, which is the whole point: "who had the chainsaw in July?" stays
     * answerable after it has been out four more times.
     */
    TOOL_DETAIL: `
      query ToolDetail($id: ID!) {
        tool(id: $id) {
          id
          assetTag
          name
          category
          icon
          requiresCertification
          serviceIntervalDays
          lastServicedOn
          nextServiceDue
          serviceStatus
          daysUntilService
          status
          storageLocation
          retiredOn
          retiredReason
          version
          currentIssuance { id staffId issuedAt dueBack isOverdueBack daysUntilDueBack note }
          currentHolder { staffId name surname orphaned }
          issuanceHistory {
            id
            staffId
            issuedAt
            dueBack
            returnedAt
            conditionOnReturn
            note
            isOverdueBack
            daysUntilDueBack
            returnedLate
            member { staffId name surname orphaned }
          }
          serviceHistory { id servicedOn performedBy note }
        }
      }
    `,

    /**
     * Whether a member could be issued a tool right now, asked without writing.
     *
     * The gate is one function on the server, so this answers exactly as `issueTool`
     * would — which is why the issue form can warn BEFORE submitting instead of
     * offering a button that is going to be refused. `permitted: false` with an
     * `unavailableReason` is the fail-closed case (§8.5): the check could not be run,
     * and that is a refusal.
     */
    TOOL_CERTIFICATION_CHECK: `
      query ToolCertificationCheck($staffId: ID!, $toolId: ID!) {
        crewMember(staffId: $staffId) {
          staffId
          tools {
            certificationCheck(toolId: $toolId) {
              permitted
              requiredCertification
              certificationStatus
              unavailableReason
              message
            }
          }
        }
      }
    `,

    REGISTER_TOOL: `
      mutation RegisterTool($input: RegisterToolInput!) {
        registerTool(input: $input) {
          __typename
          ... on ToolRegistered { tool { id assetTag name category icon status serviceStatus version } }
          ... on ToolValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    ISSUE_TOOL: `
      mutation IssueTool($input: IssueToolInput!) {
        issueTool(input: $input) {
          __typename
          ... on ToolIssued { issuance { id staffId dueBack } tool { id assetTag status } }
          ... on ToolUnavailable { toolId reason currentHolder { staffId name surname } }
          ... on ToolRequiresCertification { tool { id assetTag name } requiredCertification certificationStatus }
          ... on CertificationCheckUnavailable { tool { id assetTag name } requiredCertification failure detail }
          ... on MemberNotFound { staffId }
        }
      }
    `,

    RETURN_TOOL: `
      mutation ReturnTool($input: ReturnToolInput!) {
        returnTool(input: $input) {
          __typename
          ... on ToolReturned { late issuance { id staffId returnedAt conditionOnReturn } tool { id assetTag status serviceStatus } }
          ... on ToolNotOnIssue { toolId status }
          ... on ToolNotFound { toolId }
          ... on ToolValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    RECORD_SERVICE: `
      mutation RecordService($input: RecordServiceInput!) {
        recordService(input: $input) {
          __typename
          ... on ServiceRecorded { record { id servicedOn performedBy } tool { id assetTag status serviceStatus lastServicedOn version } }
          ... on ToolNotServiceable { toolId status currentHolder { staffId name surname } }
          ... on ToolNotFound { toolId }
          ... on ToolVersionConflict { toolId expectedVersion actualVersion }
          ... on ToolValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    RETIRE_TOOL: `
      mutation RetireTool($toolId: ID!, $reason: NonEmptyString!, $expectedVersion: Int) {
        retireTool(toolId: $toolId, reason: $reason, expectedVersion: $expectedVersion) {
          __typename
          ... on ToolRetired { tool { id assetTag status retiredOn retiredReason } }
          ... on ToolAlreadyRetired { toolId retiredOn retiredReason }
          ... on ToolStillOnIssue { toolId currentHolder { staffId name surname } }
          ... on ToolNotFound { toolId }
          ... on ToolVersionConflict { toolId expectedVersion actualVersion }
          ... on ToolValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    HIRE: `
      mutation Hire($input: HireCrewMemberInput!) {
        hireCrewMember(input: $input) {
          __typename
          ... on CrewMemberHired {
            crewMember { staffId name surname profile { role employmentStatus version } }
          }
          ... on CrewMemberHiredWithoutProfile { staffId reason code }
          ... on HireValidationFailed { fieldErrors { field message } }
        }
      }
    `,

    UPSERT_PROFILE: `
      mutation UpsertProfile($input: CrewProfileInput!) {
        upsertCrewProfile(input: $input) {
          __typename
          ... on CrewProfileUpserted {
            crewMember { staffId profile { role employmentStatus version } }
          }
          ... on ProfileValidationFailed { fieldErrors { field message } }
          ... on MemberNotFound { staffId }
          ... on VersionConflict { staffId expectedVersion actualVersion }
        }
      }
    `,

    END_EMPLOYMENT: `
      mutation EndEmployment($staffId: ID!, $lastDay: Date!, $reason: String, $expectedVersion: Int) {
        recordEmploymentEnd(staffId: $staffId, lastDay: $lastDay, reason: $reason, expectedVersion: $expectedVersion) {
          __typename
          ... on EmploymentEnded {
            lastDay
            crewMember { staffId profile { endDate endReason employmentStatus version } }
          }
          ... on ProfileValidationFailed { fieldErrors { field message } }
          ... on MemberNotFound { staffId }
          ... on VersionConflict { staffId expectedVersion actualVersion }
        }
      }
    `,
  };

  // Human wording for the codes a page can actually meet. Anything absent falls
  // back to the server's message, which is already safe (§15 masks the rest).
  const ERROR_MESSAGES = {
    GRAPHQL_PARSE_FAILED: "That operation could not be parsed.",
    GRAPHQL_VALIDATION_FAILED: "That operation does not match the schema.",
    QUERY_TOO_DEEP: "That query nests too deeply.",
    QUERY_TOO_COSTLY: "That query asks for too much at once.",
    MEMBER_NOT_FOUND: "That crew member could not be found.",
    VERSION_CONFLICT: "Someone else changed this record first. Reload and try again.",
    VALIDATION_FAILED: "Some fields need fixing.",
    HIRE_VALIDATION_FAILED: "The hire details need fixing.",
    PROFILE_WRITE_FAILED: "The staff record was created but the profile could not be saved.",
    CHECK_UNAVAILABLE: "A cross-check could not be run, so the request was refused.",
    DOCUMENT_TOO_LARGE: "That operation is too large.",
    UNSUPPORTED_MEDIA_TYPE: "The request was sent in the wrong format.",
    INTERNAL_ERROR: "Something went wrong on the server. The error was logged.",
  };

  // --- module tabs ----------------------------------------------------------

  /**
   * The Crew Office views, as one tab strip.
   *
   * Defined here rather than duplicated in five HTML files so a new view is one entry
   * and every page gains it. Each tab is a LINK, not a button: these are separate
   * pages, so a tab must be deep-linkable, openable in a new tab, and printable on
   * its own — a JS-only view switch would take all three away.
   *
   * `crew-member.html` deliberately does NOT carry this strip. It is a detail view
   * reached from the roster and already has its own in-page tabs (Overview, Work,
   * Holidays…); stacking a page-level tab strip above those would leave two rows of
   * tabs meaning different things.
   */
  const MODULE_TABS = [
    { href: "/crew.html", label: "Roster", icon: "fa-people-group", pillar: null },
    { href: "/crew-work.html", label: "Work board", icon: "fa-calendar-days", pillar: "work" },
    { href: "/crew-leave.html", label: "Holidays", icon: "fa-umbrella-beach", pillar: "leave" },
    { href: "/crew-tools.html", label: "Tools", icon: "fa-screwdriver-wrench", pillar: "tools" },
    { href: "/crew-explorer.html", label: "GraphQL", icon: "fa-diagram-project", pillar: null },
  ];

  /**
   * Which tab is current, derived from the path rather than passed in by each page.
   *
   * Derived on purpose: an argument per page is one more thing to get wrong, and a
   * page whose argument drifted would highlight the wrong tab while looking fine.
   *
   * **Pillar filtering (§10.1).** A tab whose pillar is not assembled is dropped:
   * offering "Holidays" in a build without the leave pillar is a link to a page that
   * can only apologise. `pillar: null` marks the two tabs that are always there —
   * the roster reads `staff.json`, and the explorer needs no pillar at all.
   *
   * `pillars` is deliberately TRI-STATE, because a page renders its strip before it
   * has asked the server anything:
   *
   *   - `undefined`/`null` — not known yet ⇒ show everything. A strip that started
   *     short and grew would jump under the cursor;
   *   - an array — filter. Pages call this again after `crewInfo` answers.
   *
   * Showing too much briefly is the better failure: the tab still leads to a page
   * that explains itself, whereas hiding a tab that should be there leaves a working
   * view unreachable.
   *
   * @param {string} pathname
   * @param {string[]|null} [pillars] - assembled pillar names, or null when unknown
   * @returns {Array<{href, label, icon, pillar, active}>}
   */
  function moduleTabs(pathname, pillars) {
    // Tolerate a trailing-slash or query-carrying path, and treat the bare /crew
    // redirect target as the roster.
    const path =
      String(pathname || "")
        .split("?")[0]
        .replace(/\/+$/, "") || "/crew.html";
    const normalised = path === "/crew" ? "/crew.html" : path;
    const known = Array.isArray(pillars) ? pillars : null;

    return MODULE_TABS.filter((tab) => {
      if (!tab.pillar || !known) return true;
      // The tab for the page you are ON is never hidden. Dropping it would leave the
      // strip with nothing marked current, which reads as a broken page rather than
      // as a switched-off pillar — and the page itself says which pillar is missing.
      if (tab.href === normalised) return true;
      return known.indexOf(tab.pillar) !== -1;
    }).map((tab) => ({ ...tab, active: tab.href === normalised }));
  }

  /**
   * Render the strip into `#crewTabs`, if the page has one.
   *
   * @param {string} [pathname]
   * @param {string[]|null} [pillars] - pass once known, to drop switched-off pillars
   */
  function renderModuleTabs(pathname, pillars) {
    const container = document.getElementById("crewTabs");
    if (!container) return;

    const tabs = moduleTabs(pathname === undefined ? window.location.pathname : pathname, pillars);
    container.innerHTML = tabs
      .map(
        (tab) =>
          '<a class="crew-tab crew-tab--link' +
          (tab.active ? " crew-tab--active" : "") +
          '" href="' +
          escapeHtml(tab.href) +
          '"' +
          // aria-current is what tells a screen reader which view is showing; the
          // colour alone would not.
          (tab.active ? ' aria-current="page"' : "") +
          '><i class="fa-solid ' +
          escapeHtml(tab.icon) +
          '"></i> ' +
          escapeHtml(tab.label) +
          "</a>",
      )
      .join("");
  }

  // --- form validation ------------------------------------------------------

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

  /**
   * Validate form values BEFORE they reach the graph.
   *
   * This exists because of a specific bad experience: leaving `hours` empty produced
   * `Number("")` → `NaN` → `null` on the wire, which `Float!` rejected as a variable
   * coercion error, and the user was told "That operation does not match the schema."
   * That is a true sentence about the wrong layer — a blank required field is a form
   * problem and must be reported as one, naming the field.
   *
   * Deliberately PURE: rules carry their own values, so the whole matrix is unit
   * tested without a DOM (`crew.form-validation.test.js`). The rules mirror the
   * server's own limits, so a value that passes here is one the server will accept —
   * and when the server still refuses, its `fieldErrors` are rendered the same way.
   *
   * @param {Array} rules - { field, label, value, required, kind, ... }
   * @returns {Array<{field: string, message: string}>} empty when everything is fine
   */
  function validateInput(rules) {
    const errors = [];
    const add = (field, message) => errors.push({ field: field, message: message });

    for (const rule of rules || []) {
      const label = rule.label || rule.field;
      const raw = rule.value === null || rule.value === undefined ? "" : String(rule.value).trim();

      if (raw === "") {
        // An optional blank is simply absent; a required blank is the case that used
        // to escape to the server as a schema error.
        if (rule.required) add(rule.field, label + " is required.");
        continue;
      }

      if (rule.maxLength && raw.length > rule.maxLength) {
        add(rule.field, label + " must be at most " + rule.maxLength + " characters.");
        continue;
      }

      if (rule.kind === "date") {
        if (!DATE_PATTERN.test(raw)) {
          add(rule.field, label + " must be a date.");
          continue;
        }
        // A round trip is what rejects 30 February, which the pattern happily allows.
        const parsed = new Date(raw + "T00:00:00.000Z");
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
          add(rule.field, label + " is not a real date.");
        }
        continue;
      }

      if (rule.kind === "time") {
        if (!TIME_PATTERN.test(raw)) add(rule.field, label + " must be a time in HH:MM, 24-hour.");
        continue;
      }

      if (rule.kind === "number" || rule.kind === "integer") {
        const number = Number(raw);
        if (!Number.isFinite(number)) {
          add(rule.field, label + " must be a number.");
          continue;
        }
        if (rule.kind === "integer" && !Number.isInteger(number)) {
          add(rule.field, label + " must be a whole number.");
          continue;
        }
        if (rule.min !== undefined && number < rule.min) {
          add(rule.field, label + " must be at least " + rule.min + ".");
          continue;
        }
        if (rule.max !== undefined && number > rule.max) {
          add(rule.field, label + " must be at most " + rule.max + ".");
          continue;
        }
        // The step check compares the QUOTIENT to its nearest integer, with a
        // tolerance. Multiplying back out is the trap: 0.3 / 0.1 is 2.9999999999999996,
        // and Math.round(0.3 / 0.1) * 0.1 is 0.30000000000000004 — so a valid 0.3 FTE
        // would be rejected by an equality test against 0.3.
        if (rule.step) {
          const quotient = number / rule.step;
          if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
            add(rule.field, label + " must be in steps of " + rule.step + ".");
          }
        }
        continue;
      }

      if (rule.pattern && !rule.pattern.test(raw)) {
        add(rule.field, rule.patternMessage || label + " is not in the expected format.");
      }
    }

    return errors;
  }

  /**
   * Show field errors on the form: mark each input, focus the first, and list them.
   *
   * Used for BOTH client-side rules and the server's `fieldErrors`, so a rejection
   * looks the same wherever it came from.
   *
   * @param {Array<{field, message}>} errors
   * @param {object} idByField - form field name → input element id
   * @param {HTMLElement} errorsElement
   */
  function applyFieldErrors(errors, idByField, errorsElement) {
    clearFieldErrors(idByField);
    if (!errors || errors.length === 0) return;

    let firstElement = null;
    for (const error of errors) {
      const element = document.getElementById((idByField || {})[error.field] || error.field);
      if (!element) continue;
      element.setAttribute("aria-invalid", "true");
      if (!firstElement) firstElement = element;
    }

    setStatus(errorsElement, "error", errors.map((error) => error.message).join(" "));
    // Focus the first offender, so a long form does not make the user hunt for it.
    if (firstElement && typeof firstElement.focus === "function") firstElement.focus();
  }

  /** Drop the invalid marks — called before every re-validation and on close. */
  function clearFieldErrors(idByField) {
    for (const id of Object.values(idByField || {})) {
      const element = document.getElementById(id);
      if (element) element.removeAttribute("aria-invalid");
    }
  }

  /** Read a trimmed value from an input by id. "" when the element is missing. */
  function readValue(id) {
    const element = document.getElementById(id);
    return element && typeof element.value === "string" ? element.value.trim() : "";
  }

  /**
   * A validated numeric value, or null when blank.
   *
   * The point of the null: `Number("")` is NaN and `JSON.stringify(NaN)` is `null`,
   * which is how a blank field became a schema error. Returning null EXPLICITLY for
   * an optional blank, and never returning NaN, is what keeps that from recurring.
   */
  function numberOrNull(value) {
    const raw = value === null || value === undefined ? "" : String(value).trim();
    if (raw === "") return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  /** True when a session cookie is present. A HINT — never a barrier (§9.1.4). */
  function hasSessionHint() {
    if (typeof isLoggedIn === "function") return isLoggedIn();
    return document.cookie.indexOf("rolnopolLoginTime=") !== -1;
  }

  /** Send the browser to login, remembering where it was going. */
  function redirectToLogin() {
    const returnUrl = window.location.pathname + window.location.search;
    window.location.href = "/login.html?returnUrl=" + encodeURIComponent(returnUrl);
  }

  /**
   * The guard every crew page calls first.
   *
   * Returns false when it has started a redirect, so a controller can simply
   * `if (!CrewApi.requireSession()) return;` before its first fetch. An expired
   * session therefore produces a login prompt rather than an empty page.
   */
  function requireSession() {
    if (hasSessionHint()) return true;
    redirectToLogin();
    return false;
  }

  /**
   * Run one named operation.
   *
   * @param {string} operation - a value from CrewApi.OPERATIONS
   * @param {object} [variables]
   * @returns {Promise<{ok: boolean, data?: object, errors?: Array, status: number, extensions?: object}>}
   */
  async function run(operation, variables) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ query: operation, variables: variables || {} }),
      });
    } catch (error) {
      return { ok: false, status: 0, errors: [{ message: "Crew Office could not be reached.", extensions: { code: "NETWORK" } }] };
    }

    // A session that expires MID-session must behave exactly like one that was
    // never there (§9.1.4) — same redirect, same returnUrl.
    if (res.status === 401 || res.status === 403) {
      redirectToLogin();
      return { ok: false, status: res.status, errors: [{ message: "Session expired.", extensions: { code: "UNAUTHENTICATED" } }] };
    }

    // 404 means the module is switched off (or was, mid-visit). The page reports
    // it rather than pretending the data is empty.
    if (res.status === 404) {
      return { ok: false, status: 404, errors: [{ message: "Crew Office is not enabled.", extensions: { code: "NOT_ENABLED" } }] };
    }

    let body;
    try {
      body = await res.json();
    } catch (error) {
      return { ok: false, status: res.status, errors: [{ message: "Crew Office returned an unreadable response.", extensions: {} }] };
    }

    return {
      ok: res.ok && !body.errors,
      status: res.status,
      data: body.data,
      errors: body.errors,
      extensions: body.extensions,
    };
  }

  /** Fetch the SDL of the schema as currently assembled. */
  async function fetchSdl() {
    const res = await fetch(ENDPOINT, { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) {
      redirectToLogin();
      return null;
    }
    if (!res.ok) return null;
    return res.text();
  }

  /** One sentence describing a failed result, from its code where we have one. */
  function describeErrors(result) {
    if (!result || !result.errors || result.errors.length === 0) return "";
    return result.errors
      .map((error) => {
        const code = error.extensions && error.extensions.code;
        return (code && ERROR_MESSAGES[code]) || error.message || "Unknown error.";
      })
      .join(" ");
  }

  /**
   * Describe a result-union member — the outcomes that are answers rather than
   * errors, and therefore arrive with HTTP 200 and no `errors` array at all.
   */
  function describeUnion(member) {
    if (!member || !member.__typename) return "";
    switch (member.__typename) {
      case "CrewMemberHired":
        return "Hired.";
      case "CrewProfileUpserted":
        return "Profile saved.";
      case "EmploymentEnded":
        return "Employment end recorded. The staff record is untouched.";
      case "CrewMemberHiredWithoutProfile":
        return "Staff record created, but the profile could not be saved — nothing was rolled back. You can complete the profile now.";
      case "HireValidationFailed":
      case "ProfileValidationFailed":
        return (member.fieldErrors || []).map((error) => error.field + ": " + error.message).join("; ") || "Some fields need fixing.";
      case "ShiftPlanned":
        return (member.warnings || []).length > 0
          ? "Shift assigned, with a warning: " + member.warnings.map((warning) => warning.message).join(" ")
          : "Shift assigned.";
      case "ShiftTransitioned":
        return "Shift is now " + labelForShiftStatus(member.shift && member.shift.status) + ".";
      case "DutyTypeDefined":
        return "Duty type created.";
      case "WorkLogged":
        return "Time logged.";
      case "WorkLogAmended":
        return "Correction appended — the original entry is kept and no longer counts.";
      case "ShiftOverlap":
        return "That member already has a shift covering part of this window (shift " + member.conflictingShiftId + ").";
      case "ShiftConflictsLeave":
        return "That member has approved leave on " + member.date + ".";

      // --- leave (§8.3) -----------------------------------------------------
      case "LeaveBooked":
        return "Holiday requested — it is now awaiting a decision.";
      case "LeaveBookedWithWarning":
        // A SUCCESS. Saying "requested" FIRST matters: this type is a booking that
        // carries advice, and leading with the warning would read as a refusal —
        // which is the exact bug §8.3 calls out.
        return (
          "Holiday requested. Worth knowing: " +
          (member.warnings || []).map((warning) => warning.message).join(" ") +
          " The request is booked either way."
        );
      case "InsufficientBalance":
        return (
          "Not enough leave: " +
          member.requested +
          " day(s) asked for, " +
          member.remaining +
          " available" +
          (member.asOf ? " as at " + member.asOf : "") +
          " — short by " +
          member.shortfall +
          "."
        );
      case "OverlapsExistingLeave":
        return "That member already has leave booked from " + member.from + " to " + member.to + ".";
      case "BlackoutPeriod":
        return (
          "That period is closed for leave" +
          (member.reason ? " (" + member.reason + ")" : "") +
          " — the first clash is " +
          member.firstClash +
          "."
        );
      case "InsufficientNotice":
        return (
          "That is short notice: " + member.minNoticeDays + " day(s) are required, so the earliest start is " + member.earliestStart + "."
        );
      case "LeaveRequestDecided":
        return "Holiday is now " + labelForLeaveStatus(member.request && member.request.status).toLowerCase() + ".";
      case "LeaveRequestNotFound":
        return "That holiday request could not be found.";
      case "IllegalLeaveTransition":
        return (
          "A " +
          labelForLeaveStatus(member.from).toLowerCase() +
          " request cannot become " +
          labelForLeaveStatus(member.to).toLowerCase() +
          ". Allowed: " +
          (member.allowed || []).map(labelForLeaveStatus).join(", ") +
          "."
        );
      case "LeavePolicySet":
        return "Leave policy saved.";
      case "LeaveBalanceAdjusted":
        return "Balance adjusted.";
      case "BlackoutDeclared":
        return "Blackout period declared. Leave already approved inside it is untouched.";
      case "LeavePolicyMissing":
        return "No leave policy is configured yet, so balances cannot be computed.";
      case "LeaveValidationFailed":
        return (member.fieldErrors || []).map((error) => error.field + ": " + error.message).join("; ") || "Some fields need fixing.";
      case "IllegalShiftTransition":
        return (
          "A " +
          labelForShiftStatus(member.from) +
          " shift cannot become " +
          labelForShiftStatus(member.to) +
          ". Allowed: " +
          (member.allowed || []).map(labelForShiftStatus).join(", ") +
          "."
        );
      case "DutyTypeNotFound":
        return "That duty type could not be found.";
      case "ShiftNotFound":
        return "That shift could not be found.";
      case "WorkLogEntryNotFound":
        return "That work-log entry could not be found.";
      case "WorkValidationFailed":
        return (member.fieldErrors || []).map((error) => error.field + ": " + error.message).join("; ") || "Some fields need fixing.";
      // --- tools (§8.5) -----------------------------------------------------
      case "ToolRegistered":
        return "Tool added to the registry.";
      case "ToolIssued":
        return "Issued — due back " + (member.issuance && member.issuance.dueBack) + ".";
      case "ToolUnavailable":
        return (
          "That tool cannot go out: " +
          labelForToolUnavailable(member.reason) +
          (member.currentHolder ? " (" + member.currentHolder.name + " " + member.currentHolder.surname + ")" : "") +
          "."
        );
      case "ToolRequiresCertification":
        // A refusal about a person, not about the tool — so it names the course they
        // need and what state their ticket is in.
        return (
          "Refused: this tool requires the " +
          member.requiredCertification +
          " certification, and this member's is " +
          labelForCertificationStatus(member.certificationStatus).toLowerCase() +
          "."
        );
      case "CertificationCheckUnavailable":
        // §8.5's fail-closed outcome, and the wording is the whole point: it must read
        // as a refusal. The server writes a complete sentence, so prefer it — but never
        // let a missing `detail` turn this into something that sounds like a pass.
        return (
          member.detail ||
          "Refused: the " +
            member.requiredCertification +
            " certification could not be checked because " +
            labelForCheckFailure(member.failure) +
            ", so the tool cannot be issued."
        );
      case "ToolReturned":
        return member.late ? "Returned — it was back after its due date." : "Returned.";
      case "ToolNotOnIssue":
        return "Nobody has that tool out — it is " + labelForToolStatus(member.status).toLowerCase() + ".";
      case "ServiceRecorded":
        return "Service recorded. The tool is back on the shelf.";
      case "ToolNotServiceable":
        return member.status === "ON_ISSUE"
          ? "That tool is out with " +
              (member.currentHolder ? member.currentHolder.name + " " + member.currentHolder.surname : "somebody") +
              " — it has to come back before a service can be recorded."
          : "A retired tool cannot be serviced.";
      case "ToolRetired":
        return "Retired. The tool keeps its row, its ledger and its service history — nothing was deleted.";
      case "ToolAlreadyRetired":
        return (
          "That tool was already retired" +
          (member.retiredOn ? " on " + member.retiredOn : "") +
          (member.retiredReason ? " (" + member.retiredReason + ")" : "") +
          ". Retirement is not repeatable."
        );
      case "ToolStillOnIssue":
        return (
          "That tool is out with " +
          (member.currentHolder ? member.currentHolder.name + " " + member.currentHolder.surname : "somebody") +
          ". It has to come back first — or be returned as lost, which retires it."
        );
      case "ToolNotFound":
        return "That tool could not be found.";
      case "ToolVersionConflict":
        return (
          "Someone else changed that tool first (you had version " + member.expectedVersion + ", it is now " + member.actualVersion + ")."
        );
      case "ToolValidationFailed":
        return (member.fieldErrors || []).map((error) => error.field + ": " + error.message).join("; ") || "Some fields need fixing.";

      case "MemberNotFound":
        return "That crew member could not be found.";
      case "VersionConflict":
        return (
          "Someone else changed this record first (you had version " + member.expectedVersion + ", it is now " + member.actualVersion + ")."
        );
      default:
        return member.__typename;
    }
  }

  /** Escape text before it goes anywhere near innerHTML. */
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  /**
   * A transient toast, via the app's own notification component (§10.2).
   *
   * Wrapped rather than called directly for two reasons: `window.showNotification`
   * needs `window.App` to have booted, and a page that fired a toast into a missing
   * component would lose the message silently. So a missing component falls back to
   * the page's status line — the user is told either way, which is the whole job.
   *
   * @param {string} message
   * @param {"success"|"error"|"info"|"warning"} [tone]
   * @param {HTMLElement} [fallbackElement] - status line to use if toasts are absent
   */
  function toast(message, tone, fallbackElement) {
    if (!message) return;
    if (typeof window !== "undefined" && typeof window.showNotification === "function") {
      window.showNotification(message, tone || "info");
      return;
    }
    setStatus(fallbackElement, tone === "error" ? "error" : "info", message);
  }

  /** Shared status-line renderer, so every page reports the same way. */
  function setStatus(element, tone, text) {
    if (!element) return;
    element.textContent = text || "";
    element.setAttribute("data-tone", tone || "info");
    element.className = "crew-status" + (tone === "error" ? " crew-status--error" : "");
  }

  /** `?staffId=3` — the one query parameter the crew pages read. */
  function staffIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const staffId = params.get("staffId");
    return staffId && /^\d+$/.test(staffId) ? staffId : null;
  }

  const ROLE_LABELS = {
    STOCKPERSON: "Stockperson",
    TRACTOR_DRIVER: "Tractor driver",
    AGRONOMIST: "Agronomist",
    DAIRY_HAND: "Dairy hand",
    MECHANIC: "Mechanic",
    SEASONAL_PICKER: "Seasonal picker",
    MANAGER: "Manager",
  };

  const STATUS_LABELS = {
    ACTIVE: "Active",
    PROBATION: "Probation",
    NOTICE: "Notice",
    ENDED: "Ended",
  };

  const SHIFT_STATUS_LABELS = {
    PLANNED: "Planned",
    CONFIRMED: "Confirmed",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };

  function labelForShiftStatus(status) {
    return SHIFT_STATUS_LABELS[status] || status || "—";
  }

  const LEAVE_TYPE_LABELS = {
    ANNUAL: "Annual",
    SICK: "Sick",
    UNPAID: "Unpaid",
    PARENTAL: "Parental",
    BEREAVEMENT: "Bereavement",
  };

  const LEAVE_STATUS_LABELS = {
    REQUESTED: "Awaiting decision",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    // Two words for two events, as the server distinguishes them: a pending request
    // pulled by the requester is a withdrawal; an approved holiday called off is a
    // cancellation.
    WITHDRAWN: "Withdrawn",
  };

  function labelForLeaveType(type) {
    return LEAVE_TYPE_LABELS[type] || type || "—";
  }

  function labelForLeaveStatus(status) {
    return LEAVE_STATUS_LABELS[status] || status || "—";
  }

  const CERTIFICATION_STATUS_LABELS = {
    VALID: "Valid",
    EXPIRING_SOON: "Expiring soon",
    EXPIRED: "Expired",
    REVOKED: "Revoked",
  };

  const ENROLLMENT_STATUS_LABELS = {
    PLANNED: "Booked",
    IN_PROGRESS: "In progress",
    PASSED: "Passed",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
  };

  const GAP_REASON_LABELS = {
    MISSING: "never certified",
    EXPIRED: "certificate expired",
    REVOKED: "certificate revoked",
  };

  // --- tools (§8.5) ---------------------------------------------------------

  const TOOL_STATUS_LABELS = {
    AVAILABLE: "Available",
    ON_ISSUE: "On issue",
    IN_SERVICE: "In service",
    RETIRED: "Retired",
  };

  const SERVICE_STATUS_LABELS = {
    OK: "OK",
    DUE_SOON: "Due soon",
    OVERDUE: "Overdue",
  };

  const TOOL_CATEGORY_LABELS = {
    HAND_TOOL: "Hand tool",
    POWERED_HAND_TOOL: "Powered hand tool",
    MACHINERY: "Machinery",
    VEHICLE: "Vehicle",
    PPE: "PPE",
    MEASURING: "Measuring",
    OTHER: "Other",
  };

  /**
   * Return conditions, worded so the CONSEQUENCE is visible at the point of choosing.
   *
   * Three of the four take the tool out of circulation, and somebody picking from a
   * dropdown has no way to know that from the bare enum name. "Damaged" and "Damaged —
   * needs a service before reissue" are the same value and very different prompts.
   */
  const RETURN_CONDITION_LABELS = {
    GOOD: "Good — back on the shelf",
    DAMAGED: "Damaged — off the run until serviced",
    NEEDS_SERVICE: "Needs a service — off the run until serviced",
    LOST: "Lost — retires the tool",
  };

  const TOOL_UNAVAILABLE_LABELS = {
    NOT_FOUND: "no such tool",
    ON_ISSUE: "somebody is holding it",
    IN_SERVICE: "it is in for a service",
    RETIRED: "it has been retired",
  };

  /**
   * Why a certification check could not be run.
   *
   * Every one of these is a REFUSAL, never a pass (§8.5) — the wording below never
   * suggests retrying as if the answer had been yes.
   */
  const CERTIFICATION_CHECK_FAILURE_LABELS = {
    TRAINING_UNAVAILABLE: "training records are not available in this build",
    COURSE_NOT_DEFINED: "no course is defined with the code this tool requires",
    STORE_UNREADABLE: "the training records could not be read",
    NO_COURSE_CODE: "this tool names no usable certification code",
    CHECK_FAILED: "the check could not be completed",
    CERTIFICATION_CHECK_UNAVAILABLE: "the check could not be completed",
  };

  /**
   * One icon per tool state, and one per service state (§8.5, §10.2).
   *
   * Here rather than in the page, for the same reason the LABELS are: a tool's state
   * is shown in the table, in the detail panel, on the action buttons and in the flow
   * modal, and four hand-kept copies is how one of them ends up showing a wrench for
   * a retired tool.
   *
   * The icon is always an ADDITION to the label, never a replacement. Font Awesome is
   * a CDN dependency and simply fails to arrive sometimes; a state shown only as a
   * glyph would then be shown as nothing.
   */
  const TOOL_STATUS_ICONS = {
    AVAILABLE: "fa-circle-check",
    // The same glyph the Issue button carries, so "on issue" and the action that
    // caused it are recognisably the same thing.
    ON_ISSUE: "fa-hand-holding",
    IN_SERVICE: "fa-screwdriver-wrench",
    RETIRED: "fa-box-archive",
  };

  const SERVICE_STATUS_ICONS = {
    OK: "fa-circle-check",
    DUE_SOON: "fa-clock",
    OVERDUE: "fa-triangle-exclamation",
  };

  /**
   * The icons a tool may be given, in the order the picker offers them (§8.5).
   *
   * This is the ONE place a `ToolIcon` enum value becomes a CSS class. The server
   * stores the key and never a class, so changing icon library is a change to this
   * map and to no data — and, more importantly, a stored value can only ever be a
   * member of the schema's enum, which is what makes it safe to interpolate into a
   * `class` attribute at all.
   *
   * Kept in step with `services/crew/pillars/tools/schema.graphql` by a test rather
   * than by hope: a value the schema accepts and this map has no glyph for would
   * render an empty square.
   */
  const TOOL_ICON_CHOICES = [
    { value: "WRENCH", label: "Wrench", icon: "fa-wrench" },
    { value: "SCREWDRIVER", label: "Screwdriver", icon: "fa-screwdriver" },
    { value: "HAMMER", label: "Hammer", icon: "fa-hammer" },
    { value: "TOOLBOX", label: "Toolbox", icon: "fa-toolbox" },
    // Font Awesome free has no chainsaw. `fa-gears` was the obvious stand-in and is
    // the wrong one — it is already what an un-iconed MACHINERY tool falls back to, so
    // the two would be indistinguishable in the table. The tree says "tree work",
    // which is what a chainsaw is for here.
    { value: "CHAINSAW", label: "Chainsaw / tree work", icon: "fa-tree" },
    { value: "TRACTOR", label: "Tractor", icon: "fa-tractor" },
    { value: "TRUCK", label: "Truck", icon: "fa-truck-pickup" },
    { value: "TRAILER", label: "Trailer", icon: "fa-trailer" },
    { value: "OIL_CAN", label: "Oil can", icon: "fa-oil-can" },
    { value: "SPRAYER", label: "Sprayer", icon: "fa-spray-can" },
    { value: "SEEDLING", label: "Planting", icon: "fa-seedling" },
    { value: "HELMET", label: "Helmet", icon: "fa-helmet-safety" },
    { value: "VEST", label: "Harness / vest", icon: "fa-vest" },
    { value: "RULER", label: "Measure", icon: "fa-ruler-combined" },
    { value: "SCALE", label: "Scales", icon: "fa-scale-balanced" },
    { value: "PLUG", label: "Powered", icon: "fa-plug" },
    { value: "BATTERY", label: "Battery", icon: "fa-battery-full" },
    { value: "FIRE_EXTINGUISHER", label: "Extinguisher", icon: "fa-fire-extinguisher" },
    { value: "FIRST_AID", label: "First aid", icon: "fa-kit-medical" },
  ];

  /**
   * The glyph a CATEGORY falls back to.
   *
   * Every tool gets an icon whether or not anybody chose one, which is what lets the
   * registry be scanned rather than read. The fallback is deliberately duller than the
   * picked icons: it says "a powered hand tool", not "this particular drill".
   */
  const TOOL_CATEGORY_ICONS = {
    HAND_TOOL: "fa-screwdriver",
    POWERED_HAND_TOOL: "fa-plug",
    MACHINERY: "fa-gears",
    VEHICLE: "fa-tractor",
    PPE: "fa-helmet-safety",
    MEASURING: "fa-ruler-combined",
    OTHER: "fa-toolbox",
  };

  function iconForToolIcon(value) {
    const choice = TOOL_ICON_CHOICES.find((candidate) => candidate.value === value);
    return choice ? choice.icon : null;
  }

  function labelForToolIcon(value) {
    const choice = TOOL_ICON_CHOICES.find((candidate) => candidate.value === value);
    return choice ? choice.label : "";
  }

  function iconForToolCategory(category) {
    return TOOL_CATEGORY_ICONS[category] || TOOL_CATEGORY_ICONS.OTHER;
  }

  /** A tool's glyph: the one it was given, else the one its category implies. */
  function iconForTool(tool) {
    if (!tool) return TOOL_CATEGORY_ICONS.OTHER;
    return iconForToolIcon(tool.icon) || iconForToolCategory(tool.category);
  }

  function iconForToolStatus(status) {
    return TOOL_STATUS_ICONS[status] || "fa-circle-question";
  }

  function iconForServiceStatus(status) {
    return SERVICE_STATUS_ICONS[status] || "fa-circle-question";
  }

  function labelForToolStatus(status) {
    return TOOL_STATUS_LABELS[status] || status || "—";
  }

  function labelForServiceStatus(status) {
    return SERVICE_STATUS_LABELS[status] || status || "—";
  }

  function labelForToolCategory(category) {
    return TOOL_CATEGORY_LABELS[category] || category || "—";
  }

  function labelForReturnCondition(condition) {
    // Null is a real value: an OPEN issuance has no condition yet, which is different
    // from having come back in an unknown state.
    if (condition === null || condition === undefined) return "still out";
    return RETURN_CONDITION_LABELS[condition] || condition;
  }

  function labelForCheckFailure(reason) {
    return CERTIFICATION_CHECK_FAILURE_LABELS[reason] || "the check could not be completed";
  }

  function labelForToolUnavailable(reason) {
    return TOOL_UNAVAILABLE_LABELS[reason] || "it is not available";
  }

  function labelForCertificationStatus(status) {
    // Null is a real value here: it means the member has never been certified, which
    // is different from any of the four states a certificate can be in.
    if (status === null || status === undefined) return "Not certified";
    return CERTIFICATION_STATUS_LABELS[status] || status;
  }

  function labelForEnrollmentStatus(status) {
    return ENROLLMENT_STATUS_LABELS[status] || status || "—";
  }

  function labelForGapReason(reason) {
    return GAP_REASON_LABELS[reason] || reason || "not held";
  }

  /**
   * How to present the AgriAcademy link's state.
   *
   * Returns `null` when there is nothing worth saying, which is the case that
   * matters most: a farm with no course linked to an exam must not be nagged about
   * a service it has never asked for. Everything else gets a tone and the server's
   * own sentence — the wording lives on the server so the same explanation reaches
   * every surface, and this decides only how loudly to say it.
   *
   * Deliberately PURE, so the whole matrix is unit-tested without a DOM.
   *
   * @param {object|null} link - the `academyLink` field
   * @returns {{tone: string, message: string, state: string}|null}
   */
  function academyNotice(link) {
    if (!link || !link.state) return null;

    // Nothing is linked: silence is the correct output. Saying "no course
    // references an exam" to somebody who does not use AgriAcademy is noise, and
    // noise is how a panel's warnings stop being read.
    if (link.state === "NOT_LINKED") return null;
    // Working. A green banner for "a thing you may not care about is fine" is the
    // same noise from the other direction.
    if (link.state === "READY") return null;
    // Switched off AND nothing linked was handled above; switched off WITH linked
    // courses is worth a quiet note, because those courses show a blank column.
    if (link.state === "DISABLED" && !link.linkedCourses) return null;

    return {
      state: link.state,
      // `info` for a deliberate configuration, `warning` for something that broke.
      // An operator who switched the flag off does not need a warning triangle.
      tone: link.state === "DISABLED" ? "info" : "warning",
      message: link.message || "The AgriAcademy link is unavailable. Crew Office training records are unaffected.",
    };
  }

  /** The Monday of the week containing a date, as YYYY-MM-DD. Mirrors the server. */
  function mondayOf(dateString) {
    const date = new Date(dateString + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) return dateString;
    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return date.toISOString().slice(0, 10);
  }

  /** Today, in the same YYYY-MM-DD form the graph expects. */
  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  // The other two enums the hire and edit forms need. Kept beside ROLE_LABELS so
  // there is ONE place where an enum value gets a human label — a test asserts the
  // roster's filter options match this map, so the two cannot drift apart.
  const EMPLOYMENT_TYPE_LABELS = {
    PERMANENT: "Permanent",
    FIXED_TERM: "Fixed term",
    SEASONAL: "Seasonal",
    CONTRACTOR: "Contractor",
  };

  function labelForEmploymentType(type) {
    return EMPLOYMENT_TYPE_LABELS[type] || type || "—";
  }

  /**
   * Build <option> markup from a label map.
   *
   * Generated rather than hand-written in each form, because a role added to the
   * schema must appear everywhere a role can be chosen — and three hand-kept
   * copies is exactly how one of them ends up missing.
   */
  function optionsHtml(labels, options = {}) {
    const selected = options.selected;
    const placeholder = options.placeholder;
    const head = placeholder ? '<option value="">' + escapeHtml(placeholder) + "</option>" : "";
    return (
      head +
      Object.keys(labels)
        .map(function (value) {
          const isSelected = value === selected ? " selected" : "";
          return '<option value="' + escapeHtml(value) + '"' + isSelected + ">" + escapeHtml(labels[value]) + "</option>";
        })
        .join("")
    );
  }

  function labelForRole(role) {
    return ROLE_LABELS[role] || role || "—";
  }
  function labelForStatus(status) {
    return STATUS_LABELS[status] || status || "—";
  }

  return {
    ENDPOINT,
    OPERATIONS,
    ERROR_MESSAGES,
    ROLE_LABELS,
    STATUS_LABELS,
    run,
    fetchSdl,
    requireSession,
    hasSessionHint,
    redirectToLogin,
    describeErrors,
    describeUnion,
    MODULE_TABS,
    moduleTabs,
    renderModuleTabs,
    validateInput,
    applyFieldErrors,
    clearFieldErrors,
    readValue,
    numberOrNull,
    escapeHtml,
    setStatus,
    toast,
    staffIdFromUrl,
    EMPLOYMENT_TYPE_LABELS,
    optionsHtml,
    labelForRole,
    labelForEmploymentType,
    labelForStatus,
    labelForShiftStatus,
    SHIFT_STATUS_LABELS,
    LEAVE_TYPE_LABELS,
    LEAVE_STATUS_LABELS,
    labelForLeaveType,
    labelForLeaveStatus,
    CERTIFICATION_STATUS_LABELS,
    ENROLLMENT_STATUS_LABELS,
    GAP_REASON_LABELS,
    labelForCertificationStatus,
    labelForEnrollmentStatus,
    labelForGapReason,
    TOOL_STATUS_LABELS,
    SERVICE_STATUS_LABELS,
    TOOL_STATUS_ICONS,
    SERVICE_STATUS_ICONS,
    TOOL_ICON_CHOICES,
    TOOL_CATEGORY_ICONS,
    iconForToolStatus,
    iconForServiceStatus,
    iconForTool,
    iconForToolIcon,
    iconForToolCategory,
    labelForToolIcon,
    TOOL_CATEGORY_LABELS,
    RETURN_CONDITION_LABELS,
    TOOL_UNAVAILABLE_LABELS,
    CERTIFICATION_CHECK_FAILURE_LABELS,
    labelForToolStatus,
    labelForServiceStatus,
    labelForToolCategory,
    labelForReturnCondition,
    labelForCheckFailure,
    labelForToolUnavailable,
    academyNotice,
    mondayOf,
    todayIso,
  };
});
