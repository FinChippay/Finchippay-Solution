/* eslint-env jest */
"use strict";

const express = require("express");
const request = require("supertest");
process.env.JEST_DB_UNAVAILABLE = "true";
const apiKeyService = require("../src/services/apiKeyService");
const { apiKeyAuth } = require("../src/middleware/apiKeyAuth");

const OWNER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

function createApp() {
  const app = express();
  app.use(express.json());
  app.post("/read", apiKeyAuth("read"), (_req, res) => res.json({ ok: true }));
  app.post("/send", apiKeyAuth("payments:send"), (_req, res) => res.json({ ok: true }));
  return app;
}

describe("API-key authentication", () => {
  beforeEach(() => apiKeyService.clearAll());

  test("rejects an invalid key with 401", async () => {
    const res = await request(createApp()).post("/read").set("X-API-Key", "invalid");
    expect(res.status).toBe(401);
  });

  test("read-only keys cannot submit payments", async () => {
    const key = await apiKeyService.createKey(OWNER, ["read"]);
    const res = await request(createApp())
      .post("/send")
      .set("X-API-Key", key.key)
      .send({ publicKey: OWNER });
    expect(res.status).toBe(403);
  });

  test("payment keys are restricted to their allowed public keys", async () => {
    const key = await apiKeyService.createKey(OWNER, ["payments:send"], [OWNER]);
    const allowed = await request(createApp())
      .post("/send")
      .set("X-API-Key", key.key)
      .send({ publicKey: OWNER });
    const denied = await request(createApp())
      .post("/send")
      .set("X-API-Key", key.key)
      .send({ publicKey: OTHER });
    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  test("revoked keys return 401 immediately", async () => {
    const key = await apiKeyService.createKey(OWNER, ["read"]);
    await apiKeyService.revokeKey(OWNER, key.id);
    const res = await request(createApp()).post("/read").set("X-API-Key", key.key);
    expect(res.status).toBe(401);
  });
});
