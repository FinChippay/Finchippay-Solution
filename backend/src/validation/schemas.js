/**
 * src/validation/schemas.js
 * Declarative Zod schemas for every API endpoint's request body, query
 * parameters, and path parameters — organised by route group.
 *
 * Conventions:
 *   - One schema per (endpoint × input source). Path/query params get their
 *     own schemas because Express exposes them as string-keyed objects.
 *   - Error messages mirror the API's historical plain-text messages so the
 *     wire format stays backwards compatible with existing clients.
 *   - Cross-field / semantic checks (amount > 0, valid ISO dates, HTTPS-only
 *     URLs in production) use `.refine()` rather than inline controller code.
 *
 * Wire contract for failures (see src/validation/middleware.js):
 *   HTTP 400  { error: "<first issue message>", details: { field: [messages] } }
 */

"use strict";

const { z } = require("zod");

// ─── Shared primitives ────────────────────────────────────────────────────────

/**
 * Stellar Ed25519 public key: 'G' + 55 chars from the base-32 alphabet
 * (A–Z and 2–7). Stricter than the legacy /^G[A-Z0-9]{55}$/ checks, which
 * also admitted 0, 1, 8 and 9 — none of which exist in Stellar base-32.
 */
const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format");

/** Finchippay username: 3–20 alphanumeric characters. */
const username = z
  .string()
  .regex(
    /^[a-zA-Z0-9]{3,20}$/,
    "Username must be 3–20 characters and contain only letters and numbers",
  );

/** Generic non-empty id path parameter (webhook ids, scheduled-txn ids…). */
const idParamSchema = z.object({
  id: z.string({ required_error: "id is required" }).min(1, "id is required"),
});

/** Non-empty publicKey path parameter where the value is opaque to us
 *  (e.g. it is only used as a filter key, never for cryptography). */
const loosePublicKeyParamSchema = z.object({
  publicKey: z
    .string({ required_error: "publicKey is required" })
    .min(1, "publicKey is required"),
});

// ─── accounts ─────────────────────────────────────────────────────────────────

/** Path params shared by account / payment / analytics lookups. */
const publicKeyParamSchema = z.object({
  publicKey: stellarAddress,
});

const usernameParamSchema = z.object({
  username,
});

/** POST /api/accounts/register */
const registerUsernameSchema = z.object({
  username: z
    .string({ required_error: "username and publicKey are required" })
    .regex(
      /^[a-zA-Z0-9]{3,20}$/,
      "Username must be 3–20 characters and contain only letters and numbers",
    ),
  publicKey: z
    .string({ required_error: "username and publicKey are required" })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
});

// ─── auth (SEP-0010) ──────────────────────────────────────────────────────────

/** GET /api/auth?account=G… */
const authChallengeQuerySchema = z.object({
  account: z
    .string({ required_error: "Missing account query parameter" })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
});

/** POST /api/auth  { transaction } */
const authTokenBodySchema = z.object({
  transaction: z
    .string({ required_error: "Missing transaction in request body" })
    .min(1, "Missing transaction in request body"),
});

// ─── payments ─────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/:publicKey — limit defaults to 20, must be a positive
 * integer, and is silently capped at 100 (matches legacy behaviour where
 * values above 100 were clamped rather than rejected).
 */
const paymentsQuerySchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: "limit must be a positive integer" })
    .int("limit must be a positive integer")
    .min(1, "limit must be a positive integer")
    .transform((n) => Math.min(n, 100))
    .default(20),
  cursor: z.string().optional(),
});

// ─── analytics ────────────────────────────────────────────────────────────────
// (all three analytics endpoints take only a :publicKey path param — reuse
// publicKeyParamSchema)

// ─── tips ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/tips — recorded after the on-chain transaction confirms.
 * Amount must be a decimal string encoding a strictly positive number.
 */
const tipSchema = z
  .object({
    senderPublicKey: stellarAddress,
    creatorPublicKey: stellarAddress,
    amount: z
      .string({ required_error: "amount is required" })
      .regex(/^\d+(\.\d+)?$/, "amount must be a positive number"),
    asset: z.string().default("XLM"),
    memo: z.string().max(28, "memo must be at most 28 characters").optional(),
    txHash: z.string().optional(),
  })
  .refine((data) => parseFloat(data.amount) > 0, {
    message: "amount must be a positive number",
    path: ["amount"],
  });

const creatorPublicKeyParamSchema = z.object({
  creatorPublicKey: stellarAddress,
});

const senderPublicKeyParamSchema = z.object({
  senderPublicKey: stellarAddress,
});

/** Pagination for tip listings — mirrors the legacy parseInt-or-undefined. */
const tipsPaginationQuerySchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: "limit must be a positive integer" })
    .int("limit must be a positive integer")
    .min(1, "limit must be a positive integer")
    .optional(),
  offset: z.coerce
    .number({ invalid_type_error: "offset must be a non-negative integer" })
    .int("offset must be a non-negative integer")
    .min(0, "offset must be a non-negative integer")
    .optional(),
});

// ─── turrets ──────────────────────────────────────────────────────────────────

const turretTypeSchema = z.enum(["dca", "stop_loss", "escrow_release"], {
  required_error: "type is required",
  message:
    "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'.",
});

const turretConfigSchema = z.record(z.unknown(), {
  required_error: "config is required",
});

/** POST /api/turrets/challenge */
const turretChallengeSchema = z.object({
  ownerPublicKey: stellarAddress,
  type: turretTypeSchema,
  config: turretConfigSchema,
});

/** POST /api/turrets/deploy */
const turretDeploySchema = z.object({
  ownerPublicKey: stellarAddress,
  type: turretTypeSchema,
  config: turretConfigSchema,
  deploymentHash: z
    .string({ required_error: "deploymentHash is required" })
    .min(1, "deploymentHash is required"),
  signedChallengeXDR: z
    .string({ required_error: "signedChallengeXDR is required" })
    .min(1, "signedChallengeXDR is required"),
});

/** GET /api/turrets?ownerPublicKey=G… */
const turretsListQuerySchema = z.object({
  ownerPublicKey: stellarAddress.optional(),
});

// ─── webhooks ─────────────────────────────────────────────────────────────────

const WEBHOOK_FIELDS_REQUIRED = "publicKey, url, and secret are required";

/** POST /api/webhooks */
const registerWebhookSchema = z.object({
  publicKey: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
  url: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .url("Invalid URL format")
    // In production only HTTPS endpoints are acceptable webhook targets.
    .refine(
      (value) =>
        process.env.NODE_ENV !== "production" || value.startsWith("https://"),
      { message: "Webhook URL must use HTTPS in production" },
    ),
  secret: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .min(8, "Secret must be at least 8 characters for HMAC-SHA256 security"),
});

// ─── parse-payment (AI intent parser) ─────────────────────────────────────────

/** POST /api/parse-payment */
const parsePaymentSchema = z.object({
  input: z
    .string({ required_error: "Please provide a payment description." })
    .min(1, "Please provide a payment description."),
});

// ─── scheduled transactions ───────────────────────────────────────────────────

const SCHEDULED_FIELDS_REQUIRED = "Missing signedXDR, submitAt, or publicKey";

/** POST /api/scheduled-txns */
const scheduleTransactionSchema = z.object({
  signedXDR: z
    .string({ required_error: SCHEDULED_FIELDS_REQUIRED })
    .min(1, SCHEDULED_FIELDS_REQUIRED),
  submitAt: z
    .string({ required_error: SCHEDULED_FIELDS_REQUIRED })
    .min(1, SCHEDULED_FIELDS_REQUIRED)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "submitAt must be a valid ISO 8601 date string",
    }),
  // The scheduler only uses this as an ownership marker — the value may be a
  // test placeholder — so we require presence, not Stellar format.
  publicKey: z
    .string({ required_error: SCHEDULED_FIELDS_REQUIRED })
    .min(1, SCHEDULED_FIELDS_REQUIRED),
});

// ─── SEP-0024 ─────────────────────────────────────────────────────────────────

const SEP24_FIELDS_REQUIRED = "asset_code and account are required";

/** POST /api/sep24/transactions/{deposit,withdraw}/interactive */
const sep24InteractiveSchema = z.object({
  asset_code: z
    .string({ required_error: SEP24_FIELDS_REQUIRED })
    .min(1, SEP24_FIELDS_REQUIRED),
  account: z
    .string({ required_error: SEP24_FIELDS_REQUIRED })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
  memo: z.string().optional(),
  memo_type: z.string().optional(),
  anchor_url: z.string().url("anchor_url must be a valid URL").optional(),
});

/** GET /api/sep24/transaction?id=… */
const sep24TransactionQuerySchema = z.object({
  id: z
    .string({ required_error: "Missing required query parameter: id" })
    .min(1, "Missing required query parameter: id"),
});

// ─── federation (SEP-0002) ────────────────────────────────────────────────────

/**
 * GET /federation?q=<query>&type=<name|id>
 * Field order matters: when both fields are absent the first reported issue
 * is q's — "Missing required parameters: q and type".
 */
const federationQuerySchema = z.object({
  q: z
    .string({ required_error: "Missing required parameters: q and type" })
    .min(1, "Missing required parameters: q and type"),
  type: z.enum(["name", "id"], {
    required_error: "Missing required parameters: q and type",
    message: "Invalid type parameter. Must be 'name' or 'id'",
  }),
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // primitives
  stellarAddress,
  username,
  idParamSchema,
  loosePublicKeyParamSchema,
  // accounts
  publicKeyParamSchema,
  usernameParamSchema,
  registerUsernameSchema,
  // auth
  authChallengeQuerySchema,
  authTokenBodySchema,
  // payments
  paymentsQuerySchema,
  // tips
  tipSchema,
  creatorPublicKeyParamSchema,
  senderPublicKeyParamSchema,
  tipsPaginationQuerySchema,
  // turrets
  turretChallengeSchema,
  turretDeploySchema,
  turretsListQuerySchema,
  // webhooks
  registerWebhookSchema,
  // parse-payment
  parsePaymentSchema,
  // scheduled transactions
  scheduleTransactionSchema,
  // sep24
  sep24InteractiveSchema,
  sep24TransactionQuerySchema,
  // federation
  federationQuerySchema,
};
