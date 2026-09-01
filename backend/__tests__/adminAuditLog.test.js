/* eslint-env jest */
/**
 * __tests__/adminAuditLog.test.js
 * WS5 — the audit trail must only be queryable by admins.
 */

"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

jest.mock("../src/services/auditService", () => ({
  query: jest.fn(),
}));
const auditService = require("../src/services/auditService");

const { JWT_SECRET } = require("../src/middleware/auth");
const adminAuditLogRoutes = require("../src/routes/adminAuditLog");

const ADMIN = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const USER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: 60 * 60, algorithm: "HS256" });
}

function app() {
  const server = express();
  server.use("/api/admin/audit-log", adminAuditLogRoutes);
  return server;
}

describe("GET /api/admin/audit-log (WS5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const res = await request(app()).get("/api/admin/audit-log");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin user", async () => {
    const res = await request(app())
      .get("/api/admin/audit-log")
      .set("Authorization", `Bearer ${tokenFor(USER)}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the admin allowlist is empty (fails closed)", async () => {
    delete process.env.ADMIN_PUBLIC_KEYS;
    const res = await request(app())
      .get("/api/admin/audit-log")
      .set("Authorization", `Bearer ${tokenFor(ADMIN)}`);
    expect(res.status).toBe(403);
  });

  it("returns audit rows for an admin", async () => {
    process.env.ADMIN_PUBLIC_KEYS = ADMIN;
    auditService.query.mockResolvedValue([
      {
        id: 1,
        actor: ADMIN,
        action: "webhook.register",
        resource_type: "webhook",
        resource_id: "wh-1",
        outcome: "success",
        created_at: "2026-08-25T12:00:00.000Z",
      },
    ]);

    const res = await request(app())
      .get("/api/admin/audit-log?action=webhook.register")
      .set("Authorization", `Bearer ${tokenFor(ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(auditService.query).toHaveBeenCalledWith(
      expect.objectContaining({ action: "webhook.register" }),
    );
  });

  it("caps the page size at 500", async () => {
    process.env.ADMIN_PUBLIC_KEYS = ADMIN;
    auditService.query.mockResolvedValue([]);

    await request(app())
      .get("/api/admin/audit-log?limit=9999")
      .set("Authorization", `Bearer ${tokenFor(ADMIN)}`);

    expect(auditService.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });
});
