/**
 * __tests__/integration-parsePayment.test.js
 * Integration tests for the /api/parse-payment endpoint using nock.
 */

"use strict";

const request = require("supertest");
const nock = require("nock");

const app = require("../src/server");

describe("POST /api/parse-payment (integration)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  });

  afterAll(() => {
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("returns 200 with parsed payment intent when Anthropic responds successfully", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(200, {
        content: [
          {
            text: JSON.stringify({
              amount: "100 XLM",
              recipient: "GABC123",
              memo: "invoice #42",
              isValid: true,
              clarification: "",
            }),
          },
        ],
      });

    const res = await request(app)
      .post("/api/parse-payment")
      .send({ input: "Pay 100 XLM to GABC123 for invoice #42" });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe("100 XLM");
    expect(res.body.recipient).toBe("GABC123");
    expect(res.body.memo).toBe("invoice #42");
    expect(res.body.isValid).toBe(true);
  });

  it("returns 400 when input is missing from request body", async () => {
    const res = await request(app)
      .post("/api/parse-payment")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.clarification).toBe("Please provide a payment description.");
  });

  it("returns 500 when Anthropic API returns an error", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(500, { error: { message: "Internal error" } });

    const res = await request(app)
      .post("/api/parse-payment")
      .send({ input: "Send 50 XLM to GABC" });

    expect(res.status).toBe(500);
    expect(res.body.clarification).toBe("Server error. Try again.");
  });

  it("returns 503 when Anthropic API is unavailable", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(503, { error: { message: "Service unavailable" } });

    const res = await request(app)
      .post("/api/parse-payment")
      .send({ input: "Send 10 XLM to GDEF456" });

    expect(res.status).toBe(500);
    expect(res.body.isValid).toBe(false);
  });

  it("returns 501 when ANTHROPIC_API_KEY is not configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await request(app)
      .post("/api/parse-payment")
      .send({ input: "Pay 25 XLM to Alice" });

    expect(res.status).toBe(501);
    expect(res.body.clarification).toContain("ANTHROPIC_API_KEY");

    // Restore for subsequent tests
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  });
});
