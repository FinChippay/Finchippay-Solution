/* eslint-env jest */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
process.env.JEST_DB_UNAVAILABLE = "true";
const apiKeyService = require("../src/services/apiKeyService");
const apiKeysRoutes = require("../src/routes/apiKeys");
const { JWT_SECRET } = require("../src/middleware/auth");

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/keys", apiKeysRoutes);
  return instance;
}

function auth() {
  return `Bearer ${jwt.sign({ publicKey: PUBLIC_KEY }, JWT_SECRET, { expiresIn: "1h" })}`;
}

describe("API key management", () => {
  beforeEach(async () => apiKeyService.clearAll());

  test("creates a 40-byte hex key and only returns plaintext at creation", async () => {
    const res = await request(app())
      .post("/api/keys")
      .set("Authorization", auth())
      .send({ scopes: ["read"] });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^[a-f0-9]{80}$/);
    expect(res.body.apiKey.prefix).toBe(res.body.key.slice(0, 8));
    expect(res.body.apiKey).not.toHaveProperty("keyHash");
  });

  test("lists keys redacted", async () => {
    await request(app())
      .post("/api/keys")
      .set("Authorization", auth())
      .send({ scopes: ["read"] });
    const res = await request(app()).get("/api/keys").set("Authorization", auth());
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).not.toHaveProperty("key");
    expect(res.body.keys[0]).not.toHaveProperty("keyHash");
  });

  test("revokes a key immediately", async () => {
    const created = await request(app())
      .post("/api/keys")
      .set("Authorization", auth())
      .send({ scopes: ["read"] });
    const revoked = await request(app())
      .delete(`/api/keys/${created.body.apiKey.id}`)
      .set("Authorization", auth());
    expect(revoked.status).toBe(200);
    expect(await apiKeyService.findByKey(created.body.key)).toBeNull();
  });

  test("enforces read and payment scopes", async () => {
    const readOnly = await apiKeyService.createKey(PUBLIC_KEY, ["read"]);
    const payment = await apiKeyService.createKey(PUBLIC_KEY, ["payments:send"]);
    expect((await apiKeyService.findByKey(readOnly.key)).hasScope("read")).toBe(true);
    expect((await apiKeyService.findByKey(readOnly.key)).hasScope("payments:send")).toBe(false);
    expect((await apiKeyService.findByKey(payment.key)).hasScope("payments:send")).toBe(true);
  });

  test("rejects invalid keys", async () => {
    expect(await apiKeyService.findByKey("not-a-valid-key")).toBeNull();
  });
});
