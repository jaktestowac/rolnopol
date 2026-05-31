import { describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

function tapeSession(sessionId) {
  return {
    get(path) {
      return request(app).get(path).set("x-farmer-tape-session-id", sessionId);
    },
    post(path) {
      return request(app).post(path).set("x-farmer-tape-session-id", sessionId);
    },
  };
}

async function selectTape(session, tapeId) {
  const response = await session
    .post("/api/v1/tape-recorder/actions")
    .send({
      action: "selectTape",
      payload: { tapeId },
    })
    .expect(200);

  return response.body.data.snapshot;
}

async function recoverAllFragments(session, tapeId) {
  let snapshot = await selectTape(session, tapeId);
  let attempts = 0;

  while (snapshot?.currentTape?.controls?.canAdvance === true && attempts < 20) {
    const token = snapshot.currentTape.controls.advanceToken;
    const response = await session
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "playNext",
        payload: { tapeId, token },
      })
      .expect(200);

    snapshot = response.body.data.snapshot;
    attempts += 1;
  }

  return snapshot;
}

describe("Farmer's Tape Recorder API and hidden page", () => {
  it("serves the hidden operator page", async () => {
    const response = await request(app).get("/operator/tape-recorder.html").expect(200);

    expect(response.text).toContain("Farmer's Tape Recorder");
    expect(response.text).toContain("tapeCabinetList");
    expect(response.text).toContain("tapeAdvanceBtn");
    expect(response.text).not.toContain("The rain came down rust-colored");
  });

  it("redirects the short operator route to the html page", async () => {
    const response = await request(app).get("/operator/tape-recorder").expect(302);
    expect(response.headers.location).toBe("/operator/tape-recorder.html");
  });

  it("returns cabinet metadata without exposing transcript bodies up front", async () => {
    const response = await request(app).get("/api/v1/tape-recorder").expect(200);
    const rootFolder = response.body.data.cabinet.entries[0];

    expect(response.body.success).toBe(true);
    expect(response.body.data.page.title).toBe("Farmer's Tape Recorder");
    expect(response.body.data.cabinet.tapes.length).toBeGreaterThanOrEqual(5);
    expect(response.body.data.cabinet.entries).toHaveLength(1);
    expect(rootFolder.type).toBe("folder");
    expect(rootFolder.label).toBe("Field Archive");
    expect(rootFolder.children.some((entry) => entry.type === "folder" || entry.type === "tape")).toBe(true);
    expect(response.body.data.currentTape).toBeNull();
    expect(response.body.data.cabinet.tapes.every((tape) => tape.fragments === undefined)).toBe(true);
    expect(JSON.stringify(response.body.data)).not.toContain('"transcript"');
  });

  it("reveals one fragment at a time and invalidates used advance tokens", async () => {
    const session = tapeSession("token-guard-session");
    const selectedSnapshot = await selectTape(session, "tape-01-before-the-rain-took-color");
    const firstToken = selectedSnapshot.currentTape.controls.advanceToken;

    expect(firstToken).toEqual(expect.any(String));

    const firstResponse = await session
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "playNext",
        payload: {
          tapeId: "tape-01-before-the-rain-took-color",
          token: firstToken,
        },
      })
      .expect(200);

    expect(firstResponse.body.data.snapshot.currentTape.currentFragment.marker).toBe("00:11");
    expect(firstResponse.body.data.snapshot.currentTape.currentFragment.partNumber).toBe(1);
    expect(firstResponse.body.data.snapshot.currentTape.currentFragment.totalParts).toBe(4);
    expect(firstResponse.body.data.snapshot.currentTape.discoveredFragments).toHaveLength(1);
    expect(firstResponse.body.data.snapshot.currentTape.discoveredFragments[0].partNumber).toBe(1);
    expect(firstResponse.body.data.snapshot.currentTape.currentFragment.transcript[0]).toContain("north pump");

    const staleResponse = await session
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "playNext",
        payload: {
          tapeId: "tape-01-before-the-rain-took-color",
          token: firstToken,
        },
      })
      .expect(409);

    expect(staleResponse.body.success).toBe(false);
    expect(staleResponse.body.error).toContain("expired");

    const secondToken = firstResponse.body.data.snapshot.currentTape.controls.advanceToken;
    const secondResponse = await session
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "playNext",
        payload: {
          tapeId: "tape-01-before-the-rain-took-color",
          token: secondToken,
        },
      })
      .expect(200);

    expect(secondResponse.body.data.snapshot.currentTape.currentFragment.marker).toBe("01:43");
    expect(secondResponse.body.data.snapshot.currentTape.discoveredFragments).toHaveLength(2);
  });

  it("keeps later tapes locked until earlier evidence is complete", async () => {
    const session = tapeSession("locked-session");

    const response = await session
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "selectTape",
        payload: { tapeId: "tape-02-the-ditch-that-stayed-warm" },
      })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("Complete earlier recordings first");
  });

  it("unlocks the next tape after the current one is fully recovered", async () => {
    const session = tapeSession("unlock-session");
    const snapshot = await recoverAllFragments(session, "tape-01-before-the-rain-took-color");
    const nextTape = snapshot.cabinet.tapes.find((tape) => tape.id === "tape-02-the-ditch-that-stayed-warm");

    expect(snapshot.currentTape.progress.completed).toBe(true);
    expect(nextTape).toBeTruthy();
    expect(nextTape.locked).toBe(false);
    expect(nextTape.status).toBe("unopened");
  });

  it("isolates discovery progress per browser session", async () => {
    const sessionA = tapeSession("session-a");
    const sessionB = tapeSession("session-b");

    const selectedSnapshot = await selectTape(sessionA, "tape-01-before-the-rain-took-color");
    await sessionA
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "playNext",
        payload: {
          tapeId: "tape-01-before-the-rain-took-color",
          token: selectedSnapshot.currentTape.controls.advanceToken,
        },
      })
      .expect(200);

    const snapshotA = await sessionA.get("/api/v1/tape-recorder").expect(200);
    const snapshotB = await sessionB.get("/api/v1/tape-recorder").expect(200);

    expect(snapshotA.body.data.currentTape.discoveredFragments).toHaveLength(1);
    expect(snapshotB.body.data.currentTape).toBeNull();
  });

  it("keeps the cabinet collapsed with no selected tape after a reset", async () => {
    const session = tapeSession("reset-session");

    await selectTape(session, "tape-01-before-the-rain-took-color");

    const response = await session
      .post("/api/v1/tape-recorder/actions")
      .send({
        action: "resetSession",
        payload: { preserveSort: true },
      })
      .expect(200);

    expect(response.body.data.snapshot.currentTape).toBeNull();
    expect(response.body.data.snapshot.activity[0].type).toBe("sessionReset");
  });
});
