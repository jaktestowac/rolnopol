import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const grpc = require("@grpc/grpc-js");
const { probeAll, grpcHealthAdapter, SERVICES } = require("../../services/service-monitor.service");
const featureFlagsService = require("../../services/feature-flags.service");

// No transport is mocked here, and none needs to be. `grpcHealthAdapter` takes its
// client as an argument, so a fake one is enough to drive every branch; `probeAll`
// reads `SERVICES`, whose entries are plain mutable objects the module exports "for
// tests", so a stub probe can be swapped in and put back.
//
// The one thing this file cannot reach is `farmStayAggregateAdapter`: it is not
// exported and it closes over the real gateway client at module load, so its
// overall→status mapping (SERVING/DEGRADED/DOWN) stays covered only by
// tests/services-monitor.test.js over HTTP.

/** A gRPC error as the runtime produces it: a numeric code plus optional details. */
const grpcError = (code, { details, message = "boom" } = {}) => {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
};

const adapterFor = (health, extra = {}) => grpcHealthAdapter({ client: { health }, target: "localhost:50051", ...extra });

/** Remember every registered probe so a test can put the registry back. */
function captureProbes() {
  const originals = SERVICES.map((service) => service.probe);
  return () =>
    SERVICES.forEach((service, index) => {
      service.probe = originals[index];
    });
}

/** Swap every registered probe for one that resolves to `makeResult(key)`. */
function stubAllProbes(makeResult) {
  const restore = captureProbes();
  SERVICES.forEach((service) => {
    service.probe = () => Promise.resolve(makeResult(service.key));
  });
  return restore;
}

const onlineResult = (key) => ({ status: "online", target: `${key}:1`, health: { status: "SERVING" }, error: null, hint: null });

let restoreProbes = null;

beforeEach(() => {
  vi.restoreAllMocks();
  restoreProbes = null;
});

afterEach(() => {
  if (restoreProbes) restoreProbes();
  vi.restoreAllMocks();
});

describe("service-monitor — registry invariants", () => {
  it("registers the three monitored services under unique keys", () => {
    expect(SERVICES.map((service) => service.key).sort()).toEqual(["farm-stay", "greenhouse", "tasklab"]);
    expect(new Set(SERVICES.map((service) => service.key)).size).toBe(SERVICES.length);
  });

  it("gives every entry the display metadata the dashboard renders and a probe to call", () => {
    for (const service of SERVICES) {
      expect(typeof service.name).toBe("string");
      expect(service.name.length).toBeGreaterThan(0);
      expect(typeof service.description).toBe("string");
      expect(typeof service.transport).toBe("string");
      expect(typeof service.flag).toBe("string");
      expect(typeof service.probe).toBe("function");
    }
  });

  it("names each service's feature flag exactly once, so two services cannot share a switch", () => {
    const flags = SERVICES.map((service) => service.flag);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it("describes the two gRPC leaves as gRPC and farm-stay as its REST gateway", () => {
    const byKey = Object.fromEntries(SERVICES.map((service) => [service.key, service]));
    expect(byKey.greenhouse.transport).toBe("gRPC");
    expect(byKey.tasklab.transport).toBe("gRPC");
    expect(byKey["farm-stay"].transport).toBe("REST gateway");
  });
});

describe("service-monitor — grpcHealthAdapter", () => {
  const target = "localhost:50051";

  it("reports online and passes the health payload through verbatim", async () => {
    const health = { status: "SERVING", plants: 3 };
    const probe = adapterFor(async () => health);

    await expect(probe()).resolves.toEqual({ status: "online", target, health, error: null, hint: null });
  });

  it("maps UNAVAILABLE to offline — the service is simply not running", async () => {
    const probe = adapterFor(
      async () => {
        throw grpcError(grpc.status.UNAVAILABLE, { details: "no connection established" });
      },
      { startCommand: "npm run greenhouse" },
    );

    await expect(probe()).resolves.toEqual({
      status: "offline",
      target,
      health: null,
      error: "no connection established",
      hint: "Start it with: npm run greenhouse",
    });
  });

  it("maps DEADLINE_EXCEEDED to offline too", async () => {
    const probe = adapterFor(async () => {
      throw grpcError(grpc.status.DEADLINE_EXCEEDED, { details: "Deadline exceeded" });
    });

    await expect(probe()).resolves.toMatchObject({ status: "offline", error: "Deadline exceeded" });
  });

  it("maps any other gRPC code to error — a reachable service answering badly is not 'down'", async () => {
    for (const code of [grpc.status.INTERNAL, grpc.status.PERMISSION_DENIED, grpc.status.UNIMPLEMENTED, grpc.status.NOT_FOUND]) {
      const probe = adapterFor(async () => {
        throw grpcError(code, { details: `code ${code}` });
      });
      await expect(probe()).resolves.toMatchObject({ status: "error", health: null });
    }
  });

  it("treats a plain Error with no gRPC code as an error, not offline", async () => {
    const probe = adapterFor(async () => {
      throw new Error("client not initialised");
    });

    await expect(probe()).resolves.toMatchObject({ status: "error", error: "client not initialised" });
  });

  it("prefers err.details, falls back to err.message, then to a placeholder", async () => {
    const withDetails = adapterFor(async () => {
      throw grpcError(grpc.status.UNAVAILABLE, { details: "detailed", message: "generic" });
    });
    expect((await withDetails()).error).toBe("detailed");

    const messageOnly = adapterFor(async () => {
      throw grpcError(grpc.status.UNAVAILABLE, { message: "generic" });
    });
    expect((await messageOnly()).error).toBe("generic");

    const nothingUseful = adapterFor(async () => {
      throw { code: grpc.status.UNAVAILABLE };
    });
    expect((await nothingUseful()).error).toBe("Unknown error");
  });

  it("omits the hint when no startCommand was registered", async () => {
    const probe = adapterFor(async () => {
      throw grpcError(grpc.status.UNAVAILABLE);
    });

    expect((await probe()).hint).toBeNull();
  });

  it("carries the hint on an unexpected error as well as on offline", async () => {
    const probe = adapterFor(
      async () => {
        throw grpcError(grpc.status.INTERNAL);
      },
      { startCommand: "npm run tasklab" },
    );

    await expect(probe()).resolves.toMatchObject({ status: "error", hint: "Start it with: npm run tasklab" });
  });

  it("never sets a hint on a healthy service", async () => {
    const probe = adapterFor(async () => ({ status: "SERVING" }), { startCommand: "npm run greenhouse" });

    expect((await probe()).hint).toBeNull();
  });

  it("never throws — a rejecting client resolves to a status instead", async () => {
    const probe = adapterFor(() => Promise.reject(grpcError(grpc.status.UNAVAILABLE)));

    await expect(probe()).resolves.toHaveProperty("status");
  });

  it("never throws — a client that throws synchronously also resolves", async () => {
    const probe = grpcHealthAdapter({
      client: {
        health: () => {
          throw new Error("sync explosion");
        },
      },
      target,
    });

    await expect(probe()).resolves.toMatchObject({ status: "error", error: "sync explosion" });
  });

  it("does not report online when the client is missing health() entirely", async () => {
    const probe = grpcHealthAdapter({ client: {}, target });

    await expect(probe()).resolves.toMatchObject({ status: "error", health: null });
  });

  it("echoes back the target it was configured with, whatever happens", async () => {
    const configured = "greenhouse.internal:50055";
    const online = grpcHealthAdapter({ client: { health: async () => ({}) }, target: configured });
    const offline = grpcHealthAdapter({
      client: {
        health: async () => {
          throw grpcError(grpc.status.UNAVAILABLE);
        },
      },
      target: configured,
    });

    expect((await online()).target).toBe(configured);
    expect((await offline()).target).toBe(configured);
  });

  it("returns a fresh result object per call, so a caller cannot poison the next probe", async () => {
    const probe = adapterFor(async () => ({ status: "SERVING" }));

    const first = await probe();
    first.status = "tampered";
    expect((await probe()).status).toBe("online");
  });
});

describe("service-monitor — probeAll", () => {
  it("returns one record per registered service, keeping registry metadata", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    const results = await probeAll();

    expect(results).toHaveLength(SERVICES.length);
    expect(results.map((row) => row.key).sort()).toEqual(["farm-stay", "greenhouse", "tasklab"]);
    for (const row of results) {
      const registered = SERVICES.find((service) => service.key === row.key);
      expect(row.name).toBe(registered.name);
      expect(row.description).toBe(registered.description);
      expect(row.transport).toBe(registered.transport);
      expect(row.flag).toBe(registered.flag);
    }
  });

  it("does not leak the probe function into the response", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    for (const row of await probeAll()) {
      expect(row).not.toHaveProperty("probe");
    }
  });

  it("reports flagEnabled true only for a flag that is exactly true", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({
      flags: { greenhouseControlRoomEnabled: true, taskLabEnabled: "true", farmStayEnabled: false },
    });

    const byKey = Object.fromEntries((await probeAll()).map((row) => [row.key, row]));
    expect(byKey.greenhouse.flagEnabled).toBe(true);
    // A truthy string is not `true`: the dashboard shows a switch, not a value.
    expect(byKey.tasklab.flagEnabled).toBe(false);
    expect(byKey["farm-stay"].flagEnabled).toBe(false);
  });

  it("reports flagEnabled false for a flag that is absent entirely", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    for (const row of await probeAll()) {
      expect(row.flagEnabled).toBe(false);
    }
  });

  it("still reports health when the feature flags cannot be read — flagEnabled becomes null", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockRejectedValue(new Error("flags file locked"));

    const results = await probeAll();
    expect(results).toHaveLength(SERVICES.length);
    for (const row of results) {
      expect(row.flagEnabled).toBeNull();
      expect(row.status).toBe("online");
    }
  });

  it("treats a flags payload with no flags key as an empty flag set, not a failure", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({});

    for (const row of await probeAll()) {
      expect(row.flagEnabled).toBe(false);
    }
  });

  it("reports each service independently — one offline does not hide the others", async () => {
    restoreProbes = stubAllProbes((key) =>
      key === "greenhouse"
        ? { status: "offline", target: "greenhouse:1", health: null, error: "down", hint: "Start it with: npm run greenhouse" }
        : onlineResult(key),
    );
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    const byKey = Object.fromEntries((await probeAll()).map((row) => [row.key, row]));
    expect(byKey.greenhouse.status).toBe("offline");
    expect(byKey.greenhouse.error).toBe("down");
    expect(byKey.tasklab.status).toBe("online");
    expect(byKey["farm-stay"].status).toBe("online");
  });

  it("lets the probe result win over registry metadata of the same name", async () => {
    // Pins the spread order: were metadata spread last, a future registry field
    // called `status` or `target` would silently mask real health.
    restoreProbes = stubAllProbes((key) => ({
      status: "degraded",
      target: "from-probe",
      name: "from-probe",
      health: null,
      error: null,
      hint: null,
    }));
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    for (const row of await probeAll()) {
      expect(row.status).toBe("degraded");
      expect(row.target).toBe("from-probe");
      expect(row.name).toBe("from-probe");
    }
  });

  it("probes every service concurrently rather than in sequence", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    restoreProbes = captureProbes();
    SERVICES.forEach((service) => {
      service.probe = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { status: "online", target: "t", health: null, error: null, hint: null };
      };
    });
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    await probeAll();
    expect(maxInFlight).toBe(SERVICES.length);
  });

  it("reads the feature flags once for the whole sweep, not once per service", async () => {
    restoreProbes = stubAllProbes(onlineResult);
    const spy = vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: {} });

    await probeAll();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
