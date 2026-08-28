/* eslint-env jest */
/**
 * __tests__/webhookSignature.test.js
 *
 * Inbound webhook signature verification (X-Signature / X-Timestamp HMAC).
 * Covers valid, tampered, replayed, missing-header, stale-timestamp, and
 * secret-rotation cases end-to-end through a real Express app + real
 * (throwaway, migrated) SQLite DB — no mocking of the crypto path itself.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const request = require("supertest");

// Use a per-test-file throwaway SQLite DB, migrated fresh, BEFORE any module
// that opens db/connection.js is required (mirrors turretsPersistence.test.js).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "webhook-signature-"));
const DB_FILE = path.join(TMP_DIR, "webhook-signature.db");
process.env.DB_PROVIDER = "sqlite";
process.env.DB_FILENAME = DB_FILE;
process.env.NODE_ENV = "test";
// 64-char hex key required by the AES-256-GCM encryption utility.
process.env.WEBHOOK_ENCRYPTION_KEY =
  "aaabbbcccdddeeefff000111222333444555666777888999000aaabbbcccdddee";
process.env.WEBHOOK_SECRET_KEY = "test-webhook-secret-key-for-hashing-only";

const knex = require("../src/db/connection");
const cacheService = require("../src/services/cacheService");
const inboundWebhookSecretService = require("../src/services/inboundWebhookSecretService");
const { verifyInboundWebhookSignature } = require("../src/middleware/verifyInboundWebhookSignature");
const { jsonBodyParser } = require("../src/middleware/bodyParsing");

const ENDPOINT = "test_webhook";

function buildApp() {
  const app = express();
  app.use(jsonBodyParser());
  app.post("/webhook", verifyInboundWebhookSignature(ENDPOINT), (req, res) => {
    res.status(200).json({ received: true });
  });
  return app;
}

function sign(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

beforeAll(async () => {
  await knex.migrate.latest();
});

afterAll(async () => {
  await knex.destroy();
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

afterEach(() => {
  // The replay-nonce store persists across requests within a test via the
  // in-memory LRU fallback (no Redis in this test env) — clear it so one
  // test's signatures can't accidentally collide with another's.
  cacheService.clearLRU();
});

describe("verifyInboundWebhookSignature", () => {
  let app;
  let secret;

  beforeEach(async () => {
    await knex("inbound_webhook_secrets").where({ endpoint: ENDPOINT }).del();
    const created = await inboundWebhookSecretService.createSecret(ENDPOINT);
    secret = created.secret;
    app = buildApp();
  });

  it("accepts a request with a valid signature and fresh timestamp", async () => {
    const body = { transaction: { id: "tx-1", status: "completed" } };
    const rawBody = JSON.stringify(body);
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, rawBody))
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it("rejects a request with no X-Signature header with 401", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-2" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_WEBHOOK_SIGNATURE");
  });

  it("rejects a request with no X-Timestamp header with 401", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-3" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, rawBody))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_WEBHOOK_SIGNATURE");
  });

  it("rejects a request with a malformed (non-hex) signature with 401", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-4" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", "not-a-valid-hex-signature!!")
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
  });

  it("rejects a tampered body signed with a valid secret but for different content", async () => {
    const signedBody = JSON.stringify({ transaction: { id: "tx-5", status: "pending" } });
    const tamperedBody = JSON.stringify({ transaction: { id: "tx-5", status: "completed" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, signedBody)) // signature for the ORIGINAL body
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(tamperedBody); // but the TAMPERED body is what's actually sent

    expect(res.status).toBe(401);
  });

  it("rejects a signature produced with the wrong secret", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-6" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign("completely-wrong-secret", rawBody))
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp outside the replay window", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-7" } });
    const staleTimestamp = nowSeconds() - 3600; // 1 hour ago, window is 5 min
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, rawBody))
      .set("X-Timestamp", String(staleTimestamp))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
  });

  it("rejects a timestamp too far in the future", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-8" } });
    const futureTimestamp = nowSeconds() + 3600;
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, rawBody))
      .set("X-Timestamp", String(futureTimestamp))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
  });

  it("rejects a non-numeric X-Timestamp", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-9" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, rawBody))
      .set("X-Timestamp", "not-a-number")
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
  });

  it("accepts the first use of a valid signature but rejects a byte-for-byte replay", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-10", status: "completed" } });
    const headers = {
      "X-Signature": sign(secret, rawBody),
      "X-Timestamp": String(nowSeconds()),
    };

    const first = await request(app)
      .post("/webhook")
      .set(headers)
      .set("Content-Type", "application/json")
      .send(rawBody);
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post("/webhook")
      .set(headers)
      .set("Content-Type", "application/json")
      .send(rawBody);
    expect(replay.status).toBe(401);
  });

  it("rejects every request when the endpoint has no active secret", async () => {
    await knex("inbound_webhook_secrets").where({ endpoint: ENDPOINT }).del();
    const rawBody = JSON.stringify({ transaction: { id: "tx-11" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Signature", sign(secret, rawBody))
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(rawBody);

    expect(res.status).toBe(401);
  });

  it("does not include which check failed in the response body", async () => {
    const rawBody = JSON.stringify({ transaction: { id: "tx-12" } });
    const res = await request(app)
      .post("/webhook")
      .set("X-Timestamp", String(nowSeconds()))
      .set("Content-Type", "application/json")
      .send(rawBody);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/missing_headers|stale|replay|signature_mismatch/i);
  });
});

describe("inboundWebhookSecretService", () => {
  const ROTATION_ENDPOINT = "test_rotation_endpoint";

  beforeEach(async () => {
    await knex("inbound_webhook_secrets").where({ endpoint: ROTATION_ENDPOINT }).del();
  });

  it("never stores the secret in plaintext", async () => {
    const created = await inboundWebhookSecretService.createSecret(ROTATION_ENDPOINT);
    const row = await knex("inbound_webhook_secrets").where({ id: created.id }).first();

    expect(row.secret_encrypted).not.toContain(created.secret);
    expect(row.secret_hash).not.toBe(created.secret);
    expect(typeof row.secret_encrypted).toBe("string");
  });

  it("ensureSecretExists is idempotent — a second call is a no-op", async () => {
    const first = await inboundWebhookSecretService.ensureSecretExists(ROTATION_ENDPOINT);
    const second = await inboundWebhookSecretService.ensureSecretExists(ROTATION_ENDPOINT);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const active = await inboundWebhookSecretService.getActiveSecrets(ROTATION_ENDPOINT);
    expect(active).toHaveLength(1);
  });

  it("rotateSecret with no grace period immediately invalidates the old secret", async () => {
    const original = await inboundWebhookSecretService.createSecret(ROTATION_ENDPOINT);
    const rotated = await inboundWebhookSecretService.rotateSecret(ROTATION_ENDPOINT);

    const active = await inboundWebhookSecretService.getActiveSecrets(ROTATION_ENDPOINT);
    expect(active).toEqual([rotated.secret]);
    expect(active).not.toContain(original.secret);
  });

  it("rotateSecret with a grace period keeps both secrets valid until it elapses", async () => {
    const original = await inboundWebhookSecretService.createSecret(ROTATION_ENDPOINT);
    const rotated = await inboundWebhookSecretService.rotateSecret(ROTATION_ENDPOINT, {
      graceSeconds: 3600,
    });

    const active = await inboundWebhookSecretService.getActiveSecrets(ROTATION_ENDPOINT);
    expect(active.sort()).toEqual([original.secret, rotated.secret].sort());
  });

  it("revokeSecret immediately invalidates a specific secret even mid-grace-period", async () => {
    const original = await inboundWebhookSecretService.createSecret(ROTATION_ENDPOINT);
    await inboundWebhookSecretService.rotateSecret(ROTATION_ENDPOINT, { graceSeconds: 3600 });
    await inboundWebhookSecretService.revokeSecret(ROTATION_ENDPOINT, original.id);

    const active = await inboundWebhookSecretService.getActiveSecrets(ROTATION_ENDPOINT);
    expect(active).not.toContain(original.secret);
  });

  it("listSecrets reports metadata without ever exposing the plaintext or ciphertext", async () => {
    await inboundWebhookSecretService.createSecret(ROTATION_ENDPOINT);
    const list = await inboundWebhookSecretService.listSecrets(ROTATION_ENDPOINT);

    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("secret");
    expect(list[0]).not.toHaveProperty("secretEncrypted");
    expect(list[0]).not.toHaveProperty("secretHash");
    expect(list[0].active).toBe(true);
  });
});
