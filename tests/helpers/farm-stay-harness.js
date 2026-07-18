/**
 * Test harness for the FarmStay ecosystem.
 *
 * Boots the four leaf services (inventory + reservation over gRPC, pricing +
 * review-desk over REST) and the thin gateway, each on its own fixed port with
 * throwaway temp DBs and `FARM_STAY_LOG=silent`. Returns the gateway express
 * `app` (for supertest), a listening gateway server (for the app-side HTTP
 * client used by the REST-bridge test), and start/stop controls per leaf (used
 * by the degradation test).
 *
 * All env is set BEFORE the service modules are required, so their configs pick
 * up the test ports/paths. Each integration test file gets its own port block
 * (integration tests run sequentially — see vitest.config.js).
 */
const path = require("path");
const os = require("os");
const fs = require("fs");

const FS_ROOT = path.join(__dirname, "..", "..", "external-services", "farm-stay");

/**
 * @param {object} opts
 * @param {number} opts.base   port base; leaves/gateway derive their ports from it
 * @param {string} opts.tag    unique slug for temp DB filenames
 */
async function startEcosystem({ base, tag }) {
  const ports = {
    gateway: base,
    pricing: base + 1,
    review: base + 2,
    inventory: base + 100,
    reservation: base + 101,
  };
  const dbPaths = {
    inventory: path.join(os.tmpdir(), `fs-inv-${tag}-${process.pid}.json`),
    reservations: path.join(os.tmpdir(), `fs-res-${tag}-${process.pid}.json`),
    reviews: path.join(os.tmpdir(), `fs-rev-${tag}-${process.pid}.json`),
  };
  // Start from empty so seeding is deterministic.
  for (const p of Object.values(dbPaths)) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }

  process.env.FARM_STAY_LOG = "silent";
  process.env.INVENTORY_GRPC_PORT = String(ports.inventory);
  process.env.INVENTORY_GRPC_TARGET = `localhost:${ports.inventory}`;
  process.env.RESERVATION_GRPC_PORT = String(ports.reservation);
  process.env.RESERVATION_GRPC_TARGET = `localhost:${ports.reservation}`;
  process.env.PRICING_PORT = String(ports.pricing);
  process.env.PRICING_URL = `http://localhost:${ports.pricing}`;
  process.env.REVIEW_DESK_PORT = String(ports.review);
  process.env.REVIEW_DESK_URL = `http://localhost:${ports.review}`;
  process.env.STAY_GATEWAY_PORT = String(ports.gateway);
  process.env.INVENTORY_DB_PATH = dbPaths.inventory;
  process.env.RESERVATIONS_DB_PATH = dbPaths.reservations;
  process.env.REVIEWS_DB_PATH = dbPaths.reviews;

  const inventorySvc = require(path.join(FS_ROOT, "inventory-service", "server", "index.js"));
  const reservationSvc = require(path.join(FS_ROOT, "reservation-service", "server", "index.js"));
  const pricingSvc = require(path.join(FS_ROOT, "pricing-service", "server", "index.js"));
  const reviewSvc = require(path.join(FS_ROOT, "review-desk-service", "server", "index.js"));

  // Each entry owns its live handle + how to (re)start and stop it.
  const leaves = {
    inventory: {
      handle: null,
      async start() {
        this.handle = await inventorySvc.start();
      },
      stop() {
        if (this.handle) this.handle.server.forceShutdown();
        this.handle = null;
      },
    },
    reservation: {
      handle: null,
      async start() {
        this.handle = await reservationSvc.start();
      },
      stop() {
        if (this.handle) this.handle.server.forceShutdown();
        this.handle = null;
      },
    },
    pricing: {
      handle: null,
      async start() {
        this.handle = pricingSvc.start();
        await waitListening(this.handle);
      },
      stop() {
        const s = this.handle;
        this.handle = null;
        return closeServer(s);
      },
    },
    review: {
      handle: null,
      async start() {
        this.handle = await reviewSvc.start();
        await waitListening(this.handle);
      },
      stop() {
        const s = this.handle;
        this.handle = null;
        return closeServer(s);
      },
    },
  };

  // Leaves first, then the gateway (leaf-first startup, like start-all.js).
  await leaves.inventory.start();
  await leaves.reservation.start();
  await leaves.pricing.start();
  await leaves.review.start();

  // Require the gateway AFTER leaf targets are set so its clients dial the right ports.
  const gatewaySvc = require(path.join(FS_ROOT, "stay-gateway-service", "server", "index.js"));
  const app = gatewaySvc.buildApp();
  const gatewayServer = app.listen(ports.gateway);
  await waitListening(gatewayServer);

  return {
    app,
    ports,
    dbPaths,
    gatewayServer,
    baseUrl: `http://localhost:${ports.gateway}`,
    /** Stop a single leaf (degradation test). */
    async stopLeaf(name) {
      await leaves[name].stop();
    },
    /** (Re)start a single leaf on its fixed port. */
    async startLeaf(name) {
      await leaves[name].start();
    },
    async stop() {
      await new Promise((resolve) => gatewayServer.close(resolve));
      for (const name of Object.keys(leaves)) {
        try {
          await leaves[name].stop();
        } catch {
          /* ignore */
        }
      }
      for (const p of Object.values(dbPaths)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function waitListening(server) {
  if (!server || server.listening) return Promise.resolve();
  return new Promise((resolve) => server.once("listening", resolve));
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

module.exports = { startEcosystem, FS_ROOT };
