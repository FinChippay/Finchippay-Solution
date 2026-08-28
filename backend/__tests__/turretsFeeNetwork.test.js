"use strict";

const { Networks } = require("@stellar/stellar-sdk");
const turretsService = require("../src/services/turretsService");
const { Keypair } = require("@stellar/stellar-sdk");

describe("Turrets Service - Fee and Network Selection", () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = process.env.STELLAR_NETWORK;
  });

  afterAll(() => {
    process.env.STELLAR_NETWORK = originalEnv;
  });

  it("should select the correct network passphrase at runtime", async () => {
    const keypair = Keypair.random();
    const config = {
      intervalMinutes: 60,
      amountQuote: 10,
      quoteAssetCode: "USDC",
    };

    process.env.STELLAR_NETWORK = "mainnet";
    let challenge = await turretsService.createSigningChallenge({
      ownerPublicKey: keypair.publicKey(),
      type: "dca",
      config,
    });
    expect(challenge.networkPassphrase).toBe(Networks.PUBLIC);

    process.env.STELLAR_NETWORK = "testnet";
    challenge = await turretsService.createSigningChallenge({
      ownerPublicKey: keypair.publicKey(),
      type: "dca",
      config,
    });
    expect(challenge.networkPassphrase).toBe(Networks.TESTNET);
  });

  it("should have dynamic fee and fallback logic implicitly tested (it doesn't throw)", async () => {
    const keypair = Keypair.random();
    const challenge = await turretsService.createSigningChallenge({
      ownerPublicKey: keypair.publicKey(),
      type: "dca",
      config: {
        intervalMinutes: 60,
        amountQuote: 10,
        quoteAssetCode: "USDC",
      },
    });
    
    expect(challenge).toBeDefined();
    expect(challenge.challengeXDR).toBeDefined();
  });
});
