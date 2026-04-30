import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const featureFlagsService = require("../services/feature-flags.service");

const DEFAULT_PERSONAL_API_KEY_LABEL = "Personal integration key";

async function registerUser() {
  const user = {
    email: `api-key-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`,
    displayedName: "API Key User",
    password: "testpass123",
  };

  const response = await request(app).post("/api/v1/register").send(user).expect(201);

  return {
    user,
    token: response.body.data.token,
    userId: response.body.data.user.id,
  };
}

async function enablePersonalApiKeysFeature() {
  await featureFlagsService.updateFlags({ personalApiKeysEnabled: true });
}

async function createPersonalApiKey(session, payload = {}) {
  return request(app)
    .post("/api/v1/users/profile/api-keys")
    .set("token", session.token)
    .send({
      label: "Profile sync",
      scopes: ["user-account"],
      ...payload,
    })
    .expect(201);
}

describe("Personal API keys API", () => {
  let originalFlagValue = false;
  let originalAssistantChatFlagValue = false;

  beforeAll(async () => {
    const flags = await featureFlagsService.getFeatureFlags();
    originalFlagValue = flags?.flags?.personalApiKeysEnabled === true;
    originalAssistantChatFlagValue = flags?.flags?.assistantChatEnabled === true;
    await featureFlagsService.updateFlags({ personalApiKeysEnabled: true });
  });

  afterAll(async () => {
    await featureFlagsService.updateFlags({
      personalApiKeysEnabled: originalFlagValue,
      assistantChatEnabled: originalAssistantChatFlagValue,
    });
  });

  beforeEach(async () => {
    await featureFlagsService.updateFlags({
      personalApiKeysEnabled: true,
      assistantChatEnabled: false,
    });
  });

  it("creates and lists personal API keys for the authenticated user", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await request(app)
      .post("/api/v1/users/profile/api-keys")
      .set("token", session.token)
      .send({
        label: "Weather sync",
        scopes: ["user-account", "fields"],
      })
      .expect(201);

    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data).toHaveProperty("rawKey");
    expect(createRes.body.data.key.label).toBe("Weather sync");
    expect(createRes.body.data.key.scopes).toEqual(["user-account", "fields"]);
    expect(createRes.body.data.key).not.toHaveProperty("keyHash");

    const listRes = await request(app).get("/api/v1/users/profile/api-keys").set("token", session.token).expect(200);

    expect(listRes.body.success).toBe(true);
    expect(Array.isArray(listRes.body.data.items)).toBe(true);
    expect(listRes.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.data.items[0]).not.toHaveProperty("rawKey");
  });

  it("authenticates user-account scoped API keys on protected profile endpoints", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session);

    const rawKey = createRes.body.data.rawKey;
    expect(typeof rawKey).toBe("string");

    const profileRes = await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(200);

    expect(profileRes.body.success).toBe(true);
    expect(profileRes.body.data.id).toBe(session.userId);
  });

  it("allows user-account scoped API keys to read and update the owner's profile data", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Profile editor",
      scopes: ["user-account"],
    });

    const rawKey = createRes.body.data.rawKey;
    const nextDisplayedName = `KeyUser${String(Date.now()).slice(-6)}`;

    const initialProfileRes = await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(200);

    expect(initialProfileRes.body.success).toBe(true);
    expect(initialProfileRes.body.data.id).toBe(session.userId);
    expect(initialProfileRes.body.data.displayedName).toBe(session.user.displayedName);

    const updateRes = await request(app)
      .put("/api/v1/users/profile")
      .set("X-API-Key", rawKey)
      .send({ displayedName: nextDisplayedName })
      .expect(200);

    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.data.id).toBe(session.userId);
    expect(updateRes.body.data.displayedName).toBe(nextDisplayedName);

    const updatedProfileRes = await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(200);

    expect(updatedProfileRes.body.success).toBe(true);
    expect(updatedProfileRes.body.data.displayedName).toBe(nextDisplayedName);
  });

  it("rejects access when the API key scope does not cover the target resource", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await request(app)
      .post("/api/v1/users/profile/api-keys")
      .set("token", session.token)
      .send({
        label: "Profile only",
        scopes: ["user-account"],
      })
      .expect(201);

    const rawKey = createRes.body.data.rawKey;

    const staffRes = await request(app).get("/api/v1/staff").set("X-API-Key", rawKey).expect(403);

    expect(staffRes.body.success).toBe(false);
    expect(String(staffRes.body.error || "")).toContain("API key does not grant access");
  });

  it("allows fields scoped API keys to list, create, and update field data", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Fields automation",
      scopes: ["fields"],
    });

    const rawKey = createRes.body.data.rawKey;
    const fieldPayload = {
      name: `API Key Field ${Date.now()}`,
      size: 120,
      location: "North plot",
      cropType: "Wheat",
    };

    const initialFieldsRes = await request(app).get("/api/v1/fields").set("X-API-Key", rawKey).expect(200);

    expect(initialFieldsRes.body.success).toBe(true);
    expect(Array.isArray(initialFieldsRes.body.data)).toBe(true);

    const createFieldRes = await request(app).post("/api/v1/fields").set("X-API-Key", rawKey).send(fieldPayload).expect(201);

    expect(createFieldRes.body.success).toBe(true);
    expect(createFieldRes.body.data.name).toBe(fieldPayload.name);
    expect(createFieldRes.body.data.size).toBe(fieldPayload.size);

    const fieldId = createFieldRes.body.data.id;
    const updatePayload = {
      name: `${fieldPayload.name} Updated`,
      cropType: "Corn",
    };

    const updateFieldRes = await request(app).put(`/api/v1/fields/${fieldId}`).set("X-API-Key", rawKey).send(updatePayload).expect(200);

    expect(updateFieldRes.body.success).toBe(true);
    expect(updateFieldRes.body.data.id).toBe(fieldId);
    expect(updateFieldRes.body.data.name).toBe(updatePayload.name);
    expect(updateFieldRes.body.data.cropType).toBe(updatePayload.cropType);

    const fieldsAfterUpdateRes = await request(app).get("/api/v1/fields").set("X-API-Key", rawKey).expect(200);

    expect(fieldsAfterUpdateRes.body.success).toBe(true);
    expect(fieldsAfterUpdateRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fieldId,
          name: updatePayload.name,
          cropType: updatePayload.cropType,
        }),
      ]),
    );
  });

  it("allows staff scoped API keys to list, create, and update staff data", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Staff automation",
      scopes: ["staff"],
    });

    const rawKey = createRes.body.data.rawKey;
    const staffPayload = {
      name: "Anna",
      surname: `Scope${String(Date.now()).slice(-5)}`,
      position: "Worker",
      age: 31,
    };

    const initialStaffRes = await request(app).get("/api/v1/staff").set("X-API-Key", rawKey).expect(200);

    expect(initialStaffRes.body.success).toBe(true);
    expect(Array.isArray(initialStaffRes.body.data)).toBe(true);

    const createStaffRes = await request(app).post("/api/v1/staff").set("X-API-Key", rawKey).send(staffPayload).expect(201);

    expect(createStaffRes.body.success).toBe(true);
    expect(createStaffRes.body.data.name).toBe(staffPayload.name);
    expect(createStaffRes.body.data.position).toBe(staffPayload.position);

    const staffId = createStaffRes.body.data.id;
    const updatePayload = {
      name: "Anna Updated",
      position: "Supervisor",
      age: 32,
    };

    const updateStaffRes = await request(app).put(`/api/v1/staff/${staffId}`).set("X-API-Key", rawKey).send(updatePayload).expect(200);

    expect(updateStaffRes.body.success).toBe(true);
    expect(updateStaffRes.body.data.id).toBe(staffId);
    expect(updateStaffRes.body.data.name).toBe(updatePayload.name);
    expect(updateStaffRes.body.data.position).toBe(updatePayload.position);

    const staffAfterUpdateRes = await request(app).get("/api/v1/staff").set("X-API-Key", rawKey).expect(200);

    expect(staffAfterUpdateRes.body.success).toBe(true);
    expect(staffAfterUpdateRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: staffId,
          name: updatePayload.name,
          position: updatePayload.position,
        }),
      ]),
    );
  });

  it("allows animals scoped API keys to list, create, and update animal data", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Animals automation",
      scopes: ["animals"],
    });

    const rawKey = createRes.body.data.rawKey;
    const animalPayload = {
      type: "cow",
      amount: 5,
    };

    const initialAnimalsRes = await request(app).get("/api/v1/animals").set("X-API-Key", rawKey).expect(200);

    expect(initialAnimalsRes.body.success).toBe(true);
    expect(Array.isArray(initialAnimalsRes.body.data)).toBe(true);

    const createAnimalRes = await request(app).post("/api/v1/animals").set("X-API-Key", rawKey).send(animalPayload).expect(201);

    expect(createAnimalRes.body.success).toBe(true);
    expect(createAnimalRes.body.data.type).toBe(animalPayload.type);
    expect(createAnimalRes.body.data.amount).toBe(animalPayload.amount);

    const animalId = createAnimalRes.body.data.id;
    const updatePayload = {
      amount: 9,
    };

    const updateAnimalRes = await request(app).put(`/api/v1/animals/${animalId}`).set("X-API-Key", rawKey).send(updatePayload).expect(200);

    expect(updateAnimalRes.body.success).toBe(true);
    expect(updateAnimalRes.body.data.id).toBe(animalId);
    expect(updateAnimalRes.body.data.amount).toBe(updatePayload.amount);

    const animalsAfterUpdateRes = await request(app).get("/api/v1/animals").set("X-API-Key", rawKey).expect(200);

    expect(animalsAfterUpdateRes.body.success).toBe(true);
    expect(animalsAfterUpdateRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: animalId,
          amount: updatePayload.amount,
        }),
      ]),
    );
  });

  it("allows chatbot scoped API keys to access assistant chat messages", async () => {
    const session = await registerUser();
    await featureFlagsService.updateFlags({
      personalApiKeysEnabled: true,
      assistantChatEnabled: true,
    });

    const createRes = await createPersonalApiKey(session, {
      label: "Chat automation",
      scopes: ["chatbot"],
    });

    const rawKey = createRes.body.data.rawKey;

    const chatRes = await request(app).post("/api/v1/assistant-chat/messages").set("X-API-Key", rawKey).send({ message: "hi" }).expect(200);

    expect(chatRes.body.success).toBe(true);
    expect(chatRes.body.data).toHaveProperty("reply");
    expect(String(chatRes.body.data.reply || "")).toContain("Ask me about your fields, staff, animals");
  });

  it("allows all scoped API keys to access multiple protected resource types", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Full automation",
      scopes: ["all"],
    });

    const rawKey = createRes.body.data.rawKey;

    const profileRes = await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(200);

    expect(profileRes.body.success).toBe(true);
    expect(profileRes.body.data.id).toBe(session.userId);

    const createStaffRes = await request(app)
      .post("/api/v1/staff")
      .set("X-API-Key", rawKey)
      .send({
        name: "All Scope",
        surname: `User${String(Date.now()).slice(-4)}`,
        position: "Coordinator",
        age: 29,
      })
      .expect(201);

    expect(createStaffRes.body.success).toBe(true);
    expect(createStaffRes.body.data.name).toBe("All Scope");

    const createFieldRes = await request(app)
      .post("/api/v1/fields")
      .set("X-API-Key", rawKey)
      .send({
        name: `All Scope Field ${Date.now()}`,
        size: 75,
        location: "South plot",
        cropType: "Barley",
      })
      .expect(201);

    expect(createFieldRes.body.success).toBe(true);
    expect(createFieldRes.body.data.cropType).toBe("Barley");
  });

  it("regenerates API keys and invalidates the previous raw key", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Rotation test",
    });

    const keyId = createRes.body.data.key.id;
    const oldRawKey = createRes.body.data.rawKey;

    const regenerateRes = await request(app)
      .post(`/api/v1/users/profile/api-keys/${keyId}/regenerate`)
      .set("token", session.token)
      .expect(200);

    const newRawKey = regenerateRes.body.data.rawKey;
    expect(typeof newRawKey).toBe("string");
    expect(newRawKey).not.toBe(oldRawKey);

    await request(app).get("/api/v1/users/profile").set("X-API-Key", oldRawKey).expect(403);

    const profileRes = await request(app).get("/api/v1/users/profile").set("X-API-Key", newRawKey).expect(200);

    expect(profileRes.body.success).toBe(true);
    expect(profileRes.body.data.id).toBe(session.userId);
  });

  it("revokes API keys and requires session auth for key lifecycle endpoints", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Revocation test",
    });

    const keyId = createRes.body.data.key.id;
    const rawKey = createRes.body.data.rawKey;

    await request(app).get("/api/v1/users/profile/api-keys").set("X-API-Key", rawKey).expect(401);

    await request(app).delete(`/api/v1/users/profile/api-keys/${keyId}`).set("token", session.token).expect(200);

    await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(403);
  });

  it("applies the default label and normalizes aliased scopes", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "   ",
      scopes: [" user ", "assistant-chat", "user_account", "  "],
    });

    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.key.label).toBe(DEFAULT_PERSONAL_API_KEY_LABEL);
    expect(createRes.body.data.key.scopes).toEqual(["user-account", "chatbot"]);
    expect(createRes.body.data.allowedScopes).toEqual(expect.arrayContaining(["all", "chatbot", "user-account"]));
  });

  it("updates lastUsedAt after a successful API key authentication", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Usage tracker",
    });

    const keyId = createRes.body.data.key.id;
    const rawKey = createRes.body.data.rawKey;

    const initialListRes = await request(app).get("/api/v1/users/profile/api-keys").set("token", session.token).expect(200);

    const initialKey = initialListRes.body.data.items.find((item) => item.id === keyId);
    expect(initialKey).toBeTruthy();
    expect(initialKey.lastUsedAt).toBeNull();

    await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(200);

    const listRes = await request(app).get("/api/v1/users/profile/api-keys").set("token", session.token).expect(200);

    const updatedKey = listRes.body.data.items.find((item) => item.id === keyId);
    expect(updatedKey).toBeTruthy();
    expect(updatedKey.lastUsedAt).toEqual(expect.any(String));
  });

  it("returns 404 when another user tries to manage someone else's API key", async () => {
    const ownerSession = await registerUser();
    const otherSession = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(ownerSession, {
      label: "Owner only",
    });

    const keyId = createRes.body.data.key.id;

    const regenerateRes = await request(app)
      .post(`/api/v1/users/profile/api-keys/${keyId}/regenerate`)
      .set("token", otherSession.token)
      .expect(404);

    expect(regenerateRes.body.success).toBe(false);
    expect(regenerateRes.body.error).toContain("API key not found");

    const deleteRes = await request(app).delete(`/api/v1/users/profile/api-keys/${keyId}`).set("token", otherSession.token).expect(404);

    expect(deleteRes.body.success).toBe(false);
    expect(deleteRes.body.error).toContain("API key not found");
  });

  it("returns validation errors for unsupported scopes and labels that are too long", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const longLabelRes = await request(app)
      .post("/api/v1/users/profile/api-keys")
      .set("token", session.token)
      .send({
        label: "L".repeat(81),
        scopes: ["user-account"],
      })
      .expect(400);

    expect(longLabelRes.body.success).toBe(false);
    expect(longLabelRes.body.error).toContain("label must be 80 characters or fewer");

    const unsupportedScopeRes = await request(app)
      .post("/api/v1/users/profile/api-keys")
      .set("token", session.token)
      .send({
        label: "Bad scope",
        scopes: ["weather-control"],
      })
      .expect(400);

    expect(unsupportedScopeRes.body.success).toBe(false);
    expect(unsupportedScopeRes.body.error).toContain("unsupported scope");
  });

  it("returns not found when the personal API keys feature flag is disabled", async () => {
    const session = await registerUser();
    await featureFlagsService.updateFlags({ personalApiKeysEnabled: false });

    const response = await request(app).get("/api/v1/users/profile/api-keys").set("token", session.token).expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("Personal API keys not found");
  });

  it("rejects existing API keys on protected endpoints when the feature flag is disabled", async () => {
    const session = await registerUser();
    await enablePersonalApiKeysFeature();

    const createRes = await createPersonalApiKey(session, {
      label: "Flag toggle test",
    });

    const rawKey = createRes.body.data.rawKey;

    await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(200);

    await featureFlagsService.updateFlags({ personalApiKeysEnabled: false });

    const profileRes = await request(app).get("/api/v1/users/profile").set("X-API-Key", rawKey).expect(403);

    expect(profileRes.body.success).toBe(false);
    expect(String(profileRes.body.error || "")).toContain("Invalid or revoked API key");
  });
});
