import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The notification egress used by services outside the crew module
// (helpers/notification-publisher.js).
//
// Twenty-nine lines whose entire job is a promise the callers rely on and none of
// them state: publishing a notification can never fail a business operation. A
// field is created, a webhook is queued, an animal is deleted — and then a
// notification is attempted. If the notification centre is disabled, throwing, or
// simply absent, the caller must see `false` and carry on, not an exception that
// unwinds work already committed to disk.
//
// The publisher is also where `accepted` is turned into a boolean. `accepted: true`
// and only that means yes — a truthy-but-not-true value would otherwise report a
// success the notification centre never claimed.
const notificationCenter = require("../../modules/notification-center");
const { publishNotificationEvent } = require("../../helpers/notification-publisher");

const event = (overrides = {}) => ({ type: "field.created", payload: { fieldId: 1 }, ...overrides });

let publishSpy;

beforeEach(() => {
  publishSpy = vi.spyOn(notificationCenter, "publish");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notification-publisher — reporting the outcome", () => {
  it("returns true only when the centre accepted the event", async () => {
    publishSpy.mockResolvedValue({ accepted: true });

    await expect(publishNotificationEvent(event())).resolves.toBe(true);
  });

  it("returns false when the centre declined", async () => {
    publishSpy.mockResolvedValue({ accepted: false });

    await expect(publishNotificationEvent(event())).resolves.toBe(false);
  });

  it("treats a truthy-but-not-true accepted as a refusal", async () => {
    for (const accepted of ["true", 1, {}, [], "yes"]) {
      publishSpy.mockResolvedValue({ accepted });
      await expect(publishNotificationEvent(event())).resolves.toBe(false);
    }
  });

  it("returns false when the centre resolves to nothing at all", async () => {
    for (const value of [undefined, null, {}]) {
      publishSpy.mockResolvedValue(value);
      await expect(publishNotificationEvent(event())).resolves.toBe(false);
    }
  });

  it("always returns a boolean, never the centre's payload", async () => {
    publishSpy.mockResolvedValue({ accepted: true, id: "notif-1", extra: "detail" });

    expect(await publishNotificationEvent(event())).toBe(true);
  });
});

describe("notification-publisher — a failure never reaches the caller", () => {
  it("swallows a rejection and returns false", async () => {
    publishSpy.mockRejectedValue(new Error("notification centre disabled"));

    await expect(publishNotificationEvent(event())).resolves.toBe(false);
  });

  it("swallows a synchronous throw too", async () => {
    publishSpy.mockImplementation(() => {
      throw new Error("module not initialised");
    });

    await expect(publishNotificationEvent(event())).resolves.toBe(false);
  });

  it("swallows a non-Error throwable", async () => {
    publishSpy.mockRejectedValue("just a string");

    await expect(publishNotificationEvent(event())).resolves.toBe(false);
  });

  it("does not throw when handed no event at all", async () => {
    publishSpy.mockResolvedValue({ accepted: false });

    await expect(publishNotificationEvent(undefined)).resolves.toBe(false);
    await expect(publishNotificationEvent(null)).resolves.toBe(false);
  });

  it("does not throw when the failure path has to read a missing event's type", async () => {
    // The catch block logs `event?.type`; a null event must not turn a failed
    // publish into a second, different failure.
    publishSpy.mockRejectedValue(new Error("boom"));

    await expect(publishNotificationEvent(null)).resolves.toBe(false);
  });
});

describe("notification-publisher — what it sends", () => {
  it("passes the event through untouched", async () => {
    publishSpy.mockResolvedValue({ accepted: true });
    const payload = event({ type: "animal.deleted" });

    await publishNotificationEvent(payload);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0]).toBe(payload);
  });

  it("defaults the source to the app when the event names none", async () => {
    publishSpy.mockResolvedValue({ accepted: true });

    await publishNotificationEvent(event());

    expect(publishSpy.mock.calls[0][1]).toEqual({ source: "rolnopol-app" });
  });

  it("keeps a source the event already carries", async () => {
    publishSpy.mockResolvedValue({ accepted: true });

    await publishNotificationEvent(event({ source: "greenhouse" }));

    expect(publishSpy.mock.calls[0][1]).toEqual({ source: "greenhouse" });
  });

  it("does not forward the caller's action or meta to the centre — they are for the log only", async () => {
    publishSpy.mockResolvedValue({ accepted: true });

    await publishNotificationEvent(event(), { action: "field_create", meta: { userId: 3 } });

    expect(publishSpy.mock.calls[0][1]).toEqual({ source: "rolnopol-app" });
  });

  it("publishes exactly once — no retry that could double-send a notification", async () => {
    publishSpy.mockRejectedValue(new Error("transient"));

    await publishNotificationEvent(event());

    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("notification-publisher — tolerating a bad options argument", () => {
  it("accepts a missing, null or non-object options without throwing", async () => {
    publishSpy.mockResolvedValue({ accepted: true });

    for (const options of [undefined, null, "nope", 42, []]) {
      await expect(publishNotificationEvent(event(), options)).resolves.toBe(true);
    }
  });

  it("tolerates a non-object meta on the failure path, where meta is spread", async () => {
    publishSpy.mockRejectedValue(new Error("boom"));

    for (const meta of ["string", 42, null, undefined]) {
      await expect(publishNotificationEvent(event(), { meta })).resolves.toBe(false);
    }
  });
});
