/**
 * Webhook registry and signed delivery.
 */
"use strict";

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: () => jest.fn(),
          }),
        }),
      }),
    })),
  },
}));

const webhookService = require("../src/services/webhookService");

const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
const ACCOUNT_C = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("webhook registry", () => {
  it("registers and lists webhooks for an account", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret"
    );

    const list = webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://x.test/hook");
    expect(list[0].id).toBe(webhook.id);
  });

  it("scopes listing to the account and supports deletion", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_B,
      "https://x.test/a",
      "secret-aaa"
    );
    webhookService.registerWebhook(ACCOUNT_C, "https://x.test/b", "secret-bbb");

    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(1);
    expect(webhookService.deleteWebhook(webhook.id)).toBe(true);
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(0);
  });
});
