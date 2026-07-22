/**
 * __tests__/sep24.test.js
 * Integration tests for SEP-0024 interactive deposit/withdrawal flow.
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");
const sep24Service = require("../src/services/sep/sep24Service");

describe("SEP-0024 API", () => {
  const validPublicKey =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  beforeEach(() => {
    sep24Service.clearStore();
  });

  describe("GET /.well-known/stellar.toml", () => {
    it("should include TRANSFER_SERVER_SEP0024 in the TOML", async () => {
      const response = await request(app)
        .get("/.well-known/stellar.toml")
        .expect(200)
        .expect("Content-Type", /application\/toml/);

      expect(response.text).toContain("TRANSFER_SERVER_SEP0024=");
      expect(response.text).toContain("FEDERATION_SERVER=");
    });
  });

  // ─── POST /api/sep24/transactions/deposit/interactive ──────────────────────

  describe("POST /api/sep24/transactions/deposit/interactive", () => {
    it("should return interactive_customer_info_needed with url and id", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({
          asset_code: "USDC",
          account: validPublicKey,
        })
        .expect(200);

      expect(response.body).toHaveProperty(
        "type",
        "interactive_customer_info_needed",
      );
      expect(response.body).toHaveProperty("url");
      expect(response.body).toHaveProperty("id");
      expect(typeof response.body.url).toBe("string");
      expect(typeof response.body.id).toBe("string");
      expect(response.body.url).toContain(response.body.id);
    });

    it("should accept optional memo and memo_type", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({
          asset_code: "USDC",
          account: validPublicKey,
          memo: "test-memo",
          memo_type: "text",
        })
        .expect(200);

      expect(response.body.type).toBe("interactive_customer_info_needed");
    });

    it("should accept optional anchor_url override", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({
          asset_code: "USDC",
          account: validPublicKey,
          anchor_url: "https://custom-anchor.example.com",
        })
        .expect(200);

      expect(response.body.url).toContain("https://custom-anchor.example.com");
    });

    it("should return 400 when asset_code is missing", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ account: validPublicKey })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should return 400 when account is missing", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ asset_code: "USDC" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should return 400 for invalid public key format", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({
          asset_code: "USDC",
          account: "not-a-valid-key",
        })
        .expect(400);

      expect(response.body.error).toContain("Invalid Stellar public key");
    });
  });

  // ─── POST /api/sep24/transactions/withdraw/interactive ─────────────────────

  describe("POST /api/sep24/transactions/withdraw/interactive", () => {
    it("should return interactive_customer_info_needed with url and id", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/withdraw/interactive")
        .send({
          asset_code: "USDC",
          account: validPublicKey,
        })
        .expect(200);

      expect(response.body).toHaveProperty(
        "type",
        "interactive_customer_info_needed",
      );
      expect(response.body).toHaveProperty("url");
      expect(response.body).toHaveProperty("id");
    });

    it("should return 400 for missing fields", async () => {
      const response = await request(app)
        .post("/api/sep24/transactions/withdraw/interactive")
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });
  });

  // ─── GET /api/sep24/transaction ────────────────────────────────────────────

  describe("GET /api/sep24/transaction", () => {
    it("should return pending_external status for a new transaction", async () => {
      const initRes = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ asset_code: "USDC", account: validPublicKey });

      const { id } = initRes.body;

      const response = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(response.body.transaction).toBeDefined();
      expect(response.body.transaction.id).toBe(id);
      expect(response.body.transaction.kind).toBe("deposit");
      expect(response.body.transaction.status).toBe("pending_external");
      expect(response.body.transaction.started_at).toBeDefined();
      expect(response.body.transaction.more_info_url).toBeDefined();
    });

    it("should reflect completed status after update", async () => {
      const initRes = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ asset_code: "USDC", account: validPublicKey });

      const { id } = initRes.body;

      // Simulate the anchor completing the transaction
      sep24Service.updateTransactionStatus(id, "completed");

      const response = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(response.body.transaction.status).toBe("completed");
      expect(response.body.transaction.completed_at).toBeDefined();
    });

    it("should reflect error status after update", async () => {
      const initRes = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ asset_code: "USDC", account: validPublicKey });

      const { id } = initRes.body;

      // Simulate the anchor erroring the transaction
      sep24Service.updateTransactionStatus(
        id,
        "error",
        "KYC verification failed",
      );

      const response = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(response.body.transaction.status).toBe("error");
      expect(response.body.transaction.message).toBe("KYC verification failed");
    });

    it("should return 400 when id query parameter is missing", async () => {
      const response = await request(app)
        .get("/api/sep24/transaction")
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Missing required query parameter: id",
      );
    });

    it("should return 404 for non-existent transaction", async () => {
      const response = await request(app)
        .get("/api/sep24/transaction")
        .query({ id: "00000000-0000-0000-0000-000000000000" })
        .expect(404);

      expect(response.body).toHaveProperty("error", "Transaction not found");
    });

    it("should return kind=withdrawal for withdrawal transactions", async () => {
      const initRes = await request(app)
        .post("/api/sep24/transactions/withdraw/interactive")
        .send({ asset_code: "USDC", account: validPublicKey });

      const { id } = initRes.body;

      const response = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(response.body.transaction.kind).toBe("withdrawal");
    });
  });

  // ─── End-to-end flow ────────────────────────────────────────────────────────

  describe("End-to-end deposit flow", () => {
    it("should go through the full lifecycle: initiate → pending_external → completed", async () => {
      // Step 1: Initiate deposit
      const initRes = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ asset_code: "USDC", account: validPublicKey })
        .expect(200);

      expect(initRes.body.type).toBe("interactive_customer_info_needed");
      const { id, url } = initRes.body;
      expect(url).toBeTruthy();

      // Step 2: Poll status — should be pending_external
      const pollRes1 = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(pollRes1.body.transaction.status).toBe("pending_external");

      // Step 3: Simulate user completing KYC (anchor updates status)
      sep24Service.updateTransactionStatus(id, "completed");

      // Step 4: Poll status — should be completed
      const pollRes2 = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(pollRes2.body.transaction.status).toBe("completed");
      expect(pollRes2.body.transaction.completed_at).toBeDefined();
    });

    it("should handle error transition in the full flow", async () => {
      // Initiate
      const initRes = await request(app)
        .post("/api/sep24/transactions/deposit/interactive")
        .send({ asset_code: "USDC", account: validPublicKey });

      const { id } = initRes.body;

      // Simulate error
      sep24Service.updateTransactionStatus(id, "error", "Insufficient funds");

      const pollRes = await request(app)
        .get("/api/sep24/transaction")
        .query({ id })
        .expect(200);

      expect(pollRes.body.transaction.status).toBe("error");
      expect(pollRes.body.transaction.message).toBe("Insufficient funds");
    });
  });
});
