/* eslint-env jest */
/**
 * __tests__/scheduledTransactions.test.js
 * Unit tests for the scheduled transactions route.
 */

"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../src/middleware/auth");

// The scheduled transaction modules import @stellar/stellar-sdk, whose CJS
// build pulls in an ESM-only @noble/hashes dependency that Jest cannot load.
// Stub the SDK surface these modules reference.
jest.mock("@stellar/stellar-sdk", () => {
  const builder = {
    addOperation: () => builder,
    addMemo: () => builder,
    setTimeout: () => builder,
    build: () => ({ toXDR: () => "AAAA" }),
  };
  return {
    Horizon: { Server: jest.fn(() => ({})) },
    Networks: { PUBLIC: "public-network-passphrase", TESTNET: "test-network-passphrase" },
    TransactionBuilder: Object.assign(
      function TransactionBuilder() {
        return builder;
      },
      { fromXDR: jest.fn() },
    ),
    Asset: { native: jest.fn(() => ({})) },
    Memo: { text: jest.fn(() => ({})) },
    Operation: { payment: jest.fn(() => ({})) },
  };
});

// Mock rate limiters to avoid hitting limits in tests
jest.mock("../src/middleware/rateLimit", () => ({
  sensitiveLimiter: (req, res, next) => next(),
  strictLimiter: (req, res, next) => next(),
  authRefreshLimiter: (req, res, next) => next(),
}));

jest.mock("../src/middleware/userRateLimit", () => ({
  userLimiter: (req, res, next) => next(),
}));

// Mock the service before requiring the route
jest.mock("../src/services/scheduledTransactionService");
const scheduledTransactionService = require("../src/services/scheduledTransactionService");

// Mock the scheduledExecutor
jest.mock("../src/services/scheduledExecutor");
const scheduledExecutor = require("../src/services/scheduledExecutor");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

function createApp() {
  const app = express();
  app.use(express.json());
  const scheduledTransactionRoutes = require("../src/routes/scheduledTransactions");
  app.use("/api/scheduled-transactions", scheduledTransactionRoutes);
  return app;
}

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

describe("Scheduled Transactions Routes - Authentication & Authorization", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe("Authentication (verifyJWT)", () => {
    const routes = [
      { method: "post", path: "/api/scheduled-transactions" },
      { method: "post", path: "/api/scheduled-transactions/pending/exec-1/submit" },
      { method: "get", path: "/api/scheduled-transactions/GABC123" },
      { method: "get", path: "/api/scheduled-transactions/GABC123/pending" },
      { method: "put", path: "/api/scheduled-transactions/tx-1" },
      { method: "delete", path: "/api/scheduled-transactions/tx-1" },
      { method: "post", path: "/api/scheduled-transactions/tx-1/execute-now" },
      { method: "get", path: "/api/scheduled-transactions/tx-1/executions" },
    ];

    routes.forEach(({ method, path }) => {
      it(`rejects unauthenticated ${method.toUpperCase()} ${path} with 401`, async () => {
        const res = await request(app)[method](path).send({});
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("AUTH_MISSING_HEADER");
      });
    });
  });

  describe("Authorization - cross-user access (requireOwnSchedule / requireScheduleOwner)", () => {
    it("rejects GET /:publicKey with 403 when accessing another user's schedules", async () => {
      const res = await request(app)
        .get(`/api/scheduled-transactions/${OTHER}`)
        .set("Authorization", `Bearer ${tokenFor(ME)}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects GET /:publicKey/pending with 403 when accessing another user's pending executions", async () => {
      const res = await request(app)
        .get(`/api/scheduled-transactions/${OTHER}/pending`)
        .set("Authorization", `Bearer ${tokenFor(ME)}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects PUT /:id with 403 when updating another user's schedule", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue({
        id: "tx-1",
        owner_pk: OTHER,
      });

      const res = await request(app)
        .put("/api/scheduled-transactions/tx-1")
        .set("Authorization", `Bearer ${tokenFor(ME)}`)
        .send({ amount: "100" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects DELETE /:id with 403 when deleting another user's schedule", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue({
        id: "tx-1",
        owner_pk: OTHER,
      });

      const res = await request(app)
        .delete("/api/scheduled-transactions/tx-1")
        .set("Authorization", `Bearer ${tokenFor(ME)}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects POST /:id/execute-now with 403 when executing another user's schedule", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue({
        id: "tx-1",
        owner_pk: OTHER,
      });

      const res = await request(app)
        .post("/api/scheduled-transactions/tx-1/execute-now")
        .set("Authorization", `Bearer ${tokenFor(ME)}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects GET /:id/executions with 403 when accessing another user's execution history", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue({
        id: "tx-1",
        owner_pk: OTHER,
      });

      const res = await request(app)
        .get("/api/scheduled-transactions/tx-1/executions")
        .set("Authorization", `Bearer ${tokenFor(ME)}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects POST /pending/:id/submit with 403 when submitting another user's pending execution", async () => {
      scheduledTransactionService.getPendingExecutionById.mockResolvedValue({
        id: "exec-1",
        owner_pk: OTHER,
        status: "awaiting_signature",
      });

      const res = await request(app)
        .post("/api/scheduled-transactions/pending/exec-1/submit")
        .set("Authorization", `Bearer ${tokenFor(ME)}`)
        .send({ signedXDR: "AAAAAgAAAAC..." });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });
  });

  describe("Owner operations succeed (happy paths)", () => {
    describe("POST /api/scheduled-transactions", () => {
      it("returns 201 with scheduled transaction for authenticated user", async () => {
        const mockTx = {
          id: "tx-1",
          owner_pk: ME,
          recipient: "GXYZ456",
          amount: "50",
          frequency: "daily",
          start_date: "2026-08-01",
          status: "active",
        };

        scheduledTransactionService.createSchedule.mockResolvedValue(mockTx);

        const res = await request(app)
          .post("/api/scheduled-transactions")
          .set("Authorization", `Bearer ${tokenFor(ME)}`)
          .send({
            signedXDR: "AAAAAgAAAAC...",
            submitAt: "2026-08-01T00:00:00Z",
          });

        expect(res.status).toBe(201);
        expect(res.body.id).toBe("tx-1");
        expect(res.body.owner_pk).toBe(ME);
        expect(scheduledTransactionService.createSchedule).toHaveBeenCalledWith(
          expect.objectContaining({
            signedXDR: "AAAAAgAAAAC...",
            submitAt: expect.any(Date),
            ownerPk: ME,
          }),
        );
      });
    });

    describe("GET /api/scheduled-transactions/:publicKey", () => {
      it("returns schedules for the authenticated user", async () => {
        const mockSchedules = [
          { id: "tx-1", owner_pk: ME },
          { id: "tx-2", owner_pk: ME },
        ];

        scheduledTransactionService.listSchedules.mockResolvedValue(mockSchedules);

        const res = await request(app)
          .get(`/api/scheduled-transactions/${ME}`)
          .set("Authorization", `Bearer ${tokenFor(ME)}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        // Pagination sorts by id descending, so tx-2 comes first
        expect(res.body.data[0].id).toBe("tx-2");
        expect(scheduledTransactionService.listSchedules).toHaveBeenCalledWith(ME);
      });
    });

    describe("GET /api/scheduled-transactions/:publicKey/pending", () => {
      it("returns pending executions for the authenticated user", async () => {
        const mockPending = [{ id: "execution-1", owner_pk: ME, status: "awaiting_signature" }];

        scheduledTransactionService.listPendingExecutions.mockResolvedValue(mockPending);

        const res = await request(app)
          .get(`/api/scheduled-transactions/${ME}/pending`)
          .set("Authorization", `Bearer ${tokenFor(ME)}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].id).toBe("execution-1");
        expect(scheduledTransactionService.listPendingExecutions).toHaveBeenCalledWith(ME);
      });
    });

    describe("PUT /api/scheduled-transactions/:id", () => {
      it("returns updated schedule for the owner", async () => {
        const mockSchedule = { id: "tx-1", owner_pk: ME };
        const mockUpdated = { id: "tx-1", amount: "100" };

        scheduledTransactionService.getScheduleById.mockResolvedValue(mockSchedule);
        scheduledTransactionService.updateSchedule.mockResolvedValue(mockUpdated);

        const res = await request(app)
          .put("/api/scheduled-transactions/tx-1")
          .set("Authorization", `Bearer ${tokenFor(ME)}`)
          .send({ amount: "100" });

        expect(res.status).toBe(200);
        expect(res.body.amount).toBe("100");
        expect(scheduledTransactionService.updateSchedule).toHaveBeenCalledWith("tx-1", {
          amount: "100",
        });
      });
    });

    describe("DELETE /api/scheduled-transactions/:id", () => {
      it("returns success message when owner deletes schedule", async () => {
        const mockSchedule = { id: "tx-1", owner_pk: ME };

        scheduledTransactionService.getScheduleById.mockResolvedValue(mockSchedule);
        scheduledTransactionService.deleteSchedule.mockResolvedValue(true);

        const res = await request(app)
          .delete("/api/scheduled-transactions/tx-1")
          .set("Authorization", `Bearer ${tokenFor(ME)}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Scheduled transaction tx-1 deleted.");
      });
    });

    describe("POST /api/scheduled-transactions/:id/execute-now", () => {
      it("returns execution result for the owner", async () => {
        const mockSchedule = { id: "tx-1", owner_pk: ME };
        const mockResult = { success: true, executionId: "exec-1", hash: "abc123" };

        scheduledTransactionService.getScheduleById.mockResolvedValue(mockSchedule);
        scheduledExecutor.executeNow.mockResolvedValue(mockResult);

        const res = await request(app)
          .post("/api/scheduled-transactions/tx-1/execute-now")
          .set("Authorization", `Bearer ${tokenFor(ME)}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.executionId).toBe("exec-1");
      });
    });

    describe("GET /api/scheduled-transactions/:id/executions", () => {
      it("returns execution history for the owner", async () => {
        const mockSchedule = { id: "tx-1", owner_pk: ME };
        const mockExecutions = [{ id: "exec-1", schedule_id: "tx-1", status: "submitted" }];

        scheduledTransactionService.getScheduleById.mockResolvedValue(mockSchedule);
        scheduledExecutor.getExecutionHistory.mockResolvedValue(mockExecutions);

        const res = await request(app)
          .get("/api/scheduled-transactions/tx-1/executions")
          .set("Authorization", `Bearer ${tokenFor(ME)}`);

        expect(res.status).toBe(200);
        expect(res.body.scheduleId).toBe("tx-1");
        expect(res.body.executions).toHaveLength(1);
      });
    });

    describe("POST /api/scheduled-transactions/pending/:id/submit", () => {
      it("returns result when owner submits signed XDR", async () => {
        const mockPending = { id: "exec-1", owner_pk: ME, status: "awaiting_signature" };
        const mockResult = { status: "submitted", hash: "abc123" };

        scheduledTransactionService.getPendingExecutionById.mockResolvedValue(mockPending);
        scheduledTransactionService.submitPendingExecution.mockResolvedValue(mockResult);

        const res = await request(app)
          .post("/api/scheduled-transactions/pending/exec-1/submit")
          .set("Authorization", `Bearer ${tokenFor(ME)}`)
          .send({ signedXDR: "AAAAAgAAAAC..." });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("submitted");
        expect(res.body.hash).toBe("abc123");
      });
    });
  });

  describe("Error handling", () => {
    it("returns 404 when schedule not found for PUT", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue(null);

      const res = await request(app)
        .put("/api/scheduled-transactions/tx-999")
        .set("Authorization", `Bearer ${tokenFor(ME)}`)
        .send({ amount: "100" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RES_NOT_FOUND");
    });

    it("returns 404 when schedule not found for DELETE", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue(null);

      const res = await request(app)
        .delete("/api/scheduled-transactions/tx-999")
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RES_NOT_FOUND");
    });

    it("returns 404 when schedule not found for execute-now", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/scheduled-transactions/tx-999/execute-now")
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RES_NOT_FOUND");
    });

    it("returns 404 when schedule not found for executions", async () => {
      scheduledTransactionService.getScheduleById.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/scheduled-transactions/tx-999/executions")
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RES_NOT_FOUND");
    });

    it("returns 404 when pending execution not found for submit", async () => {
      scheduledTransactionService.getPendingExecutionById.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/scheduled-transactions/pending/exec-999/submit")
        .set("Authorization", `Bearer ${tokenFor(ME)}`)
        .send({ signedXDR: "AAAAAgAAAAC..." });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RES_NOT_FOUND");
    });
  });
});