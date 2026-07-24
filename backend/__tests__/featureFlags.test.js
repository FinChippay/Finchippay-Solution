/**
 * __tests__/featureFlags.test.js
 * Unit and integration tests for the feature flags system (#103).
 *
 * Covers:
 *  - featureFlagsService: loadFlags, evaluateFlag, toggleFlag, getFlagsForClient
 *  - GET  /api/features            (public client endpoint)
 *  - GET  /api/admin/feature-flags (admin endpoint, requires JWT)
 *  - POST /api/admin/feature-flags/:key/toggle (admin toggle, requires JWT)
 */

"use strict";

const request = require("supertest");
const jwt     = require("jsonwebtoken");

// ─── Service unit tests ───────────────────────────────────────────────────────

describe("featureFlagsService", () => {
  let service;

  beforeEach(() => {
    // Re-require so each test group starts from a clean in-memory state.
    jest.resetModules();
    service = require("../src/services/featureFlagsService");
    service.loadFlags();
  });

  describe("loadFlags", () => {
    it("loads flags from featureFlags.json without throwing", () => {
      expect(() => service.loadFlags()).not.toThrow();
    });

    it("getAllFlags returns an array with at least one flag", () => {
      const flags = service.getAllFlags();
      expect(Array.isArray(flags)).toBe(true);
      expect(flags.length).toBeGreaterThan(0);
    });

    it("every flag has required fields: key, description, rolloutPercent, owner, createdAt", () => {
      const flags = service.getAllFlags();
      for (const flag of flags) {
        expect(typeof flag.key).toBe("string");
        expect(typeof flag.description).toBe("string");
        expect(typeof flag.rolloutPercent).toBe("number");
        expect(typeof flag.owner).toBe("string");
        expect(typeof flag.createdAt).toBe("string");
        expect(typeof flag.enabled).toBe("boolean");
      }
    });
  });

  describe("evaluateFlag", () => {
    it("returns false for an unknown flag key", () => {
      expect(service.evaluateFlag("nonexistent_flag_xyz")).toBe(false);
    });

    it("returns false for new_portfolio when rolloutPercent is 0", () => {
      // new_portfolio is defined with rolloutPercent: 0 in the config.
      expect(service.evaluateFlag("new_portfolio", "production")).toBe(false);
    });

    it("returns false for events_page in production (env disabled)", () => {
      expect(service.evaluateFlag("events_page", "production")).toBe(false);
    });

    it("returns true for streaming_payments in production (100% rollout)", () => {
      expect(service.evaluateFlag("streaming_payments", "production")).toBe(true);
    });

    it("returns true for streaming_payments in development (100% rollout)", () => {
      expect(service.evaluateFlag("streaming_payments", "development")).toBe(true);
    });

    it("returns false for ledger_wallet in production (env disabled)", () => {
      expect(service.evaluateFlag("ledger_wallet", "production")).toBe(false);
    });

    it("returns false for ledger_wallet in staging (env disabled)", () => {
      expect(service.evaluateFlag("ledger_wallet", "staging")).toBe(false);
    });

    it("returns true for ledger_wallet in development (env enabled, 0% rollout → false)", () => {
      // dev env is enabled but rolloutPercent is 0 → still false
      expect(service.evaluateFlag("ledger_wallet", "development")).toBe(false);
    });

    it("respects runtime override: toggleFlag(key, true) forces evaluateFlag to true", () => {
      // new_portfolio is 0% — force it on.
      service.toggleFlag("new_portfolio", true);
      expect(service.evaluateFlag("new_portfolio")).toBe(true);
    });

    it("respects runtime override: toggleFlag(key, false) forces evaluateFlag to false", () => {
      // streaming_payments is 100% — force it off.
      service.toggleFlag("streaming_payments", false);
      expect(service.evaluateFlag("streaming_payments")).toBe(false);
    });

    it("removing override via toggleFlag(key, null) restores config evaluation", () => {
      service.toggleFlag("streaming_payments", false);
      expect(service.evaluateFlag("streaming_payments")).toBe(false);

      service.toggleFlag("streaming_payments", null);
      // After removing the override, production/100% flag should be true again.
      expect(service.evaluateFlag("streaming_payments", "production")).toBe(true);
    });
  });

  describe("toggleFlag", () => {
    it("returns null for an unknown flag", () => {
      expect(service.toggleFlag("does_not_exist", true)).toBeNull();
    });

    it("returns updated flag definition with enabled:true when forced on", () => {
      const result = service.toggleFlag("new_portfolio", true);
      expect(result).not.toBeNull();
      expect(result.key).toBe("new_portfolio");
      expect(result.enabled).toBe(true);
    });

    it("returns updated flag definition with enabled:false when forced off", () => {
      const result = service.toggleFlag("streaming_payments", false);
      expect(result).not.toBeNull();
      expect(result.enabled).toBe(false);
    });

    it("returns flag with config-evaluated state after null reset", () => {
      service.toggleFlag("streaming_payments", false);
      const result = service.toggleFlag("streaming_payments", null);
      // streaming_payments is production/100% so in the test env (development) still true.
      expect(result).not.toBeNull();
      expect(typeof result.enabled).toBe("boolean");
    });
  });

  describe("getFlag", () => {
    it("returns null for an unknown key", () => {
      expect(service.getFlag("not_a_real_flag")).toBeNull();
    });

    it("returns flag definition with enabled field for a known key", () => {
      const flag = service.getFlag("streaming_payments");
      expect(flag).not.toBeNull();
      expect(flag.key).toBe("streaming_payments");
      expect(typeof flag.enabled).toBe("boolean");
    });
  });

  describe("getFlagsForClient", () => {
    it("returns a plain object with boolean values for all flags", () => {
      const map = service.getFlagsForClient();
      expect(typeof map).toBe("object");
      expect(map).not.toBeNull();
      for (const val of Object.values(map)) {
        expect(typeof val).toBe("boolean");
      }
    });

    it("includes at least streaming_payments and new_portfolio keys", () => {
      const map = service.getFlagsForClient();
      expect("streaming_payments" in map).toBe(true);
      expect("new_portfolio" in map).toBe(true);
    });

    it("new_portfolio is false (0% rollout)", () => {
      const map = service.getFlagsForClient();
      // NODE_ENV in Jest is 'test' which resolves to 'development';
      // new_portfolio is env-enabled in dev but rolloutPercent is 0.
      expect(map["new_portfolio"]).toBe(false);
    });
  });
});

// ─── HTTP endpoint tests ──────────────────────────────────────────────────────

describe("Feature flags HTTP endpoints", () => {
  let app;
  let featureFlagsService;
  const JWT_SECRET = process.env.JWT_SECRET || "finchippay_secret_key";
  const TEST_PUBLIC_KEY = "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW";

  function makeToken(publicKey = TEST_PUBLIC_KEY) {
    return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
  }

  beforeAll(() => {
    jest.resetModules();
    // Import app after resetting modules to pick up fresh service state.
    app = require("../src/server");
    featureFlagsService = require("../src/services/featureFlagsService");
    featureFlagsService.loadFlags();
  });

  afterEach(() => {
    // Reset any runtime toggles between tests.
    featureFlagsService.loadFlags();
  });

  // ── GET /api/features ──────────────────────────────────────────────────────

  describe("GET /api/features", () => {
    it("returns 200 with success:true and a features map", async () => {
      const res = await request(app).get("/api/features");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.features).toBe("object");
    });

    it("features map values are all booleans", async () => {
      const res = await request(app).get("/api/features");
      for (const val of Object.values(res.body.features)) {
        expect(typeof val).toBe("boolean");
      }
    });

    it("does not require authentication", async () => {
      const res = await request(app).get("/api/features");
      expect(res.status).not.toBe(401);
    });

    it("includes streaming_payments key", async () => {
      const res = await request(app).get("/api/features");
      expect("streaming_payments" in res.body.features).toBe(true);
    });

    it("new_portfolio is false (0% rollout)", async () => {
      const res = await request(app).get("/api/features");
      expect(res.body.features["new_portfolio"]).toBe(false);
    });
  });

  // ── GET /api/admin/feature-flags ──────────────────────────────────────────

  describe("GET /api/admin/feature-flags", () => {
    it("returns 401 without a JWT", async () => {
      const res = await request(app).get("/api/admin/feature-flags");
      expect(res.status).toBe(401);
    });

    it("returns 200 with valid JWT and full flag list", async () => {
      const token = makeToken();
      const res = await request(app)
        .get("/api/admin/feature-flags")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.flags)).toBe(true);
      expect(res.body.data.count).toBeGreaterThan(0);
    });

    it("each flag in admin response has metadata fields", async () => {
      const token = makeToken();
      const res = await request(app)
        .get("/api/admin/feature-flags")
        .set("Authorization", `Bearer ${token}`);

      for (const flag of res.body.data.flags) {
        expect(typeof flag.key).toBe("string");
        expect(typeof flag.description).toBe("string");
        expect(typeof flag.rolloutPercent).toBe("number");
        expect(typeof flag.owner).toBe("string");
        expect(typeof flag.enabled).toBe("boolean");
      }
    });
  });

  // ── POST /api/admin/feature-flags/:key/toggle ─────────────────────────────

  describe("POST /api/admin/feature-flags/:key/toggle", () => {
    it("returns 401 without a JWT", async () => {
      const res = await request(app)
        .post("/api/admin/feature-flags/new_portfolio/toggle")
        .send({ enabled: true });
      expect(res.status).toBe(401);
    });

    it("toggles new_portfolio on and reflects in /api/features", async () => {
      const token = makeToken();

      // Force on.
      const toggleRes = await request(app)
        .post("/api/admin/feature-flags/new_portfolio/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: true });

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.success).toBe(true);
      expect(toggleRes.body.data.enabled).toBe(true);

      // Client endpoint should now reflect the override.
      const featuresRes = await request(app).get("/api/features");
      expect(featuresRes.body.features["new_portfolio"]).toBe(true);
    });

    it("toggles streaming_payments off", async () => {
      const token = makeToken();

      const toggleRes = await request(app)
        .post("/api/admin/feature-flags/streaming_payments/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: false });

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.data.enabled).toBe(false);

      const featuresRes = await request(app).get("/api/features");
      expect(featuresRes.body.features["streaming_payments"]).toBe(false);
    });

    it("resets an override with enabled:null", async () => {
      const token = makeToken();

      // First force off.
      await request(app)
        .post("/api/admin/feature-flags/streaming_payments/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: false });

      // Then reset.
      const resetRes = await request(app)
        .post("/api/admin/feature-flags/streaming_payments/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: null });

      expect(resetRes.status).toBe(200);
      // After reset, streaming_payments (100% rollout) should be true again.
      expect(resetRes.body.data.enabled).toBe(true);
    });

    it("returns 404 for an unknown flag key", async () => {
      const token = makeToken();
      const res = await request(app)
        .post("/api/admin/feature-flags/not_a_real_flag/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: true });

      expect(res.status).toBe(404);
    });

    it("returns 400 when enabled field is missing from body", async () => {
      const token = makeToken();
      const res = await request(app)
        .post("/api/admin/feature-flags/new_portfolio/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when enabled is an invalid type (string)", async () => {
      const token = makeToken();
      const res = await request(app)
        .post("/api/admin/feature-flags/new_portfolio/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: "yes" });

      expect(res.status).toBe(400);
    });
  });
});
