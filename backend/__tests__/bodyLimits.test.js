/**
 * __tests__/bodyLimits.test.js
 * Tests for JSON body size limits and Content-Type enforcement (#81).
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");

describe("Content-Type enforcement (#81)", () => {
  it("rejects a POST with a non-JSON Content-Type with 415", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Content-Type", "text/plain")
      .send("publicKey=x&url=y&secret=z");

    expect(res.status).toBe(415);
    expect(res.body.error.message).toMatch(/application\/json/i);
  });

  it("accepts application/json with a charset parameter", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify({ url: "https://x.test/hook" }));

    // Passed Content-Type enforcement — rejected downstream for missing
    // fields (400), not for Content-Type (415).
    expect(res.status).not.toBe(415);
    expect(res.status).toBe(400);
  });
});

describe("Global 100kb JSON body limit (#81)", () => {
  it("returns 413 for a body over 100kb on a standard route", async () => {
    const oversized = "a".repeat(150 * 1024);
    const res = await request(app)
      .post("/api/webhooks")
      .send({
        publicKey: `G${"A".repeat(55)}`,
        url: "https://x.test/hook",
        secret: "supersecret",
        padding: oversized,
      });

    expect(res.status).toBe(413);
    expect(res.body.error.message).toMatch(/exceeds|too large/i);
  });
});

describe("/api/turrets 512kb body limit override (#81)", () => {
  it("accepts a body over the global 100kb limit but under 512kb", async () => {
    const payload = "a".repeat(200 * 1024);
    const res = await request(app)
      .post("/api/turrets/challenge")
      .send({ ownerPublicKey: "invalid-key", type: "dca", padding: payload });

    // Body was parsed successfully (not rejected for size) — request fails
    // downstream on public key validation instead.
    expect(res.status).not.toBe(413);
  });

  it("returns 413 for a body over 512kb", async () => {
    const oversized = "a".repeat(600 * 1024);
    const res = await request(app)
      .post("/api/turrets/challenge")
      .send({ ownerPublicKey: "invalid-key", type: "dca", padding: oversized });

    expect(res.status).toBe(413);
    expect(res.body.error.message).toMatch(/exceeds|too large/i);
  });
});
