/**
 * __tests__/adminRoutes.test.js
 * Integration tests for the admin API routes and middleware.
 */

"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

const adminRoutes = require("../src/routes/admin");
const { JWT_SECRET } = require("../src/middleware/auth");
const adminService = require("../src/services/adminService");

jest.mock("../src/services/adminService");

describe("Admin Routes", () => {
  let app;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, ADMIN_API_KEY: "test-secret-key" };
    
    app = express();
    app.use(express.json());
    app.use("/api/admin", adminRoutes);

    adminService.getSystemStats.mockResolvedValue({ totalUsers: 10 });
    adminService.getContractStats.mockResolvedValue({ escrows: 5 });
    adminService.getRecentErrors.mockReturnValue({ total: 2, errors: [] });
    adminService.getWebhookHealth.mockResolvedValue({ totalRegistered: 3 });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Authentication", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const res = await request(app).get("/api/admin/stats");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_MISSING_HEADER");
    });

    it("returns 403 when Authorization is not an admin token", async () => {
      const res = await request(app).get("/api/admin/stats").set("Authorization", "Bearer invalid-token");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });

    it("allows access with a valid ADMIN_API_KEY", async () => {
      const res = await request(app).get("/api/admin/stats").set("Authorization", "Bearer test-secret-key");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("allows access with a valid admin JWT", async () => {
      const token = jwt.sign({ publicKey: "G123", role: "admin" }, JWT_SECRET);
      const res = await request(app).get("/api/admin/stats").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("denies access with a valid JWT but without admin role", async () => {
      const token = jwt.sign({ publicKey: "G123", role: "user" }, JWT_SECRET);
      const res = await request(app).get("/api/admin/stats").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    });
  });

  describe("Endpoints", () => {
    const authHeader = { Authorization: "Bearer test-secret-key" };

    it("GET /api/admin/stats", async () => {
      const res = await request(app).get("/api/admin/stats").set(authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.totalUsers).toBe(10);
      expect(adminService.getSystemStats).toHaveBeenCalled();
    });

    it("GET /api/admin/contract-stats", async () => {
      const res = await request(app).get("/api/admin/contract-stats").set(authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.escrows).toBe(5);
      expect(adminService.getContractStats).toHaveBeenCalled();
    });

    it("GET /api/admin/recent-errors", async () => {
      const res = await request(app).get("/api/admin/recent-errors").set(authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(adminService.getRecentErrors).toHaveBeenCalledWith(50);
    });

    it("GET /api/admin/webhook-health", async () => {
      const res = await request(app).get("/api/admin/webhook-health").set(authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.totalRegistered).toBe(3);
      expect(adminService.getWebhookHealth).toHaveBeenCalled();
    });
  });
});
