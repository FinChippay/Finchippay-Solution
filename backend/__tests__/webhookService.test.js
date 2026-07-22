/**
 * Webhook registry and signed delivery.
 */
"use strict";

// Tracks the close-handles handed out by `.stream()` so tests can assert
// they were invoked by `closeAllStreams()` during graceful shutdown.
const mockStreamCloseHandles = [];

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: () => {
              const close = jest.fn();
              mockStreamCloseHandles.push(close);
              return close;
            },
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
const ACCOUNT_D = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const ACCOUNT_E = "GCEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";

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

describe("closeAllStreams (graceful shutdown on SIGTERM/SIGINT)", () => {
  it("closes every active Horizon SSE stream so none leak past process exit", async () => {
    webhookService.registerWebhook(
      ACCOUNT_D,
      "https://x.test/shutdown",
      "secret-shutdown"
    );
    const closeHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];
    expect(closeHandle).not.toHaveBeenCalled();

    // Simulates what the process SIGTERM/SIGINT handler in server.js invokes.
    await webhookService.closeAllStreams();

    expect(closeHandle).toHaveBeenCalledTimes(1);
  });

  it("clears activeStreams so a later registration opens a fresh stream", async () => {
    webhookService.registerWebhook(ACCOUNT_E, "https://x.test/a", "secret-a");
    const firstCloseHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];

    await webhookService.closeAllStreams();

    webhookService.registerWebhook(ACCOUNT_E, "https://x.test/b", "secret-b");
    const secondCloseHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];

    expect(secondCloseHandle).not.toBe(firstCloseHandle);
    expect(firstCloseHandle).toHaveBeenCalledTimes(1);
  });

  it("resolves promptly when there are no in-flight deliveries", async () => {
    const start = Date.now();
    await webhookService.closeAllStreams(5000);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
