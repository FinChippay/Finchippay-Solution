/* eslint-env jest */
"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../src/db", () => {
  const mockDb = jest.fn();
  return mockDb;
});

const db = require("../src/db");
const dataRetentionService = require("../src/services/dataRetentionService");

function makeQueryChain(finalValue) {
  const chain = {
    where: jest.fn(() => chain),
    del: jest.fn(async () => finalValue),
    update: jest.fn(async () => finalValue),
    select: jest.fn(async () => finalValue),
    first: jest.fn(async () => finalValue),
    insert: jest.fn(async () => finalValue),
  };
  return chain;
}

describe("dataRetentionService.purgeOldData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATA_RETENTION_DAYS = "30";
  });

  it("purges records older than DATA_RETENTION_DAYS from each in-scope table", async () => {
    db.mockImplementation((table) => {
      if (table === "webhook_deliveries") return makeQueryChain(3);
      if (table === "tips") return makeQueryChain(5);
      if (table === "audit_log") return makeQueryChain(2);
      return makeQueryChain(0);
    });

    const result = await dataRetentionService.purgeOldData();

    expect(result.purged.webhookDeliveries).toBe(3);
    expect(result.purged.tips).toBe(5);
    expect(result.purged.auditLog).toBe(2);
    expect(result.retentionDays).toBe(30);
  });

  it("uses the default 365-day retention period when DATA_RETENTION_DAYS is unset", () => {
    delete process.env.DATA_RETENTION_DAYS;
    expect(dataRetentionService.getRetentionDays()).toBe(365);
  });

  it("writes a data_purge entry to the audit log after a purge run", async () => {
    const auditChain = makeQueryChain(0);
    db.mockImplementation((table) => {
      if (table === "audit_log") return auditChain;
      return makeQueryChain(1);
    });

    await dataRetentionService.purgeOldData();

    expect(auditChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "data_purge" }),
    );
  });

  it("continues purging remaining tables even if one table's purge fails", async () => {
    db.mockImplementation((table) => {
      if (table === "webhook_deliveries") {
        return {
          where: jest.fn(() => ({
            del: jest.fn(async () => {
              throw new Error("db error");
            }),
          })),
        };
      }
      return makeQueryChain(1);
    });

    const result = await dataRetentionService.purgeOldData();

    expect(result.purged.webhookDeliveries).toBe(0);
    expect(result.purged.tips).toBe(1);
    expect(result.purged.auditLog).toBe(1);
  });
});

describe("GDPR delete/export endpoints", () => {
  function buildApp(controller) {
    const app = express();
    app.use(express.json());
    const setValidated = (req, res, next) => {
      req.validated = { params: { publicKey: req.params.publicKey } };
      next();
    };
    app.post("/api/accounts/:publicKey/gdpr-delete", setValidated, controller.gdprDelete);
    app.get("/api/accounts/:publicKey/gdpr-export", setValidated, controller.gdprExport);
    app.use((err, req, res, next) => {
      void next;
      res.status(500).json({ error: err.message, stack: err.stack });
    });
    return app;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("gdpr-delete anonymizes tips and removes the username mapping", async () => {
    jest.doMock("../src/db", () => {
      const mockDb = jest.fn((table) => {
        if (table === "tips") return makeQueryChain(2);
        if (table === "usernames") return makeQueryChain(1);
        return makeQueryChain(0);
      });
      return mockDb;
    });
    const controller = require("../src/controllers/accountController");
    const app = buildApp(controller);

    const res = await request(app).post("/api/accounts/GABCDEF1234567890/gdpr-delete");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.anonymized.tipsAsSender).toBe(2);
    expect(res.body.data.anonymized.usernameMappings).toBe(1);
  });

  it("gdpr-export returns tips and username data for the public key", async () => {
    const fakeTip = { id: 1, sender_pk: "GABCDEF1234567890" };
    jest.doMock("../src/db", () => {
      const mockDb = jest.fn((table) => {
        if (table === "tips") return makeQueryChain([fakeTip]);
        if (table === "usernames") return makeQueryChain({ username: "alice" });
        return makeQueryChain([]);
      });
      return mockDb;
    });
    const controller = require("../src/controllers/accountController");
    const app = buildApp(controller);

    const res = await request(app).get("/api/accounts/GABCDEF1234567890/gdpr-export");

    expect(res.status).toBe(200);
    expect(res.body.data.publicKey).toBe("GABCDEF1234567890");
    expect(res.body.data.username).toBe("alice");
  });
});
