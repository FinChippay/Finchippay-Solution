/* eslint-env jest */
"use strict";

const mockChildLog = { info: jest.fn(), error: jest.fn() };
const mockLogger = { child: jest.fn(() => mockChildLog) };

jest.mock("../src/utils/logger", () => mockLogger);
jest.mock("@sentry/node", () => ({
  getCurrentScope: () => ({ setTag: jest.fn(), setContext: jest.fn() }),
}));

const express = require("express");
const request = require("supertest");
const { requestIdMiddleware } = require("../src/middleware/requestId");
const { buildErrorResponse } = require("../src/utils/errorResponse");

describe("end-to-end request correlation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("joins the inbound header, Pino log, response header, and error body", async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/boom", (req, res) => {
      req.log.error({ correlationId: req.id }, "Simulated backend failure");
      res.status(500).json(buildErrorResponse("SRV_INTERNAL"));
    });

    const response = await request(app)
      .get("/boom")
      .set("X-Request-ID", "frontend-backend-trace-643");

    expect(mockLogger.child).toHaveBeenCalledWith({ requestId: "frontend-backend-trace-643" });
    expect(mockChildLog.error).toHaveBeenCalledWith(
      { correlationId: "frontend-backend-trace-643" },
      "Simulated backend failure",
    );
    expect(response.headers["x-request-id"]).toBe("frontend-backend-trace-643");
    expect(response.headers["x-correlation-id"]).toBe("frontend-backend-trace-643");
    expect(response.body.error.correlationId).toBe("frontend-backend-trace-643");
  });

  it("accepts the X-Correlation-ID compatibility header", async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/trace", (req, res) => res.json({ correlationId: req.id }));

    const response = await request(app)
      .get("/trace")
      .set("X-Correlation-ID", "compatibility-trace-643");

    expect(response.body.correlationId).toBe("compatibility-trace-643");
    expect(response.headers["x-request-id"]).toBe("compatibility-trace-643");
  });
});
