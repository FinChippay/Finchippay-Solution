/* eslint-env jest */
/**
 * __tests__/auditService.test.js
 * WS5 — structured audit logging service.
 */

"use strict";

const mockRows = [];

const mockKnexBuilder = {
  where: jest.fn(function () {
    return this;
  }),
  orderBy: jest.fn(function () {
    return this;
  }),
  limit: jest.fn(function () {
    return this;
  }),
  offset: jest.fn(function () {
    return this;
  }),
  insert: jest.fn(async (row) => {
    mockRows.push(row);
    return [1];
  }),
  then: undefined,
};

const mockKnex = jest.fn(() => mockKnexBuilder);

jest.mock("../src/db/connection", () => mockKnex);
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const auditService = require("../src/services/auditService");

describe("auditService (WS5)", () => {
  beforeEach(() => {
    mockRows.length = 0;
    jest.clearAllMocks();
  });

  it("records an audit entry with actor, action, outcome and resource", async () => {
    const ok = await auditService.record({
      actor: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      action: "webhook.register",
      resourceType: "webhook",
      resourceId: "wh-1",
      targetPublicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      outcome: "success",
    });

    expect(ok).toBe(true);
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({
      actor: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      action: "webhook.register",
      resource_type: "webhook",
      resource_id: "wh-1",
      target_public_key: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      outcome: "success",
    });
  });

  it("never writes raw payload PII into the audit trail", async () => {
    await auditService.record({
      actor: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      action: "scheduledTransaction.execute",
      resourceType: "scheduledTransaction",
      resourceId: "sch-1",
      outcome: "failure",
    });

    const row = mockRows[0];
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("memo");
    expect(serialized).not.toContain("xdr");
    expect(serialized).not.toContain("secret");
  });

  it("records failure outcomes for rejected operations", async () => {
    await auditService.record({
      actor: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX",
      action: "webhook.delete",
      resourceType: "webhook",
      resourceId: "wh-2",
      outcome: "failure",
      correlationId: "corr-123",
    });

    expect(mockRows[0].outcome).toBe("failure");
    expect(mockRows[0].correlation_id).toBe("corr-123");
  });

  it("never throws when the audit insert fails (audit must not break the mutation)", async () => {
    mockKnexBuilder.insert.mockRejectedValueOnce(new Error("db down"));

    const ok = await auditService.record({ actor: "G...", action: "test.action" });
    expect(ok).toBe(false);
  });

  it("query filters by actor/action/resource and orders newest first", async () => {
    await auditService.query({
      actor: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      action: "webhook.register",
      resourceId: "wh-1",
      limit: 50,
      offset: 10,
    });

    expect(mockKnexBuilder.where).toHaveBeenCalledWith(
      "actor",
      "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
    );
    expect(mockKnexBuilder.where).toHaveBeenCalledWith("action", "webhook.register");
    expect(mockKnexBuilder.where).toHaveBeenCalledWith("resource_id", "wh-1");
    expect(mockKnexBuilder.orderBy).toHaveBeenCalledWith("created_at", "desc");
    expect(mockKnexBuilder.limit).toHaveBeenCalledWith(50);
    expect(mockKnexBuilder.offset).toHaveBeenCalledWith(10);
  });
});
