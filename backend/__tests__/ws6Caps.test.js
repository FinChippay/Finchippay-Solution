/* eslint-env jest */
/**
 * __tests__/ws6Caps.test.js
 * WS6 — per-account / per-resource caps and limiters:
 *   - MAX_SCHEDULES_PER_ACCOUNT in scheduledTransactionService.createSchedule
 *   - MAX_CSV_ROWS in the CSV batch-upload route
 *   - per-schedule execute-now limiter on POST /:id/execute-now
 */

"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const OWNER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const RECIPIENT = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

// ─── MAX_SCHEDULES_PER_ACCOUNT ───────────────────────────────────────────────

describe("scheduledTransactionService schedule cap (WS6)", () => {
  let knex;
  let scheduledTransactionService;
  let rows;

  beforeEach(() => {
    jest.resetModules();
    rows = [];
    const mockBuilder = {
      filters: [],
      where: jest.fn(function (col, val) {
        this.filters.push({ col, val });
        return this;
      }),
      andWhere: jest.fn(function (col, val) {
        this.filters.push({ col, val });
        return this;
      }),
      count: jest.fn(function () {
        this.isCount = true;
        return this;
      }),
      first: jest.fn(async function () {
        if (this.isCount) {
          const matches = rows.filter((r) => this.filters.every(({ col, val }) => r[col] === val));
          return { cnt: String(matches.length) };
        }
        return rows[0] || null;
      }),
      insert: jest.fn(async (row) => {
        rows.push(row);
        return [1];
      }),
      select: jest.fn(async () => rows),
      orderBy: jest.fn(function () {
        return this;
      }),
    };
    knex = jest.fn(() => mockBuilder);
    jest.doMock("../src/db/connection", () => knex);
    jest.doMock("../src/utils/logger", () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock("../src/config/tracing", () => ({
      getTracer: () => ({
        startSpan: () => ({ setAttributes: jest.fn(), setStatus: jest.fn(), end: jest.fn() }),
      }),
    }));
    jest.doMock("../src/utils/webhookSecretHash", () => ({ hashSecret: jest.fn(() => "h") }));
    jest.doMock("../src/services/auditService", () => ({ record: jest.fn() }));
    // Avoid scheduling real cron jobs / SSE streams
    jest.doMock("node-cron", () => ({ schedule: jest.fn() }));
    jest.doMock("@stellar/stellar-sdk", () => ({
      Horizon: { Server: jest.fn(() => ({})) },
      Networks: { PUBLIC: "pub", TESTNET: "test" },
      TransactionBuilder: Object.assign(function () {}, { fromXDR: jest.fn() }),
      Asset: { native: jest.fn() },
      Memo: { text: jest.fn() },
      Operation: { payment: jest.fn() },
    }));
    scheduledTransactionService = require("../src/services/scheduledTransactionService");
  });

  function makeBody(overrides = {}) {
    return {
      ownerPk: OWNER,
      recipient: RECIPIENT,
      amount: "10",
      asset: "XLM",
      frequency: "daily",
      cronExpression: "0 12 * * *",
      startDate: "2026-08-01",
      ...overrides,
    };
  }

  it("creates a schedule when under the cap", async () => {
    const schedule = await scheduledTransactionService.createSchedule(makeBody());
    expect(schedule).toBeTruthy();
    expect(rows).toHaveLength(1);
  });

  it("rejects creation when the account already has MAX_SCHEDULES_PER_ACCOUNT active schedules", async () => {
    for (let i = 0; i < 50; i++) {
      rows.push({ id: `s-${i}`, owner_pk: OWNER, status: "active" });
    }
    await expect(scheduledTransactionService.createSchedule(makeBody())).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Maximum of 50 active schedules per account"),
    });
    // No new row inserted
    expect(rows).toHaveLength(50);
  });

  it("does not count non-active schedules toward the cap", async () => {
    for (let i = 0; i < 49; i++) {
      rows.push({ id: `s-${i}`, owner_pk: OWNER, status: "active" });
    }
    rows.push({ id: "failed-one", owner_pk: OWNER, status: "failed" });
    const schedule = await scheduledTransactionService.createSchedule(makeBody());
    expect(schedule).toBeTruthy();
  });
});

// ─── MAX_CSV_ROWS ─────────────────────────────────────────────────────────────

describe("POST /api/payments/batch/upload row cap (WS6)", () => {
  let paymentsRouter;
  let csvUploadMiddleware;
  let Papa;

  beforeEach(() => {
    jest.resetModules();
    process.env.MAX_CSV_ROWS = "3";
    // Stub multer-backed middleware to inject a file buffer directly. The
    // Buffer travels through supertest's JSON serialisation, so rebuild it.
    csvUploadMiddleware = (req, _res, next) => {
      const file = req.body.__file;
      req.file = {
        ...file,
        buffer: Buffer.from(file.buffer),
      };
      next();
    };
    jest.doMock("../src/middleware/csvUpload", () => ({ csvUploadMiddleware }));
    // The payments route transitively imports @stellar/stellar-sdk, whose CJS
    // build pulls an ESM-only dependency Jest cannot load; stub the surface the
    // route references so the upload handler runs.
    jest.doMock("@stellar/stellar-sdk", () => ({
      Horizon: { Server: jest.fn(() => ({})) },
      Networks: { PUBLIC: "pub", TESTNET: "test" },
      TransactionBuilder: Object.assign(function () {}, { fromXDR: jest.fn() }),
      Asset: { native: jest.fn() },
      Memo: { text: jest.fn() },
      Operation: { payment: jest.fn() },
    }));
    jest.doMock("../src/middleware/rateLimit", () => ({
      strictLimiter: (_req, _res, next) => next(),
    }));
    jest.doMock("../src/middleware/userRateLimit", () => ({
      userLimiter: (_req, _res, next) => next(),
    }));
    jest.doMock("../src/middleware/sanitization", () => ({
      sanitizePublicKey: (_req, _res, next) => next(),
    }));
    jest.doMock("../src/middleware/auth", () => ({
      verifyJWT: (req, _res, next) => {
        req.user = { publicKey: req.params.publicKey || OWNER };
        next();
      },
    }));
    jest.doMock("../src/utils/errorResponse", () => {
      const { formatErrorResponse } = require("../../shared/errorCodes");
      return {
        sendError: (res, code, opts) => res.status(400).json(formatErrorResponse(code, opts)),
      };
    });
    Papa = require("papaparse");
    paymentsRouter = require("../src/routes/payments");
  });

  it("rejects a CSV that exceeds MAX_CSV_ROWS", async () => {
    const server = express();
    server.use(express.json());
    server.use("/api/payments", paymentsRouter);

    const csv = "recipient,amount,asset\nG1,1,XLM\nG2,2,XLM\nG3,3,XLM\nG4,4,XLM\n";
    const res = await request(server)
      .post("/api/payments/batch/upload")
      .send({
        __file: {
          buffer: Buffer.from(csv),
          originalname: "payments.csv",
          size: csv.length,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_TOO_MANY_ROWS");
  });

  it("accepts a CSV within the row cap", async () => {
    const server = express();
    server.use(express.json());
    server.use("/api/payments", paymentsRouter);

    const csv = "recipient,amount,asset\nG1,1,XLM\nG2,2,XLM\n";
    const res = await request(server)
      .post("/api/payments/batch/upload")
      .send({
        __file: {
          buffer: Buffer.from(csv),
          originalname: "payments.csv",
          size: csv.length,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });
});

// ─── execute-now per-schedule limiter ─────────────────────────────────────────

describe("POST /api/scheduled-transactions/:id/execute-now limiter (WS6)", () => {
  let scheduledRoutes;
  let scheduledExecutor;
  const SCHEDULE_ID = "sch-1";

  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../src/services/scheduledTransactionService", () => ({
      getScheduleById: jest.fn(async () => ({
        id: SCHEDULE_ID,
        owner_pk: OWNER,
        recipient: RECIPIENT,
        amount: "10",
        asset: "XLM",
        frequency: "daily",
        cron_expression: "0 12 * * *",
        start_date: "2026-08-01",
        status: "active",
        next_run_at: new Date().toISOString(),
      })),
      getSchedule: jest.fn(async () => null),
      listSchedules: jest.fn(async () => []),
    }));
    jest.doMock("../src/services/scheduledExecutor", () => ({
      executeNow: jest.fn(async () => ({ success: true, executionId: "ex-1", hash: "h" })),
      getExecutionHistory: jest.fn(async () => []),
    }));
    jest.doMock("../src/middleware/rateLimit", () => ({
      sensitiveLimiter: (_req, _res, next) => next(),
      createInstrumentedLimiter: jest.fn((options) => {
        // Real express-rate-limit so the per-key cap actually blocks.
        const rateLimit = require("express-rate-limit");
        return rateLimit(options);
      }),
    }));
    jest.doMock("../src/middleware/userRateLimit", () => ({
      userLimiter: (_req, _res, next) => next(),
    }));
    jest.doMock("../src/middleware/combinedAuth", () => ({
      // combinedAuth is a factory invoked at module load: combinedAuth("scope")
      combinedAuth: () => (_req, _res, next) => next(),
    }));
    jest.doMock("../src/middleware/auth", () => {
      const realJwt = require("jsonwebtoken");
      return {
        verifyJWT: (req, _res, next) => {
          const token = (req.headers.authorization || "").replace("Bearer ", "");
          req.user = {
            publicKey: realJwt.verify(token, "test-jwt-secret-for-unit-tests-only", {
              algorithms: ["HS256"],
            }).publicKey,
          };
          next();
        },
      };
    });
    scheduledRoutes = require("../src/routes/scheduledTransactions");
    scheduledExecutor = require("../src/services/scheduledExecutor");
  });

  function tokenFor(pk) {
    return jwt.sign({ publicKey: pk }, "test-jwt-secret-for-unit-tests-only", {
      expiresIn: 3600,
      algorithm: "HS256",
    });
  }

  it("allows execute-now calls under the per-schedule cap", async () => {
    const server = express();
    server.use(express.json());
    server.use("/api/scheduled-transactions", scheduledRoutes);

    const res = await request(server)
      .post(`/api/scheduled-transactions/${SCHEDULE_ID}/execute-now`)
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);
    expect(res.status).toBe(200);
    expect(scheduledExecutor.executeNow).toHaveBeenCalledWith(SCHEDULE_ID);
  });

  it("returns 429 once the per-schedule cap is exceeded", async () => {
    const server = express();
    server.use(express.json());
    server.use("/api/scheduled-transactions", scheduledRoutes);

    for (let i = 0; i < 5; i++) {
      const ok = await request(server)
        .post(`/api/scheduled-transactions/${SCHEDULE_ID}/execute-now`)
        .set("Authorization", `Bearer ${tokenFor(OWNER)}`);
      expect(ok.status).toBe(200);
    }
    const blocked = await request(server)
      .post(`/api/scheduled-transactions/${SCHEDULE_ID}/execute-now`)
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);
    expect(blocked.status).toBe(429);
  });
});
