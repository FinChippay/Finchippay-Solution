/* eslint-env jest */
/**
 * Integration tests for tips, turrets, analytics, and webhook routes.
 * Closes #49
 */

"use strict";

const request = require("supertest");
const nock = require("nock");

jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));

jest.mock("../src/services/tipsService", () => ({
  recordTip: jest.fn(),
  getTipsReceived: jest.fn(),
  getTipsStats: jest.fn(),
  getTipsSent: jest.fn(),
}));

jest.mock("../src/services/turretsService", () => ({
  createSigningChallenge: jest.fn(),
  deployTxFunction: jest.fn(),
  listDeployments: jest.fn(),
  getDeploymentById: jest.fn(),
  getDeploymentHistory: jest.fn(),
  pauseDeployment: jest.fn(),
  resumeDeployment: jest.fn(),
}));

jest.mock("../src/services/analyticsService", () => ({
  getSummary: jest.fn(),
  getTopRecipients: jest.fn(),
  getActivityByDay: jest.fn(),
}));

jest.mock("../src/services/webhookSubscriptionService", () => ({
  registerWebhook: jest.fn(),
  getWebhooksByPublicKey: jest.fn(),
  getEvents: jest.fn(),
  replayEvents: jest.fn(),
  getEventStats: jest.fn(),
  getDeadDeliveries: jest.fn(),
  retryDeadDeliveries: jest.fn(),
  deleteWebhook: jest.fn(),
}));

const app = require("../src/app");

const tipsService = require("../src/services/tipsService");
const turretsService = require("../src/services/turretsService");
const analyticsService = require("../src/services/analyticsService");
const webhookService = require("../src/services/webhookSubscriptionService");

const VALID_KEY = "GAO6LBHHRHUW6XBLUPLWZHWVISNL6XF6MY722G37WS2JMHVVIEEFN4DR";
const VALID_KEY_2 = "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYGJ2DN5ZKQYTROZXNUAAOXWS7";
const VALID_URL = "https://example.com/webhooks/callback";

function validTip(o) {
  return {
    senderPublicKey: VALID_KEY,
    creatorPublicKey: VALID_KEY_2,
    amount: "10.50",
    asset: "XLM",
    memo: "Thanks!",
    txHash: "a1b2c3d4e5f6",
    ...o,
  };
}

function validTurretDeploy(o) {
  return {
    ownerPublicKey: VALID_KEY,
    type: "swap",
    config: {},
    deploymentHash: "0xdead",
    signedChallengeXDR: "AAAA...",
    ...o,
  };
}

function validWebhook(o) {
  return { publicKey: VALID_KEY, url: VALID_URL, secret: "whsec_test", topics: ["payment"], ...o };
}

afterAll(() => nock.cleanAll());
afterEach(() => {
  nock.cleanAll();
  jest.clearAllMocks();
});

// ─── Tips ───────────────────────────────────────────────────────────────
describe("POST /api/tips", () => {
  it("records a tip and returns 201", async () => {
    tipsService.recordTip.mockResolvedValue({ id: 1, ...validTip() });
    const res = await request(app).post("/api/tips").send(validTip());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.tip.id).toBe(1);
  });
  it("rejects empty body (400)", async () => {
    const res = await request(app).post("/api/tips").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tips/received/:key", () => {
  it("returns received tips (200)", async () => {
    tipsService.getTipsReceived.mockResolvedValue({ data: [{ id: 1 }], total: 1 });
    const res = await request(app).get(`/api/tips/received/${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
  it("rejects invalid key (400)", async () => {
    const res = await request(app).get("/api/tips/received/bad");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tips/stats/:key", () => {
  it("returns stats (200)", async () => {
    tipsService.getTipsStats.mockResolvedValue({ totalTips: 5, totalAmount: "50" });
    const res = await request(app).get(`/api/tips/stats/${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalTips).toBe(5);
  });
});

// ─── Turrets ────────────────────────────────────────────────────────────
describe("POST /api/turrets/challenge", () => {
  it("creates challenge (200)", async () => {
    turretsService.createSigningChallenge.mockResolvedValue({ challengeXDR: "AAAA" });
    const res = await request(app)
      .post("/api/turrets/challenge")
      .send({ ownerPublicKey: VALID_KEY, type: "swap", config: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.challengeXDR).toBe("AAAA");
  });
});

describe("POST /api/turrets/deploy", () => {
  it("deploys and returns 201", async () => {
    turretsService.deployTxFunction.mockResolvedValue({ id: "d1", status: "active" });
    const res = await request(app).post("/api/turrets/deploy").send(validTurretDeploy());
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe("d1");
  });
});

describe("GET /api/turrets", () => {
  it("lists deployments (200)", async () => {
    turretsService.listDeployments.mockResolvedValue([{ id: "d1" }]);
    const res = await request(app).get("/api/turrets");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/turrets/:id", () => {
  it("returns deployment by id (200)", async () => {
    turretsService.getDeploymentById.mockResolvedValue({ id: "d1" });
    const res = await request(app).get("/api/turrets/d1");
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("d1");
  });
});

describe("GET /api/turrets/:id/history", () => {
  it("returns history (200)", async () => {
    turretsService.getDeploymentHistory.mockResolvedValue([{ event: "deployed" }]);
    const res = await request(app).get("/api/turrets/d1/history");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ─── Analytics ──────────────────────────────────────────────────────────
describe("GET /api/analytics/:key/summary", () => {
  it("returns summary (200)", async () => {
    analyticsService.getSummary.mockResolvedValue({ totalTransactions: 8 });
    const res = await request(app).get(`/api/analytics/${VALID_KEY}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalTransactions).toBe(8);
  });
  it("rejects invalid key (400)", async () => {
    const res = await request(app).get("/api/analytics/bad/summary");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/analytics/:key/top-recipients", () => {
  it("returns top recipients (200)", async () => {
    analyticsService.getTopRecipients.mockResolvedValue({
      topRecipients: [{ address: "G...", totalXLMSent: "100" }],
    });
    const res = await request(app).get(`/api/analytics/${VALID_KEY}/top-recipients`);
    expect(res.status).toBe(200);
    expect(res.body.data.topRecipients).toHaveLength(1);
  });
});

describe("GET /api/analytics/:key/activity", () => {
  it("returns activity (200)", async () => {
    analyticsService.getActivityByDay.mockResolvedValue({
      activityByDay: [{ day: "Monday", transactionCount: 5 }],
    });
    const res = await request(app).get(`/api/analytics/${VALID_KEY}/activity`);
    expect(res.status).toBe(200);
    expect(res.body.data.activityByDay).toHaveLength(1);
  });
});

// ─── Webhooks ───────────────────────────────────────────────────────────
describe("POST /api/webhooks", () => {
  it("registers webhook (201)", async () => {
    webhookService.registerWebhook.mockResolvedValue({ id: "wh-1" });
    const res = await request(app).post("/api/webhooks").send(validWebhook());
    expect(res.status).toBe(201);
    expect(res.body.webhook.id).toBe("wh-1");
  });
  it("rejects missing URL (400)", async () => {
    const res = await request(app).post("/api/webhooks").send({ publicKey: VALID_KEY });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/webhooks/:publicKey", () => {
  it("returns webhooks (200)", async () => {
    webhookService.getWebhooksByPublicKey.mockResolvedValue([{ id: "wh-1" }]);
    const res = await request(app).get(`/api/webhooks/${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.webhooks).toHaveLength(1);
  });
});

describe("DELETE /api/webhooks/:id", () => {
  it("deletes webhook (200)", async () => {
    webhookService.deleteWebhook.mockResolvedValue(true);
    const res = await request(app).delete("/api/webhooks/wh-1");
    expect(res.status).toBe(200);
  });
});
