/**
 * __tests__/validation.test.js
 * Tests for the Zod validation layer:
 *   - src/validation/schemas.js    (per-route-group schemas)
 *   - src/validation/middleware.js (validate() + zodErrorHandler)
 *
 * Covers the acceptance criteria:
 *   - invalid inputs return 400 with { error, details: { field: [messages] } }
 *   - controllers receive parsed data on req.validated
 */

"use strict";

const express = require("express");
const request = require("supertest");
const { ZodError, z } = require("zod");

const {
  validate,
  zodErrorHandler,
  formatZodError,
} = require("../src/validation/middleware");
const {
  tipSchema,
  registerWebhookSchema,
  registerUsernameSchema,
  scheduleTransactionSchema,
  federationQuerySchema,
  sep24InteractiveSchema,
  sep24TransactionQuerySchema,
  paymentsQuerySchema,
  turretChallengeSchema,
  idParamSchema,
  stellarAddress,
} = require("../src/validation/schemas");

const VALID_KEY_1 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const VALID_KEY_2 = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

/** Mount a tiny app that validates `source` with `schema` and echoes back
 * whatever landed on req.validated. */
function appFor(schema, source = "body", options) {
  const app = express();
  app.use(express.json());
  app.use("/test", validate(schema, source, options), (req, res) =>
    res.json({ validated: req.validated }),
  );
  return app;
}

// ─── 1. tipSchema ─────────────────────────────────────────────────────────────

describe("tipSchema (POST /api/tips)", () => {
  const app = appFor(tipSchema);
  const validTip = {
    senderPublicKey: VALID_KEY_1,
    creatorPublicKey: VALID_KEY_2,
    amount: "10.5",
  };

  it("accepts a valid tip and applies the asset default + keeps validated data", async () => {
    const res = await request(app).post("/test").send(validTip);
    expect(res.status).toBe(200);
    expect(res.body.validated.asset).toBe("XLM"); // Zod default applied
    expect(res.body.validated.senderPublicKey).toBe(VALID_KEY_1);
  });

  it("rejects an invalid sender key with 400 + structured details", async () => {
    const res = await request(app)
      .post("/test")
      .send({ ...validTip, senderPublicKey: "not-a-key" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar public key format");
    expect(Array.isArray(res.body.details.senderPublicKey)).toBe(true);
    expect(res.body.details.senderPublicKey).toContain(
      "Invalid Stellar public key format",
    );
  });

  it("rejects a non-numeric amount string", async () => {
    const res = await request(app)
      .post("/test")
      .send({ ...validTip, amount: "lots" });

    expect(res.status).toBe(400);
    expect(res.body.details.amount).toBeDefined();
  });

  it("rejects a zero amount via the positive-number .refine()", async () => {
    const res = await request(app)
      .post("/test")
      .send({ ...validTip, amount: "0" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("amount must be a positive number");
    expect(res.body.details.amount).toContain(
      "amount must be a positive number",
    );
  });

  it("rejects a memo longer than 28 chars (Stellar text-memo limit)", async () => {
    const res = await request(app)
      .post("/test")
      .send({ ...validTip, memo: "x".repeat(29) });

    expect(res.status).toBe(400);
    expect(res.body.details.memo).toBeDefined();
  });
});

// ─── 2. registerWebhookSchema ─────────────────────────────────────────────────

describe("registerWebhookSchema (POST /api/webhooks)", () => {
  const app = appFor(registerWebhookSchema);

  it("reports which fields are required when missing", async () => {
    const res = await request(app)
      .post("/test")
      .send({ url: "https://x.test/hook" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
    expect(res.body.details.publicKey).toBeDefined();
    expect(res.body.details.secret).toBeDefined();
  });

  it("rejects a weak signing secret", async () => {
    const res = await request(app).post("/test").send({
      publicKey: VALID_KEY_1,
      url: "https://x.test/hook",
      secret: "short",
    });

    expect(res.status).toBe(400);
    expect(res.body.details.secret).toContain(
      "Secret must be at least 8 characters for HMAC-SHA256 security",
    );
  });

  it("rejects a malformed URL", async () => {
    const res = await request(app).post("/test").send({
      publicKey: VALID_KEY_1,
      url: "not a url",
      secret: "supersecret",
    });

    expect(res.status).toBe(400);
    expect(res.body.details.url).toContain("Invalid URL format");
  });
});

// ─── 3. registerUsernameSchema ────────────────────────────────────────────────

describe("registerUsernameSchema (POST /api/accounts/register)", () => {
  const app = appFor(registerUsernameSchema);

  it("rejects a short username with field-level details", async () => {
    const res = await request(app)
      .post("/test")
      .send({ username: "ab", publicKey: VALID_KEY_1 });

    expect(res.status).toBe(400);
    expect(res.body.details.username).toBeDefined();
  });

  it("rejects when both fields are missing and lists both in details", async () => {
    const res = await request(app).post("/test").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("username and publicKey are required");
    expect(Object.keys(res.body.details).sort()).toEqual([
      "publicKey",
      "username",
    ]);
  });
});

// ─── 4. scheduleTransactionSchema ─────────────────────────────────────────────

describe("scheduleTransactionSchema (POST /api/scheduled-txns)", () => {
  const app = appFor(scheduleTransactionSchema);

  it("rejects a non ISO-8601 submitAt via .refine()", async () => {
    const res = await request(app).post("/test").send({
      signedXDR: "AAAAAgAAAAC...",
      submitAt: "not-a-date",
      publicKey: "GABC123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("valid ISO 8601 date");
  });

  it("accepts the legacy placeholder publicKey (presence-only check)", async () => {
    const res = await request(app).post("/test").send({
      signedXDR: "AAAAAgAAAAC...",
      submitAt: "2026-08-01T12:00:00Z",
      publicKey: "GABC123",
    });

    expect(res.status).toBe(200);
    expect(res.body.validated.submitAt).toBe("2026-08-01T12:00:00Z");
  });
});

// ─── 5. federationQuerySchema ─────────────────────────────────────────────────

describe("federationQuerySchema (GET /federation)", () => {
  const app = appFor(federationQuerySchema, "query");

  it("returns the exact legacy message when q and type are missing", async () => {
    const res = await request(app).get("/test");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required parameters: q and type");
    expect(res.body.details.q).toBeDefined();
  });

  it("rejects an unknown federation type", async () => {
    const res = await request(app)
      .get("/test")
      .query({ q: "user*domain.com", type: "banana" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Invalid type parameter. Must be 'name' or 'id'",
    );
    expect(res.body.details.type).toContain(
      "Invalid type parameter. Must be 'name' or 'id'",
    );
  });
});

// ─── 6. SEP-0024 schemas ──────────────────────────────────────────────────────

describe("SEP-0024 schemas", () => {
  it("sep24InteractiveSchema rejects an invalid Stellar account", async () => {
    const app = appFor(sep24InteractiveSchema);
    const res = await request(app)
      .post("/test")
      .send({ asset_code: "USDC", account: "not-a-valid-key" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid Stellar public key");
    expect(res.body.details.account).toBeDefined();
  });

  it("sep24TransactionQuerySchema requires the id query parameter", async () => {
    const app = appFor(sep24TransactionQuerySchema, "query");
    const res = await request(app).get("/test");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required query parameter: id");
    expect(res.body.details.id).toContain(
      "Missing required query parameter: id",
    );
  });
});

// ─── 7. paymentsQuerySchema coercion/default semantics ────────────────────────

describe("paymentsQuerySchema (GET /api/payments/:publicKey)", () => {
  const app = appFor(paymentsQuerySchema, "query");

  it("defaults limit to 20 and coerces query strings to integers", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.validated.limit).toBe(20);

    const res2 = await request(app).get("/test").query({ limit: "7" });
    expect(res2.body.validated.limit).toBe(7);
  });

  it("caps limit at 100 and rejects limit < 1 or non-numeric", async () => {
    const capped = await request(app).get("/test").query({ limit: "500" });
    expect(capped.status).toBe(200);
    expect(capped.body.validated.limit).toBe(100);

    const zero = await request(app).get("/test").query({ limit: "0" });
    expect(zero.status).toBe(400);
    expect(zero.body.details.limit).toBeDefined();

    const bad = await request(app).get("/test").query({ limit: "abc" });
    expect(bad.status).toBe(400);
  });
});

// ─── 8. turret + id + primitive schemas ───────────────────────────────────────

describe("turretChallengeSchema / idParamSchema / stellarAddress", () => {
  it("rejects an unsupported txFunction type", async () => {
    const app = appFor(turretChallengeSchema);
    const res = await request(app)
      .post("/test")
      .send({ ownerPublicKey: VALID_KEY_1, type: "rebalance", config: {} });

    expect(res.status).toBe(400);
    expect(res.body.details.type).toContain(
      "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'.",
    );
  });

  it("validates path params when source='params'", async () => {
    const app = express();
    app.use(express.json());
    app.get("/things/:id", validate(idParamSchema, "params"), (req, res) =>
      res.json({ validated: req.validated }),
    );

    const ok = await request(app).get("/things/tx-9");
    expect(ok.status).toBe(200);
    expect(ok.body.validated.id).toBe("tx-9");
  });

  it("stellarAddress admits base-32 keys and rejects base-32-invalid chars", () => {
    expect(stellarAddress.safeParse(VALID_KEY_1).success).toBe(true);
    // '1' and '0' are outside the Stellar base-32 alphabet
    expect(stellarAddress.safeParse(`G${"1".repeat(55)}`).success).toBe(false);
    expect(stellarAddress.safeParse(`G${"0".repeat(55)}`).success).toBe(false);
  });
});

// ─── 9. middleware internals ──────────────────────────────────────────────────

describe("validate() middleware internals", () => {
  it("merges params and query validation into one req.validated object", async () => {
    const app = express();
    app.use(express.json());
    app.get(
      "/item/:id",
      validate(idParamSchema, "params"),
      validate(paymentsQuerySchema, "query"),
      (req, res) => res.json({ validated: req.validated }),
    );

    const res = await request(app).get("/item/abc").query({ limit: "3" });
    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({ id: "abc", limit: 3 });
  });

  it("returns a custom legacy error payload when errorResponse is provided", async () => {
    const legacy = {
      isValid: false,
      clarification: "Please provide a payment description.",
    };
    const app = appFor(z.object({ input: z.string().min(1) }), "body", {
      errorResponse: legacy,
    });

    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual(legacy);
  });

  it("zodErrorHandler converts a thrown ZodError into the standard 400 payload", async () => {
    const app = express();
    app.use(express.json());
    app.get("/boom", () => {
      throw stellarAddress.safeParse("nope").error;
    });
    app.use(zodErrorHandler);

    const res = await request(app).get("/boom");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar public key format");
    expect(res.body.details).toBeDefined();
  });

  it("zodErrorHandler passes non-Zod errors through untouched", async () => {
    const app = express();
    app.get("/other", () => {
      throw new Error("something else");
    });
    app.use(zodErrorHandler);
    app.use((err, req, res, next) => {
      void next;
      res.status(500).json({ error: err.message });
    });

    const res = await request(app).get("/other");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("something else");
  });

  it("formatZodError returns a graceful fallback for empty issue lists", () => {
    const err = new ZodError([]);
    expect(formatZodError(err)).toEqual({
      error: "Validation failed",
      details: {},
    });
  });
});
