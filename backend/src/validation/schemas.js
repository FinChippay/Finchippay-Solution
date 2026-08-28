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
const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format");

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
  publicKey: z.string({ required_error: "publicKey is required" }).min(1, "publicKey is required"),
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
  message: "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'.",
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
    .refine((value) => process.env.NODE_ENV !== "production" || value.startsWith("https://"), {
      message: "Webhook URL must use HTTPS in production",
    }),
  secret: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .min(8, "Secret must be at least 8 characters for HMAC-SHA256 security"),
});

const getEventsQuerySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  type: z.string().optional(),
  limit: z
    .preprocess((val) => parseInt(val, 10), z.number().int().min(1).max(100).optional())
    .optional(),
  cursor: z.string().optional(),
});

const replayEventsBodySchema = z
  .object({
    eventIds: z.array(z.string()).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
  })
  .refine((data) => (data.eventIds && data.eventIds.length > 0) || data.since, {
    message: "Either eventIds or since must be provided",
  });

// ─── parse-payment (AI intent parser) ─────────────────────────────────────────

/** POST /api/parse-payment */
const parsePaymentSchema = z.object({
  input: z
    .string({ required_error: "Please provide a payment description." })
    .min(1, "Please provide a payment description."),
});

// ─── receipts / IPFS ────────────────────────────────────────────────────────

const ipfsUploadSchema = z.object({
  metadata: z
    .record(z.unknown(), { required_error: "metadata is required" })
    .refine((value) => Object.keys(value).length > 0, {
      message: "metadata must not be empty",
    }),
});

const ipfsFetchSchema = z.object({
  cid: z.string({ required_error: "cid is required" }).min(1, "cid is required"),
});

const mintWithIpfsSchema = z.object({
  publicKey: z.string({ required_error: "publicKey is required" }).min(1, "publicKey is required"),
  memo: z.string().optional(),
  metadata: z
    .record(z.unknown(), { required_error: "metadata is required" })
    .refine((value) => Object.keys(value).length > 0, {
      message: "metadata must not be empty",
    }),
});

// ─── scheduled transactions ───────────────────────────────────────────────────

const SCHEDULED_FIELDS_REQUIRED = "Missing signedXDR or submitAt";

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
  // Optional: if provided, must match the authenticated user's publicKey
  publicKey: z
    .string()
    .min(1)
    .optional(),
});

// ─── SEP-0024 ─────────────────────────────────────────────────────────────────

const SEP24_FIELDS_REQUIRED = "asset_code and account are required";

/** POST /api/sep24/transactions/{deposit,withdraw}/interactive */
const sep24InteractiveSchema = z.object({
  asset_code: z.string({ required_error: SEP24_FIELDS_REQUIRED }).min(1, SEP24_FIELDS_REQUIRED),
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

// ─── contacts ─────────────────────────────────────────────────────────────────

const contactGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  color: z.string().optional(),
  icon: z.string().optional(),
});

const contactItemSchema = z.object({
  name: z.string().min(1, "Contact name is required"),
  stellar_address: z.string().min(1, "Stellar address is required"),
  federation_address: z.string().optional().nullable(),
  memo: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
});

const contactSyncSchema = z.object({
  groups: z.array(contactGroupSchema).optional().default([]),
  contacts: z.array(contactItemSchema).optional().default([]),
});

// ─── events ───────────────────────────────────────────────────────────────────

/** Query params for GET /api/events/:publicKey */
const eventsQuerySchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: "limit must be a positive integer" })
    .int("limit must be a positive integer")
    .min(1, "limit must be a positive integer")
    .transform((n) => Math.min(n, 100))
    .default(20),
  offset: z.coerce
    .number({ invalid_type_error: "offset must be a non-negative integer" })
    .int("offset must be a non-negative integer")
    .min(0, "offset must be a non-negative integer")
    .default(0),
});

// ─── SEP-0012 (KYC) ───────────────────────────────────────────────────────────

/** POST /api/sep12/customer — submit KYC fields */
const sep12CustomerBodySchema = z.object({
  anchorName: z
    .string({ required_error: "anchorName is required" })
    .min(1, "anchorName is required"),
  fields: z.record(z.unknown(), {
    required_error: "fields object is required",
  }),
});

/** GET /api/sep12/customer — fetch KYC data */
const sep12CustomerQuerySchema = z.object({
  anchorName: z
    .string({ required_error: "The anchorName query parameter is required." })
    .min(1, "The anchorName query parameter is required."),
});

// ─── admin feature flags ──────────────────────────────────────────────────────

/** POST /api/admin/feature-flags/:key/toggle */
const adminToggleFlagSchema = z.object({
  enabled: z.union([z.boolean(), z.null()], {
    required_error: 'Body must include "enabled" as true, false, or null.',
    message: 'Body must include "enabled" as true, false, or null.',
  }),
});

// ─── SEP-0024 deposit / withdraw ──────────────────────────────────────────────

/** POST /api/sep24/deposit and POST /api/sep24/withdraw */
const sep24DepositWithdrawSchema = z.object({
  assetCode: z.string({ required_error: "assetCode is required" }).min(1, "assetCode is required"),
  account: z
    .string({ required_error: "account is required" })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
  assetIssuer: z.string().optional(),
  amount: z.string().optional(),
  destAccount: z.string().optional(),
  anchorName: z.string().optional(),
  token: z.string().optional(),
});

// ─── tokens ───────────────────────────────────────────────────────────────────

/** GET /api/v1/tokens/:contractId/price-history — path params */
const tokenContractIdParamSchema = z.object({
  contractId: z
    .string({ required_error: "contractId is required" })
    .regex(/^C[A-Z2-7]{55}$/, "Invalid Soroban contract ID format"),
});

/** GET /api/v1/tokens/:contractId/price-history — query params */
const tokenPriceHistoryQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
});

// ─── notifications ───────────────────────────────────────────────────────────

const NOTIF_EVENT_TYPES = [
  "payment_received",
  "escrow_released",
  "stream_depleted",
  "multisig_executed",
  "tip_received",
];

/** POST /api/notifications/email */
const registerEmailSchema = z.object({
  publicKey: z
    .string({ required_error: "publicKey is required" })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
  email: z.string({ required_error: "email is required" }).email("Invalid email address format"),
  events: z.array(z.enum(NOTIF_EVENT_TYPES)).optional().default(NOTIF_EVENT_TYPES),
});

/** PUT /api/notifications/email/:publicKey */
const updateEmailSchema = z.object({
  email: z.string().email("Invalid email address format").optional(),
  events: z.array(z.enum(NOTIF_EVENT_TYPES)).optional(),
});

const emailEventsQuerySchema = z.object({
  events: z.array(z.enum(NOTIF_EVENT_TYPES)).optional(),
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
  getEventsQuerySchema,
  replayEventsBodySchema,
  // parse-payment
  parsePaymentSchema,
  // receipts / IPFS
  ipfsUploadSchema,
  ipfsFetchSchema,
  mintWithIpfsSchema,
  // scheduled transactions
  scheduleTransactionSchema,
  // sep24
  sep24InteractiveSchema,
  sep24TransactionQuerySchema,
  // federation
  federationQuerySchema,
  // events
  eventsQuerySchema,
  // sep12
  sep12CustomerBodySchema,
  sep12CustomerQuerySchema,
  // admin feature flags
  adminToggleFlagSchema,
  // sep24 deposit/withdraw
  sep24DepositWithdrawSchema,
  // tokens
  tokenContractIdParamSchema,
  tokenPriceHistoryQuerySchema,
  // notifications
  registerEmailSchema,
  updateEmailSchema,
  emailEventsQuerySchema,
  // contacts
  contactSyncSchema,
};
