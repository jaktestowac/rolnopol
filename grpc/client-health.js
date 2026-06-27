/**
 * Greenhouse gRPC CLI client — for demos & manual testing.
 *
 * Run the service first (npm run greenhouse), then:
 *   npm run greenhouse:demo
 *
 * P0: calls Health.Check and prints the reply. Later phases will exercise the
 * unary, server-streaming, client-streaming, and bidi RPCs.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, CLIENT_TARGET } = require("./greenhouse-config");

function loadProto() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS);
  return grpc.loadPackageDefinition(packageDefinition).greenhouse;
}

function main() {
  const proto = loadProto();
  const health = new proto.Health(CLIENT_TARGET, grpc.credentials.createInsecure());

  // Give the call a deadline so we fail fast if the service isn't running.
  const deadline = new Date(Date.now() + 3000);

  console.log(`[demo] dialing greenhouse service at ${CLIENT_TARGET} ...`);
  health.Check({}, { deadline }, (err, reply) => {
    if (err) {
      console.error(`[demo] Health.Check failed: ${err.code} ${err.details || err.message}`);
      console.error("[demo] is the service running? start it with: npm run greenhouse");
      process.exit(1);
    }
    console.log("[demo] Health.Check reply:");
    console.log(JSON.stringify(reply, null, 2));
    process.exit(0);
  });
}

main();
