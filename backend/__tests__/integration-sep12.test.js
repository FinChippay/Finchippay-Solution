/**
 * __tests__/integration-sep12.test.js
 * Integration tests for the SEP-12 KYC proxy service and API.
 */

"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

// ─── Mock the sep12Service module ────────────────────────────────────────────

jest.mock("../src/services/sep12Service");
const sep12Service = require("../src/services/sep12Service");

// ─── Build a minimal Express app with auth middleware ─────────────────────────

const { verifyJWT, JWT_SECRET } = require("../src/middleware/auth");

const app = express();
app.use(express.json());
const sep12Routes = require("../src/routes/sep12");
app.use("/api/sep12", sep12Routes);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PUBLIC_KEY =
  "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV";

function authToken(pk = TEST_PUBLIC_KEY) {
  return jwt.sign({ publicKey: pk }, JWT_SECRET, { expiresIn: "15m" });
}

function authHeader(pk) {
  return `Bearer ${authToken(pk)}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SEP-12 KYC Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── POST /api/sep12/customer ─────────────────────────────────────────────

  describe("POST /api/sep12/customer", () => {
    it("returns 401 when no auth header is provided", async () => {
      const res = await request(app)
        .post("/api/sep12/customer")
        .send({
          anchorName: "anchorusd_testnet",
          fields: { first_name: "John" },
        });

      expect(res.status).toBe(401);
    });

    it("returns 400 when anchorName is missing", async () => {
      const res = await request(app)
        .post("/api/sep12/customer")
        .set("Authorization", authHeader())
        .send({ fields: { first_name: "John" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("anchorName");
    });

    it("returns 400 when fields is missing", async () => {
      const res = await request(app)
        .post("/api/sep12/customer")
        .set("Authorization", authHeader())
        .send({ anchorName: "anchorusd_testnet" });

      expect(res.status).toBe(400);
    });

    it("returns 200 with success when KYC fields are submitted", async () => {
      sep12Service.putCustomer.mockResolvedValue({
        publicKey: TEST_PUBLIC_KEY,
        anchorName: "anchorusd_testnet",
        status: "PROCESSING",
        fields: {
          first_name: "John",
          last_name: "Doe",
          email_address: "john@example.com",
        },
        message: "KYC submitted for review",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        anchorUrl: "https://api-testnet.anchorusd.com/sep12",
      });

      const res = await request(app)
        .post("/api/sep12/customer")
        .set("Authorization", authHeader())
        .send({
          anchorName: "anchorusd_testnet",
          fields: {
            first_name: "John",
            last_name: "Doe",
            email_address: "john@example.com",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PROCESSING");
      expect(res.body.data.fields.first_name).toBe("John");

      expect(sep12Service.putCustomer).toHaveBeenCalledWith(
        TEST_PUBLIC_KEY,
        "anchorusd_testnet",
        expect.objectContaining({ first_name: "John" }),
        expect.any(String),
      );
    });

    it("forwards service errors with proper status", async () => {
      const err = new Error("Anchor rejected: invalid country code");
      err.status = 422;

      sep12Service.putCustomer.mockRejectedValue(err);

      const res = await request(app)
        .post("/api/sep12/customer")
        .set("Authorization", authHeader())
        .send({
          anchorName: "anchorusd_testnet",
          fields: { first_name: "John" },
        });

      expect(res.status).toBe(422);
    });
  });

  // ─── GET /api/sep12/customer ──────────────────────────────────────────────

  describe("GET /api/sep12/customer", () => {
    it("returns 401 when no auth header is provided", async () => {
      const res = await request(app).get(
        "/api/sep12/customer?anchorName=anchorusd_testnet",
      );

      expect(res.status).toBe(401);
    });

    it("returns 400 when anchorName is missing", async () => {
      const res = await request(app)
        .get("/api/sep12/customer")
        .set("Authorization", authHeader());

      expect(res.status).toBe(400);
    });

    it("returns 200 with customer data on success", async () => {
      sep12Service.getCustomer.mockResolvedValue({
        publicKey: TEST_PUBLIC_KEY,
        anchorName: "anchorusd_testnet",
        status: "ACCEPTED",
        fields: { first_name: "John", last_name: "Doe" },
        message: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        anchorUrl: "https://api-testnet.anchorusd.com/sep12",
      });

      const res = await request(app)
        .get("/api/sep12/customer?anchorName=anchorusd_testnet")
        .set("Authorization", authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACCEPTED");
      expect(res.body.data.fields.first_name).toBe("John");
    });
  });

  // ─── GET /api/sep12/customer/status ───────────────────────────────────────

  describe("GET /api/sep12/customer/status", () => {
    it("returns 401 when no auth header is provided", async () => {
      const res = await request(app).get(
        "/api/sep12/customer/status?anchorName=anchorusd_testnet",
      );

      expect(res.status).toBe(401);
    });

    it("returns 400 when anchorName is missing", async () => {
      const res = await request(app)
        .get("/api/sep12/customer/status")
        .set("Authorization", authHeader());

      expect(res.status).toBe(400);
    });

    it("returns NONE when no KYC has been submitted", async () => {
      sep12Service.getCustomerStatus.mockResolvedValue({ status: "NONE" });

      const res = await request(app)
        .get("/api/sep12/customer/status?anchorName=anchorusd_testnet")
        .set("Authorization", authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("NONE");
    });

    it("returns ACCEPTED when KYC is verified", async () => {
      sep12Service.getCustomerStatus.mockResolvedValue({
        status: "ACCEPTED",
        message: "Identity verified",
      });

      const res = await request(app)
        .get("/api/sep12/customer/status?anchorName=anchorusd_testnet")
        .set("Authorization", authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACCEPTED");
      expect(res.body.data.message).toBe("Identity verified");
    });

    it("returns REJECTED when KYC was denied", async () => {
      sep12Service.getCustomerStatus.mockResolvedValue({
        status: "REJECTED",
        message: "Unable to verify identity",
      });

      const res = await request(app)
        .get("/api/sep12/customer/status?anchorName=anchorusd_testnet")
        .set("Authorization", authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REJECTED");
    });
  });
});
