/* eslint-env jest */
/**
 * __tests__/submitPendingOwnership.test.js
 * submitPendingExecution:
 *  - WS2: the submitted XDR must originate from the pending execution's owner.
 *  - WS3: an atomic claim prevents two concurrent submissions from both
 *    reaching Horizon.
 */
"use strict";

const OWNER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

jest.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR: jest.fn() },
  Networks: { TESTNET: "testnet", PUBLIC: "public" },
  Asset: jest.fn(),
  Memo: { text: jest.fn() },
  Operation: { payment: jest.fn() },
}));

jest.mock("../src/utils/asset", () => ({ normalizeAsset: (a) => a || "XLM" }));
jest.mock("../src/services/webhookService", () => ({
  getWebhooksByPublicKey: jest.fn(),
  deliverWebhook: jest.fn(),
}));
jest.mock("../src/config/stellar", () => ({
  server: { submitTransaction: jest.fn(), loadAccount: jest.fn() },
}));
jest.mock("../src/services/stellarService", () => ({ validatePublicKey: jest.fn() }));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const mockPendingRow = {
  id: "pe-1",
  owner_pk: OWNER,
  status: "awaiting_signature",
  error: null,
  submitted_hash: null,
  resolved_at: null,
};

// Test-accessible knex state (mock-prefixed so it may be referenced inside the
// jest.mock factory below).
const mockKnexConfig = { pending: mockPendingRow };

jest.mock("../src/db/connection", () => {
  const mockKnexFn = jest.fn(() => {
    const wheres = [];
    const builder = {
      where(col, val) {
        wheres.push([col, val]);
        return builder;
      },
      first() {
        const p = mockKnexConfig.pending;
        if (!p) return Promise.resolve(null);
        const ok = wheres.every(([c, v]) => {
          if (c === "id") return p.id === v;
          if (c === "status") return p.status === v;
          return true;
        });
        return Promise.resolve(ok ? p : null);
      },
      update(patch) {
        const p = mockKnexConfig.pending;
        if (!p) return Promise.resolve(0);
        const ok = wheres.every(([c, v]) => {
          if (c === "id") return p.id === v;
          if (c === "status") return p.status === v;
          return true;
        });
        if (!ok) return Promise.resolve(0);
        Object.assign(p, patch);
        return Promise.resolve(1);
      },
    };
    return builder;
  });
  return mockKnexFn;
});

const { TransactionBuilder } = require("@stellar/stellar-sdk");
const { server } = require("../src/config/stellar");
const { submitPendingExecution } = require("../src/services/scheduledTransactionService");

describe("submitPendingExecution — ownership + atomic claim (WS2/WS3)", () => {
  beforeEach(() => {
    Object.assign(mockPendingRow, {
      id: "pe-1",
      owner_pk: OWNER,
      status: "awaiting_signature",
      error: null,
      submitted_hash: null,
      resolved_at: null,
    });
    mockKnexConfig.pending = mockPendingRow;
    jest.clearAllMocks();
    TransactionBuilder.fromXDR.mockReturnValue({ source: OWNER });
    server.submitTransaction.mockResolvedValue({ hash: "txhash123" });
  });

  it("submits a valid owner-signed XDR and marks the execution submitted", async () => {
    const result = await submitPendingExecution("pe-1", "base64-xdr");
    expect(result).toEqual({ status: "submitted", hash: "txhash123" });
    expect(server.submitTransaction).toHaveBeenCalledTimes(1);
    expect(mockPendingRow.status).toBe("submitted");
    expect(mockPendingRow.submitted_hash).toBe("txhash123");
  });

  it("rejects an XDR whose source differs from the pending owner with 403 (WS2)", async () => {
    TransactionBuilder.fromXDR.mockReturnValue({ source: OTHER });

    await expect(submitPendingExecution("pe-1", "base64-xdr")).rejects.toMatchObject({
      status: 403,
    });
    expect(server.submitTransaction).not.toHaveBeenCalled();
    expect(mockPendingRow.status).toBe("awaiting_signature");
  });

  it("rejects an unparseable XDR with 400 before any state change", async () => {
    TransactionBuilder.fromXDR.mockImplementation(() => {
      throw new Error("Bad base64");
    });

    await expect(submitPendingExecution("pe-1", "not-an-xdr")).rejects.toMatchObject({
      status: 400,
    });
    expect(server.submitTransaction).not.toHaveBeenCalled();
    expect(mockPendingRow.status).toBe("awaiting_signature");
  });

  it("returns 409 for an execution that is no longer awaiting signature", async () => {
    mockPendingRow.status = "submitted";

    await expect(submitPendingExecution("pe-1", "base64-xdr")).rejects.toMatchObject({
      status: 409,
    });
    expect(server.submitTransaction).not.toHaveBeenCalled();
  });

  it("never double-submits under concurrent calls (atomic claim, WS3)", async () => {
    const results = await Promise.allSettled([
      submitPendingExecution("pe-1", "base64-xdr"),
      submitPendingExecution("pe-1", "base64-xdr"),
    ]);

    expect(server.submitTransaction).toHaveBeenCalledTimes(1);
    const settled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(settled).toHaveLength(1);
    expect(settled[0].value.status).toBe("submitted");
    // The losing caller gets a clean 4xx, not a duplicate Horizon submission.
    if (rejected.length) {
      expect(rejected[0].reason).toHaveProperty("status");
      expect([404, 409]).toContain(rejected[0].reason.status);
    }
  });

  it("returns 404 for a missing pending execution", async () => {
    mockKnexConfig.pending = null;

    await expect(submitPendingExecution("missing", "base64-xdr")).rejects.toMatchObject({
      status: 404,
    });
    expect(server.submitTransaction).not.toHaveBeenCalled();
  });
});
