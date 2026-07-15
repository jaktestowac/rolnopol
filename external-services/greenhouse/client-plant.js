/**
 * Greenhouse gRPC CLI client — "Grow-a-Plant" unary demo (P1).
 *
 * Run the service first (npm run greenhouse), then:
 *   npm run greenhouse:plant
 *
 * Exercises ListCrops → ListGreenhouses → Plant → Water → ListGreenhouses,
 * all unary calls over the real wire to the standalone service.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, CLIENT_TARGET } = require("./greenhouse-config");

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS)).greenhouse;
}

function meta() {
  const md = new grpc.Metadata();
  md.set("gh-identity", "demo-cli-demo");
  md.set("gh-identity-kind", "demo");
  return md;
}

function call(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, meta(), { deadline: new Date(Date.now() + 3000) }, (err, reply) => (err ? reject(err) : resolve(reply)));
  });
}

function renderGreenhouses(snap) {
  for (const g of snap.greenhouses) {
    if (g.occupied) {
      const p = g.plant;
      console.log(`  slot ${g.slot}: ${p.emoji} ${p.crop_name} — ${p.growth}% (${p.stage}), water ${p.water}%`);
    } else {
      console.log(`  slot ${g.slot}: (empty)`);
    }
  }
  console.log(`  harvested: ${snap.harvested}`);
}

async function main() {
  const proto = loadProto();
  const client = new proto.GreenhouseControl(CLIENT_TARGET, grpc.credentials.createInsecure());
  console.log(`[plant] dialing greenhouse service at ${CLIENT_TARGET} ...\n`);

  const { crops } = await call(client, "ListCrops", {});
  console.log(`ListCrops → ${crops.map((c) => `${c.emoji} ${c.name}`).join(", ")}\n`);

  console.log("ListGreenhouses (before):");
  renderGreenhouses(await call(client, "ListGreenhouses", {}));

  console.log(`\nPlant("tomato") in slot 1 ...`);
  await call(client, "Plant", { slot: 1, crop: "tomato" });
  console.log(`Water slot 1 ...`);
  await call(client, "Water", { slot: 1 });

  console.log("\nListGreenhouses (after):");
  renderGreenhouses(await call(client, "ListGreenhouses", {}));

  process.exit(0);
}

main().catch((err) => {
  console.error(`[plant] failed: ${grpc.status[err.code] || ""} ${err.details || err.message}`);
  console.error("[plant] is the service running? start it with: npm run greenhouse");
  process.exit(1);
});
