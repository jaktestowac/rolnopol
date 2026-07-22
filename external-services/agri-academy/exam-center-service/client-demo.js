/**
 * AgriAcademy end-to-end taker demo — drives the full free-exam happy path over the
 * wire, exactly as a taker would. Run the ecosystem first (npm run academy), then:
 *   npm run academy:demo
 *
 * Walks: (setup) author a throwaway free exam with known answers via the authoring
 * gateway → publish; (take) list catalog → create session → start → answer → submit
 * → pass → mint certificate → verify. Owning the exam lets the demo answer correctly
 * so it reliably shows a PASS and a real certificate number.
 *
 * Money (paid exams) lives only in the Rolnopol bridge, so this standalone demo uses
 * a FREE exam — no financial service involved.
 */
const EXAM_CENTER = process.env.AGRI_ACADEMY_TARGET || `http://localhost:${process.env.EXAM_CENTER_PORT || 4350}`;
const AUTHORING = process.env.AGRI_ACADEMY_AUTHORING_TARGET || `http://localhost:${process.env.AUTHORING_PORT || 4352}`;
const USER = process.env.DEMO_TAKER || "demo-taker";

async function call(base, method, path, body) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-academy-user": USER },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`\n✗ Could not reach ${base}${path} — is the ecosystem running? (npm run academy)\n`);
    throw err;
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}
const authoring = (m, p, b) => call(AUTHORING, m, p, b);
const examCenter = (m, p, b) => call(EXAM_CENTER, m, p, b);

// Known answer key for the throwaway exam we author below.
const KEYS = { "demo-take-q1": ["a"], "demo-take-q2": ["a", "c"] };

async function setupExam() {
  await authoring("POST", "/v1/units", { name: "Demo Take Unit", description: "throwaway unit for academy:demo" });
  const exam = await authoring("POST", "/v1/exams", {
    title: "Demo Field Safety",
    description: "A throwaway free exam used by academy:demo.",
    durationSec: 600,
    accessWindowDays: 7,
    passPct: 60,
    attemptsAllowed: 5,
    certValidMonths: 24,
    questionCount: 2,
    pricing: { mode: "free" },
  });
  const examId = exam.json.id;
  await authoring("POST", `/v1/exams/${examId}/questions`, {
    id: "demo-take-q1",
    type: "single",
    text: "The safest way to approach farm machinery is to:",
    options: [
      { id: "a", text: "Ensure it is switched off and isolated first" },
      { id: "b", text: "Reach in while it is running" },
      { id: "c", text: "Remove the guards for a better view" },
      { id: "d", text: "Ignore the operator's manual" },
    ],
    correct: ["a"],
  });
  await authoring("POST", `/v1/exams/${examId}/questions`, {
    id: "demo-take-q2",
    type: "multi",
    text: "Which are good general farm-safety habits? (select all that apply)",
    options: [
      { id: "a", text: "Wear appropriate PPE" },
      { id: "b", text: "Skip briefings to save time" },
      { id: "c", text: "Keep bystanders clear of the work area" },
      { id: "d", text: "Leave spills unmarked" },
    ],
    correct: ["a", "c"],
  });
  await authoring("POST", `/v1/exams/${examId}/publish`);
  return examId;
}

async function main() {
  console.log(`\n== AgriAcademy taker demo (taker = ${USER}) ==`);
  console.log(`   exam-center ${EXAM_CENTER} · authoring ${AUTHORING}\n`);

  const health = await examCenter("GET", "/health/all");
  console.log("health/all:", health.status, JSON.stringify(health.json.services?.map((s) => `${s.name}:${s.status}`)));

  console.log("\n-- setup: authoring a throwaway free exam --");
  const examId = await setupExam();
  console.log(`published exam: ${examId}`);

  const catalog = await examCenter("GET", "/v1/exams");
  console.log("catalog:", catalog.status, `${catalog.json.exams?.length || 0} published exam(s)`);

  console.log("\n-- take --");
  const created = await examCenter("POST", "/v1/sessions", { examId });
  console.log("enroll:", created.status, `→ state: ${created.json.state}`);
  const sid = created.json.sessionId;

  const started = await examCenter("POST", `/v1/sessions/${sid}/start`);
  console.log(
    "start:",
    started.status,
    `→ ${started.json.questions?.length || 0} questions, expiresAt set: ${started.json.expiresAt != null}`,
  );

  for (const q of started.json.questions || []) {
    const answer = KEYS[q.id] || [q.options?.[0]?.id];
    await examCenter("PUT", `/v1/sessions/${sid}/answers/${encodeURIComponent(q.id)}`, { answer });
  }
  console.log("answers saved for", (started.json.questions || []).length, "questions");

  const submitted = await examCenter("POST", `/v1/sessions/${sid}/submit`);
  const result = submitted.json.result || {};
  console.log("submit:", submitted.status, `→ ${result.scorePct}% · ${result.passed ? "PASSED ✓" : "not passed"}`);
  if (result.certNo) {
    console.log("certificate:", result.certNo);
    const verify = await examCenter("GET", `/v1/verify/${encodeURIComponent(result.certNo)}`);
    console.log("verify:", verify.status, `→ status: ${verify.json.status}`);
  }
  console.log("\ndone.\n");
}

main().catch((e) => {
  console.error("demo failed:", e.message);
  process.exit(1);
});
