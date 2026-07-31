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
app.use("/api/scheduled-transactions", scheduledTransactionRoutes);

describe("Scheduled Transactions Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/scheduled-transactions", () => {
    it("returns 201 with scheduled transaction on success", async () => {
      const mockTx = {
        id: "tx-1",
        ownerPk: "GABC123",
        recipient: "GXYZ456",
        amount: "50",
        frequency: "daily",
        startDate: "2026-08-01",
        status: "active",
      };

      scheduledTransactionService.createSchedule.mockReturnValue(mockTx);

      const res = await request(app)
        .post("/api/scheduled-transactions")
        .send(mockTx);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("tx-1");
      expect(res.body.ownerPk).toBe("GABC123");
      expect(scheduledTransactionService.createSchedule).toHaveBeenCalledWith(
        mockTx,
      );
    });

    it("forwards service errors via next()", async () => {
      scheduledTransactionService.createSchedule.mockImplementation(() => {
        throw new Error("Service failure");
      });

      const res = await request(app)
        .post("/api/scheduled-transactions")
        .send({ ownerPk: "GABC123" });

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/scheduled-transactions/pending/:id/submit", () => {
    it("returns 200 with result on success", async () => {
      const mockResult = {
        success: true,
        txHash: "abcdef123",
      };

      scheduledTransactionService.submitPendingExecution.mockResolvedValue(
        mockResult,
      );

      const res = await request(app)
        .post("/api/scheduled-transactions/pending/execution-1/submit")
        .send({ signedXDR: "AAAAAgAAAAC..." });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.txHash).toBe("abcdef123");
      expect(
        scheduledTransactionService.submitPendingExecution,
      ).toHaveBeenCalledWith("execution-1", "AAAAAgAAAAC...");
    });

    it("returns 400 when signedXDR is missing", async () => {
      const res = await request(app)
        .post("/api/scheduled-transactions/pending/execution-1/submit")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VAL_MISSING_FIELD");
    });
  });

  describe("GET /api/scheduled-transactions/:publicKey", () => {
    it("returns schedules for a given public key", async () => {
      const mockSchedules = [
        { id: "tx-1", ownerPk: "GABC123" },
        { id: "tx-2", ownerPk: "GABC123" },
      ];

      scheduledTransactionService.listSchedules.mockReturnValue(mockSchedules);

      const res = await request(app).get("/api/scheduled-transactions/GABC123");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe("tx-1");
      expect(scheduledTransactionService.listSchedules).toHaveBeenCalledWith(
        "GABC123",
      );
    });
  });

  describe("GET /api/scheduled-transactions/:publicKey/pending", () => {
    it("returns pending executions for a given public key", async () => {
      const mockPending = [
        { id: "execution-1", ownerPk: "GABC123", status: "awaiting_signature" },
      ];

      scheduledTransactionService.listPendingExecutions.mockReturnValue(
        mockPending,
      );

      const res = await request(app).get(
        "/api/scheduled-transactions/GABC123/pending",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe("execution-1");
      expect(
        scheduledTransactionService.listPendingExecutions,
      ).toHaveBeenCalledWith("GABC123");
    });
  });

  describe("PUT /api/scheduled-transactions/:id", () => {
    it("returns updated schedule", async () => {
      const mockUpdated = { id: "tx-1", amount: "100" };
      scheduledTransactionService.updateSchedule.mockReturnValue(mockUpdated);

      const res = await request(app)
        .put("/api/scheduled-transactions/tx-1")
        .send({ amount: "100" });

      expect(res.status).toBe(200);
      expect(res.body.amount).toBe("100");
      expect(scheduledTransactionService.updateSchedule).toHaveBeenCalledWith(
        "tx-1",
        { amount: "100" },
      );
    });
  });

  describe("DELETE /api/scheduled-transactions/:id", () => {
    it("returns success message when schedule is deleted", async () => {
      scheduledTransactionService.deleteSchedule.mockReturnValue(true);

      const res = await request(app).delete("/api/scheduled-transactions/tx-1");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Scheduled transaction tx-1 deleted.");
    });

    it("returns 404 when schedule is not found", async () => {
      scheduledTransactionService.deleteSchedule.mockReturnValue(false);

      const res = await request(app).delete(
        "/api/scheduled-transactions/tx-999",
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RES_NOT_FOUND");
    });
  });
});
