/**
 * AgriAcademy authoring-plane demo — talks to the authoring gateway over REST like
 * Rolnopol's admin bridge would (identity via x-academy-user). Run the ecosystem
 * first (npm run academy), then:  npm run academy:demo:author
 *
 * Walks: register a certification unit → create a draft exam → author two typed
 * questions (single + multi) → publish. Prints the published exam id so you can
 * take it (npm run academy:demo, or the /agri-academy.html page).
 */
const BASE = process.env.AGRI_ACADEMY_AUTHORING_TARGET || `http://localhost:${process.env.AUTHORING_PORT || 4352}`;
const UNIT_OWNER = process.env.DEMO_AUTHOR || "demo-author";

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-academy-user": UNIT_OWNER },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`\n✗ Could not reach the authoring service at ${BASE} — is it running? (npm run academy)\n`);
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

async function main() {
  console.log(`\n== AgriAcademy authoring demo (unit owner = ${UNIT_OWNER}, ${BASE}) ==\n`);

  const unit = await call("POST", "/v1/units", {
    name: "Demo Orchard Safety Board",
    description: "A demo certification unit created by academy:demo:author.",
    contactEmail: "demo-author@agri-academy.example",
  });
  console.log("register unit:", unit.status, `→ ${unit.json?.unitId} (${unit.json?.name})`);

  const exam = await call("POST", "/v1/exams", {
    title: "Orchard Ladder Safety",
    description: "Safe use of orchard ladders and picking platforms.",
    durationSec: 600,
    accessWindowDays: 7,
    passPct: 60,
    attemptsAllowed: 3,
    certValidMonths: 24,
    questionCount: 2,
    pricing: { mode: "free" },
  });
  if (exam.status !== 201) return console.log("create exam failed:", exam.status, JSON.stringify(exam.json));
  const examId = exam.json.id;
  console.log("create exam:", exam.status, `→ ${examId} (draft)`);

  const q1 = await call("POST", `/v1/exams/${examId}/questions`, {
    type: "single",
    text: "Before climbing an orchard ladder you should:",
    options: [
      { id: "a", text: "Check it is on firm, level ground and undamaged" },
      { id: "b", text: "Climb quickly before it settles" },
      { id: "c", text: "Rest the top rung against thin branches" },
      { id: "d", text: "Carry all your tools in both hands" },
    ],
    correct: ["a"],
  });
  const q2 = await call("POST", `/v1/exams/${examId}/questions`, {
    type: "multi",
    text: "Which are safe ladder practices? (select all that apply)",
    options: [
      { id: "a", text: "Maintain three points of contact" },
      { id: "b", text: "Over-reach to the side to save moving it" },
      { id: "c", text: "Keep your belt buckle within the stiles" },
      { id: "d", text: "Have a spotter steady the base on soft ground" },
    ],
    correct: ["a", "c", "d"],
  });
  console.log("author questions:", `q1=${q1.status}`, `q2=${q2.status}`);

  const pub = await call("POST", `/v1/exams/${examId}/publish`);
  console.log("publish:", pub.status, `→ status: ${pub.json?.status}`);

  console.log(`\n✓ Published exam "${exam.json.title}" (${examId}).`);
  console.log(`  Take it:  npm run academy:demo   ·  or open /agri-academy.html?exam=${examId}\n`);
}

main().catch((e) => {
  console.error("demo failed:", e.message);
  process.exit(1);
});
