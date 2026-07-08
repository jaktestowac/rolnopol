/**
 * FarmStay end-to-end demo — talks to the gateway over REST like Rolnopol would.
 * Run the ecosystem first (npm run farmstay), then:  npm run farmstay:demo
 *
 * Walks: search → book (hold) → confirm → list. Uses a demo guest identity.
 */
const BASE = process.env.FARM_STAY_TARGET || `http://localhost:${process.env.STAY_GATEWAY_PORT || 4310}`;
const GUEST = process.env.DEMO_GUEST || "demo-guest";

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-stay-user": GUEST },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function futureDate(daysFromNow) {
  const t = Date.now() + daysFromNow * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

async function main() {
  const from = futureDate(30);
  const to = futureDate(33);
  console.log(`\n== FarmStay demo (guest=${GUEST}, ${from} → ${to}) ==\n`);

  const health = await call("GET", "/health/all");
  console.log("health/all:", health.status, JSON.stringify(health.json.services?.map((s) => `${s.name}:${s.status}`)));

  const search = await call("GET", `/v1/search?from=${from}&to=${to}&guests=2`);
  console.log("\nsearch:", search.status, `${search.json.results?.length || 0} results`);
  const pick = search.json.results?.[0];
  if (!pick) return console.log("no properties available — is inventory running?");
  console.log(`  picked: ${pick.name} (${pick.id}) — quote ${pick.quote ? pick.quote.total + " " + pick.quote.currency : "n/a"}`);

  const book = await call("POST", "/v1/bookings", { propertyId: pick.id, from, to, guests: 2 });
  console.log("\nbook (hold):", book.status, JSON.stringify(book.json));
  const bookingId = book.json.bookingId;
  if (!bookingId) return;

  const confirm = await call("POST", `/v1/bookings/${bookingId}/confirm`, {});
  console.log("\nconfirm:", confirm.status, JSON.stringify(confirm.json.booking?.state || confirm.json));

  const list = await call("GET", "/v1/bookings");
  console.log("\nmy bookings:", list.status, JSON.stringify(list.json.bookings?.map((b) => `${b.id}:${b.state}`)));
  console.log("\ndone.\n");
}

main().catch((e) => {
  console.error("demo failed:", e.message);
  process.exit(1);
});
