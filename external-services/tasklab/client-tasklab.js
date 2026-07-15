/**
 * TaskLab gRPC demo client (CLI).
 *
 * Exercises the standalone TaskLab service end-to-end without the app:
 *   Health.Check → ListStatuses → CreateTask → ListTasks → SetStatus → Archive
 *
 * Run with:  npm run tasklab:demo   (after `npm run tasklab` in another shell)
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { PROTO_PATH, PROTO_LOADER_OPTIONS, CLIENT_TARGET } = require("./tasklab-config");

const USER_ID = process.env.TASKLAB_DEMO_USER || "demo-cli-user";

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS)).tasklab;
}

function meta() {
  const md = new grpc.Metadata();
  md.set("tl-user-id", USER_ID);
  return md;
}

function call(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, meta(), { deadline: new Date(Date.now() + 3000) }, (err, reply) =>
      err ? reject(err) : resolve(reply),
    );
  });
}

async function main() {
  const proto = loadProto();
  const health = new proto.Health(CLIENT_TARGET, grpc.credentials.createInsecure());
  const tasks = new proto.TaskControl(CLIENT_TARGET, grpc.credentials.createInsecure());

  const log = (label, value) => console.log(`[tasklab-cli] ${label}:\n${JSON.stringify(value, null, 2)}`);

  try {
    log("Health.Check", await new Promise((res, rej) =>
      health.Check({}, { deadline: new Date(Date.now() + 3000) }, (e, r) => (e ? rej(e) : res(r))),
    ));
    log("ListStatuses", await call(tasks, "ListStatuses", {}));
    const created = await call(tasks, "CreateTask", { title: "Try TaskLab", content: "Created from the CLI demo." });
    log("CreateTask", created);
    log("SetStatus → in_progress", await call(tasks, "SetStatus", { id: created.id, status: "in_progress" }));
    log("ListTasks", await call(tasks, "ListTasks", { status: "", query: "", include_archived: false }));
    log("Archive", await call(tasks, "Archive", { id: created.id }));
    process.exit(0);
  } catch (err) {
    console.error(`[tasklab-cli] failed: ${err.code} ${err.details || err.message}`);
    process.exit(1);
  }
}

main();
