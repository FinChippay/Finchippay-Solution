/* eslint-env jest */
/**
 * pushNotifier: mapping domain events to push notifications.
 *
 * pushService is mocked here — this suite is about which events notify whom and
 * what they say, not about delivery.
 */

"use strict";

jest.mock("../src/services/pushService", () => ({
  sendNotification: jest.fn(),
  isPushEnabled: jest.fn(),
}));

const pushNotifier = require("../src/services/pushNotifier");
const pushService = require("../src/services/pushService");

const ALICE = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const BOB = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";

beforeEach(() => {
  jest.clearAllMocks();
  pushService.isPushEnabled.mockReturnValue(true);
  pushService.sendNotification.mockResolvedValue({
    sent: 1,
    failed: 0,
    pruned: 0,
  });
});

describe("extractAddresses", () => {
  it("finds addresses nested anywhere in a raw event payload", () => {
    const payload = {
      topics: ["receipt", { address: ALICE }],
      data: { nested: { deeper: [BOB] } },
    };

    expect(pushNotifier.extractAddresses(payload)).toEqual([ALICE, BOB]);
  });

  it("de-duplicates repeated addresses", () => {
    const payload = { topics: [ALICE], data: { from: ALICE, to: ALICE } };
    expect(pushNotifier.extractAddresses(payload)).toEqual([ALICE]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a payload with no addresses", { topics: ["init"], data: 42 }],
  ])("returns nothing for %s", (_label, payload) => {
    expect(pushNotifier.extractAddresses(payload)).toEqual([]);
  });

  it("survives a payload containing circular references", () => {
    const payload = { topics: ["receipt"] };
    payload.self = payload;

    expect(pushNotifier.extractAddresses(payload)).toEqual([]);
  });
});

describe("notifyContractEvent", () => {
  it("notifies participants of a payment receipt", async () => {
    await pushNotifier.notifyContractEvent({
      event_type: "receipt",
      payload: { topics: ["receipt", ALICE] },
    });

    expect(pushService.sendNotification).toHaveBeenCalledWith(
      ALICE,
      expect.objectContaining({
        title: "Payment received",
        data: expect.objectContaining({ url: "/dashboard" }),
      }),
    );
  });

  it("points escrow notifications at the escrow page", async () => {
    await pushNotifier.notifyContractEvent({
      event_type: "escrow_create",
      payload: { topics: ["escrow_create", ALICE] },
    });

    expect(pushService.sendNotification).toHaveBeenCalledWith(
      ALICE,
      expect.objectContaining({
        data: expect.objectContaining({ url: "/escrow" }),
      }),
    );
  });

  it("ignores event types with no notification defined", async () => {
    await pushNotifier.notifyContractEvent({
      event_type: "admin_transfer",
      payload: { topics: ["admin_transfer", ALICE] },
    });

    expect(pushService.sendNotification).not.toHaveBeenCalled();
  });

  it("does nothing when push is disabled", async () => {
    pushService.isPushEnabled.mockReturnValue(false);

    await pushNotifier.notifyContractEvent({
      event_type: "receipt",
      payload: { topics: ["receipt", ALICE] },
    });

    expect(pushService.sendNotification).not.toHaveBeenCalled();
  });

  it("notifies every participant it can identify", async () => {
    await pushNotifier.notifyContractEvent({
      event_type: "stream_open",
      payload: { topics: ["stream_open", ALICE], data: { to: BOB } },
    });

    expect(pushService.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("does not throw when delivery rejects", async () => {
    pushService.sendNotification.mockRejectedValue(new Error("boom"));

    await expect(
      pushNotifier.notifyContractEvent({
        event_type: "receipt",
        payload: { topics: ["receipt", ALICE] },
      }),
    ).resolves.toEqual({ notified: 0 });
  });
});

describe("notifyContractEvents", () => {
  it("processes a batch and totals what was delivered", async () => {
    const result = await pushNotifier.notifyContractEvents([
      { event_type: "receipt", payload: { topics: [ALICE] } },
      { event_type: "escrow_claim", payload: { topics: [BOB] } },
      { event_type: "init", payload: { topics: [ALICE] } },
    ]);

    expect(pushService.sendNotification).toHaveBeenCalledTimes(2);
    expect(result.notified).toBe(2);
  });

  it.each([
    ["an empty array", []],
    ["a non-array", null],
  ])("handles %s", async (_label, events) => {
    await expect(pushNotifier.notifyContractEvents(events)).resolves.toEqual({
      notified: 0,
    });
  });
});

describe("notifyTipReceived", () => {
  it("names the amount and asset for the creator", async () => {
    await pushNotifier.notifyTipReceived({
      creatorPublicKey: ALICE,
      amount: "12.5",
      asset: "USDC",
    });

    expect(pushService.sendNotification).toHaveBeenCalledWith(ALICE, {
      title: "Tip received",
      body: "You received 12.5 USDC.",
      data: { url: "/dashboard", eventType: "tip" },
    });
  });

  it("defaults the asset to XLM", async () => {
    await pushNotifier.notifyTipReceived({
      creatorPublicKey: ALICE,
      amount: "3",
    });

    expect(pushService.sendNotification).toHaveBeenCalledWith(
      ALICE,
      expect.objectContaining({ body: "You received 3 XLM." }),
    );
  });

  it("skips when there is no recipient", async () => {
    const result = await pushNotifier.notifyTipReceived({ amount: "1" });

    expect(result).toEqual({ skipped: "missing-recipient" });
    expect(pushService.sendNotification).not.toHaveBeenCalled();
  });

  it("does not throw when delivery rejects", async () => {
    pushService.sendNotification.mockRejectedValue(new Error("boom"));

    await expect(
      pushNotifier.notifyTipReceived({ creatorPublicKey: ALICE, amount: "1" }),
    ).resolves.toEqual({ skipped: "send-failed" });
  });
});
