/**
 * __tests__/scheduledTransactions.test.js
 * Unit tests for the scheduled transactions route.
 */

"use strict";

const request = require("supertest");
const express = require("express");

// Mock the service before requiring the route
jest.mock("../src/services/scheduledTransactionService");
const scheduledTransactionService = require("../src/services/scheduledTransactionService");

const app = express();
app.use(express.json());
const scheduledTransactionRoutes = require("../src/routes/scheduledTransactions");
app.use("/api/scheduled-txns", scheduledTransactionRoutes);

describe("Scheduled Transactions Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/scheduled-txns", () => {
    it("returns 201 with scheduled transaction on success", async () => {
      const mockTx = {
        id: "tx-1",
        publicKey: "GABC123",
        submitAt: new Date("2026-08-01T12:00:00Z"),
      };

      scheduledTransactionService.scheduleTransaction.mockReturnValue(mockTx);

      const res = await request(app)
        .post("/api/scheduled-txns")
        .send({
          signedXDR: "AAAAAgAAAAC...",
          submitAt: "2026-08-01T12:00:00Z",
          publicKey: "GABC123",
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Transaction scheduled successfully");
      expect(res.body.id).toBe("tx-1");
      expect(res.body.publicKey).toBe("GABC123");
      expect(scheduledTransactionService.scheduleTransaction).toHaveBeenCalledWith(
        "AAAAAgAAAAC...",
        expect.any(Date),
        "GABC123"
      );
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await request(app)
        .post("/api/scheduled-txns")
        .send({ submitAt: "2026-08-01T12:00:00Z" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/missing/i);
    });

    it("returns 400 when submitAt is not a valid date", async () => {
      const res = await request(app)
        .post("/api/scheduled-txns")
        .send({ signedXDR: "AAAAAgAAAAC...", submitAt: "not-a-date", publicKey: "GABC123" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("valid ISO 8601 date");
    });

    it("forwards service errors via next()", async () => {
      scheduledTransactionService.scheduleTransaction.mockImplementation(() => {
        throw new Error("Service failure");
      });

      const res = await request(app)
        .post("/api/scheduled-txns")
        .send({
          signedXDR: "AAAAAgAAAAC...",
          submitAt: "2026-08-01T12:00:00Z",
          publicKey: "GABC123",
        });

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/scheduled-txns/:publicKey", () => {
    it("returns transactions for a given public key", async () => {
      const mockTxs = [
        { id: "tx-1", publicKey: "GABC123", submitAt: new Date() },
        { id: "tx-2", publicKey: "GABC123", submitAt: new Date() },
      ];

      scheduledTransactionService.getPendingTransactions.mockReturnValue(mockTxs);

      const res = await request(app).get("/api/scheduled-txns/GABC123");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe("tx-1");
      expect(scheduledTransactionService.getPendingTransactions).toHaveBeenCalledWith("GABC123");
    });

    it("returns empty array when no transactions exist", async () => {
      scheduledTransactionService.getPendingTransactions.mockReturnValue([]);

      const res = await request(app).get("/api/scheduled-txns/GABC123");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it("forwards service errors", async () => {
      scheduledTransactionService.getPendingTransactions.mockImplementation(() => {
        throw new Error("DB error");
      });

      const res = await request(app).get("/api/scheduled-txns/GABC123");

      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/scheduled-txns/:id", () => {
    it("returns success message when transaction is cancelled", async () => {
      scheduledTransactionService.cancelTransaction.mockReturnValue(true);

      const res = await request(app).delete("/api/scheduled-txns/tx-1");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Transaction tx-1 cancelled successfully.");
    });

    it("returns 404 when transaction is not found", async () => {
      scheduledTransactionService.cancelTransaction.mockReturnValue(false);

      const res = await request(app).delete("/api/scheduled-txns/tx-999");

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain("not found");
    });

    it("forwards service errors", async () => {
      scheduledTransactionService.cancelTransaction.mockImplementation(() => {
        throw new Error("Delete error");
      });

      const res = await request(app).delete("/api/scheduled-txns/tx-1");

      expect(res.status).toBe(500);
    });
  });
});
