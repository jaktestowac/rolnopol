/**
 * Read-only view of AgriAcademy, for the training pillar's optional link (§8.4).
 *
 * **The whole contract of this file is that it never fails a query.** Every method
 * resolves to data or to `null`, and the reasons it can resolve to `null` are all
 * ordinary: the `agriAcademyEnabled` flag is off, the academy's standalone services
 * are not running, the account holds no certificate for that exam, or the exam id
 * is nonsense. A crew query that asked for a training matrix must render the matrix
 * whether or not a separate ecosystem happens to be up.
 *
 * That is why there is no `throw` anywhere below and why the client's own failure
 * mode suits us: `modules/agri-academy/exam-center-client` already turns a network
 * error into `{ status: 503, body: { error: "AGRI_ACADEMY_OFFLINE" } }` rather than
 * rejecting. Anything that is not a 200 is simply "no answer", and no answer is
 * `null`.
 *
 * As with `staff-gateway.js` and `assignment-reader.js`, read-only is structural
 * rather than promised: there is no write method here to call, and the academy's
 * mutating client methods (`revokeCertificate`, `shareCertificate`, `createSession`)
 * are never imported.
 *
 * One honesty note about the semantics. AgriAcademy knows Rolnopol ACCOUNTS, not
 * farm staff — it has no idea the crew exists. So the certificate surfaced here is
 * the one the OWNER's academy account holds for the exam a course references. It is
 * a cross-module link and a demonstration that the link degrades, not a claim that
 * a particular crew member sat that exam. `crew-training.json` remains the record
 * of who is qualified.
 */
const { logInfo } = require("../../helpers/logger-api");

/**
 * @param {object} [options]
 * @param {Function} [options.onStoreRead] - counted like any other read, so the
 *   cost of the link shows up in `extensions.storeReads` rather than hiding
 * @param {object} [options.client] - override for tests: an offline academy, a
 *   flaky one, or one that answers. Every degradation path needs to be reachable
 *   without starting five services.
 * @param {Function} [options.isEnabled] - override for the flag lookup
 */
function createAcademyGateway({ onStoreRead, client, isEnabled } = {}) {
  // Required lazily so the crew module never drags the academy client (and its
  // env-var-driven base URL) into a process that has the academy switched off.
  const resolveClient = () => {
    if (client) return client;
    try {
      // eslint-disable-next-line global-require
      return require("../../modules/agri-academy").examCenter;
    } catch (error) {
      logInfo("[crew] AgriAcademy client unavailable — the training link will report null", { detail: error.message });
      return null;
    }
  };

  const flagEnabled =
    isEnabled ||
    (async () => {
      try {
        // eslint-disable-next-line global-require
        const featureFlags = require("../feature-flags.service");
        const data = await featureFlags.getFeatureFlags();
        return data?.flags?.agriAcademyEnabled === true;
      } catch {
        // A flag store that cannot be read is treated as "off". The link is a
        // nicety; refusing to answer at all would be worse than answering null.
        return false;
      }
    });

  /**
   * One flag read per request, whatever asks — and it CANNOT reject.
   *
   * The catch is here rather than only inside the default lookup, so an injected
   * `isEnabled` gets the same guarantee. Without it this file's whole promise — that
   * it never fails a query — depended on whoever supplied the override remembering
   * to catch, which is not a promise. A flag store that cannot be read is treated as
   * "off": the link is a nicety, and refusing to answer at all would be worse than
   * answering null.
   */
  let enabledPromise = null;
  const enabled = () =>
    (enabledPromise =
      enabledPromise ||
      Promise.resolve()
        .then(flagEnabled)
        .catch((error) => {
          logInfo("[crew] AgriAcademy flag lookup failed — treating the link as off", { detail: error.message });
          return false;
        }));

  /** Certificates the account holds, indexed by exam id. Null when unavailable. */
  let certificatesPromise = null;

  /**
   * Why the link is not answering, recorded as the load runs.
   *
   * `certificateForExam` still collapses every one of these to `null` — a client
   * rendering a certificate has nothing useful to do with the difference. But a
   * PAGE does: "AgriAcademy is switched off" and "AgriAcademy is not responding"
   * need different words, and "your training records are fine either way" needs
   * saying in both cases. So the reason is kept here and published separately
   * through `status()`.
   */
  let state = null;

  async function loadCertificates(userId) {
    if (!(await enabled())) {
      state = "DISABLED";
      return null;
    }

    const academy = resolveClient();
    if (!academy || typeof academy.listCertificates !== "function") {
      state = "OFFLINE";
      return null;
    }

    if (typeof onStoreRead === "function") onStoreRead("agriAcademy");

    let result;
    try {
      result = await academy.listCertificates(userId);
    } catch (error) {
      // Belt and braces. The client is documented not to reject, but this file's
      // promise is that it NEVER fails a query, and a promise that depends on
      // another module keeping its documentation accurate is not a promise.
      logInfo("[crew] AgriAcademy certificate lookup failed — reporting null", { detail: error.message });
      state = "OFFLINE";
      return null;
    }

    if (!result || result.status !== 200) {
      // No usable answer. `OFFLINE` covers both "nothing came back" and "the
      // academy refused", because from a farm office's point of view those are the
      // same event: the link is down and there is nothing to do about it here.
      state = "OFFLINE";
      return null;
    }

    // The exam center returns either a bare array or `{ certificates: [...] }`
    // depending on the route version. Tolerating both is cheaper than coupling the
    // crew module to which one is deployed.
    const rows = Array.isArray(result.body) ? result.body : Array.isArray(result.body?.certificates) ? result.body.certificates : null;
    if (!rows) {
      // It answered, and the answer made no sense. Distinct from OFFLINE on
      // purpose: this one is worth someone looking at, and restarting the service
      // will not fix it.
      state = "UNREADABLE";
      return null;
    }
    state = "READY";

    const byExamId = new Map();
    for (const row of rows) {
      const examId = row?.examId ?? row?.exam?.id ?? null;
      if (examId === null || examId === undefined) continue;
      // First one wins: the exam center returns newest first.
      if (!byExamId.has(String(examId))) byExamId.set(String(examId), row);
    }
    return byExamId;
  }

  return {
    /** Whether the link is switched on at all. Never throws. */
    isEnabled: () => enabled(),

    /**
     * What state the link is in, and a sentence a page can show verbatim.
     *
     * The messages all say the same second thing on purpose — **Crew Office
     * training records are unaffected** — because that is the question somebody
     * actually has when a panel says a link is down. Without it, "AgriAcademy is
     * not responding" on a training page reads as "your certificates may be wrong",
     * which is both alarming and false: `crew-training.json` is the record, and the
     * academy is a nicety layered on top of it.
     *
     * @param {object} [options]
     * @param {number|string} [options.userId] - whose certificates to ask for
     * @param {boolean} [options.probe=true] - false skips the network call. The
     *   caller passes false when no course references an academy exam, so a farm
     *   that never uses the link does not pay for a request to discover that.
     */
    async status({ userId, probe = true } = {}) {
      if (!(await enabled())) {
        return {
          state: "DISABLED",
          available: false,
          message:
            "AgriAcademy is switched off, so exam links are not shown. Crew Office training records are unaffected — " +
            "turn on the agriAcademyEnabled feature flag to link them.",
        };
      }

      if (!probe) {
        return {
          state: "NOT_LINKED",
          available: false,
          message: "No course references an AgriAcademy exam yet. Add an exam id to a course to link its certificates.",
        };
      }

      // Shares the ONE fetch with `certificateForExam`, so a page that asks for
      // both the banner and the per-course links dials the academy once.
      certificatesPromise = certificatesPromise || loadCertificates(userId);
      await certificatesPromise;

      switch (state) {
        case "READY":
          return { state: "READY", available: true, message: "AgriAcademy is linked and answering." };
        case "UNREADABLE":
          return {
            state: "UNREADABLE",
            available: false,
            message:
              "AgriAcademy answered with something this app could not read, so exam links are unavailable. " +
              "Crew Office training records are unaffected.",
          };
        default:
          return {
            state: "OFFLINE",
            available: false,
            message:
              "AgriAcademy is not responding, so exam links are unavailable. Crew Office training records are unaffected — " +
              "start the academy services with `npm run academy` if you need the link.",
          };
      }
    },

    /**
     * The account's academy certificate for an exam, or null.
     *
     * Null still covers every failure — flag off, academy down, unreadable
     * response, no such certificate — and a caller of THIS method cannot tell them
     * apart. That remains deliberate: a cell in a training matrix has nothing
     * useful to do with the difference, and branching five ways on it in every
     * course row would be five chances to get it wrong.
     *
     * The reason is not lost, though: `status()` publishes it once, for the page
     * banner. Per-course data stays simple; the explanation is asked for
     * explicitly, in one place, by whoever is going to render a sentence about it.
     */
    async certificateForExam(userId, examId) {
      if (examId === null || examId === undefined || examId === "") return null;
      certificatesPromise = certificatesPromise || loadCertificates(userId);
      const byExamId = await certificatesPromise;
      if (!byExamId) return null;

      const row = byExamId.get(String(examId));
      if (!row) return null;

      // Normalised to the small shape the crew graph publishes, so a change to the
      // academy's payload cannot silently reshape the crew schema.
      return {
        certificateNo: row.certificateNo ?? row.certNo ?? row.id ?? null,
        examId: String(examId),
        examTitle: row.examTitle ?? row.exam?.title ?? null,
        issuedOn: typeof row.issuedAt === "string" ? row.issuedAt.slice(0, 10) : (row.issuedOn ?? null),
        score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
      };
    },
  };
}

module.exports = { createAcademyGateway };
