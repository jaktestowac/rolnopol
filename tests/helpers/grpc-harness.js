/**
 * Shared test harness for the gRPC services.
 *
 * Both service suites (greenhouse, tasklab) boot a real server on an ephemeral
 * port, dial it with a real client, and drive unary + streaming calls. This
 * module factors out that boilerplate so each suite only declares *what* it
 * exercises, not *how* to promisify a callback API.
 *
 * Nothing here is service-specific: callers pass the proto package they loaded
 * and the client constructor they want.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

/**
 * Load a proto and return the named package namespace.
 * @returns the package object (e.g. `.tasklab` / `.greenhouse`) with service ctors.
 */
function loadPackage(protoPath, options, packageName) {
  const def = grpc.loadPackageDefinition(protoLoader.loadSync(protoPath, options));
  return def[packageName];
}

/** Build a gRPC Metadata from a plain object (skips null/undefined values). */
function metadata(pairs = {}) {
  const md = new grpc.Metadata();
  for (const [key, value] of Object.entries(pairs)) {
    if (value != null && value !== "") md.set(key, String(value));
  }
  return md;
}

/**
 * Promisified unary call.
 * @param {object} client      a connected gRPC client
 * @param {string} method      RPC method name (e.g. "CreateTask")
 * @param {object} request     request message
 * @param {object} [opts]
 * @param {object} [opts.metadata]   plain object → gRPC metadata
 * @param {number} [opts.deadlineMs] per-call deadline (default 3000)
 */
function callUnary(client, method, request = {}, { metadata: md, deadlineMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + deadlineMs);
    client[method](request, metadata(md), { deadline }, (err, reply) => (err ? reject(err) : resolve(reply)));
  });
}

/**
 * Collect frames from a server-streaming call until `predicate(frames, frame)`
 * is truthy (then cancel) or the stream ends. Resolves with the frames; a clean
 * CANCELLED is treated as success.
 */
function collectStream(stream, predicate) {
  return new Promise((resolve, reject) => {
    const frames = [];
    stream.on("data", (frame) => {
      frames.push(frame);
      if (predicate && predicate(frames, frame)) stream.cancel();
    });
    stream.on("error", (err) => (err.code === grpc.status.CANCELLED ? resolve(frames) : reject(err)));
    stream.on("end", () => resolve(frames));
  });
}

/**
 * Reserve a free TCP port by binding a throwaway gRPC server on :0, reading the
 * assigned port, then shutting it down. Used when a client target must be known
 * *before* the service under test is started (resilience tests).
 */
async function reservePort() {
  const server = new grpc.Server();
  const port = await new Promise((resolve, reject) =>
    server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? reject(err) : resolve(p),
    ),
  );
  await new Promise((resolve) => server.tryShutdown(() => resolve()));
  return port;
}

module.exports = { grpc, loadPackage, metadata, callUnary, collectStream, reservePort };
