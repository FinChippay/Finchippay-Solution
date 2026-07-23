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

const knex = require("../src/db/connection");
const webhookService = require("../src/services/webhookService");

const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
const ACCOUNT_C =
  "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

// Clean up the webhooks table before each test to avoid accumulation
beforeEach(async () => {
  await knex("webhooks").del();
});

describe("webhook registry", () => {
  it("registers and lists webhooks for an account", async () => {
    const webhook = await webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );

    const list = await webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://x.test/hook");
    expect(list[0].id).toBe(webhook.id);
  });

  it("scopes listing to the account and supports deletion", async () => {
    const webhook = await webhookService.registerWebhook(
      ACCOUNT_B,
      "https://x.test/a",
      "secret-aaa",
    );
    await webhookService.registerWebhook(
      ACCOUNT_C,
      "https://x.test/b",
      "secret-bbb",
    );

    const listB = await webhookService.getWebhooksByPublicKey(ACCOUNT_B);
    expect(listB).toHaveLength(1);

    const deleted = await webhookService.deleteWebhook(webhook.id);
    expect(deleted).toBe(true);

    const listAfterDelete =
      await webhookService.getWebhooksByPublicKey(ACCOUNT_B);
    expect(listAfterDelete).toHaveLength(0);
  });
});
