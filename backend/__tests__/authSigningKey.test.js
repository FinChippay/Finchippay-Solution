/* eslint-env jest */
/**
 * backend/__tests__/authSigningKey.test.js
 * SEP-0010 challenge response must advertise the server signing public key
 * so clients can detect SERVER_PRIVATE_KEY rotation.
 */
"use strict";

const express = require("express");
const request = require("supertest");

const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const SERVER_SECRET = "SARN6FACWBDFYRPNN4JFRVIPHZRJ67JZ3FVSP2W73BPX2BSXSRI77VNQ";
const SERVER_PUBLIC = "GAEGNDANG24DYL72KCEMFJEMY2NCQSCLBDELSHVV66UFEEJMHBTNG7AX";

const ORIGINAL_SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;
const ORIGINAL_SIGNING_KEY_VERSION = process.env.SIGNING_KEY_VERSION;

// `mock`-prefixed so Jest allows use inside jest.mock factories.
const mockServerSecret = SERVER_SECRET;
const mockServerPublic = SERVER_PUBLIC;
let mockChallengeCounter = 0;

jest.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: (secret) => {
      if (secret !== mockServerSecret) {
        throw new Error("unexpected secret in test");
      }
      return {
        publicKey: () => mockServerPublic,
        secret: () => mockServerSecret,
      };
    },
    random: () => ({
      publicKey: () => "GRANDOM00000000000000000000000000000000000000000000000000",
      secret: () => "SRANDOM000000000000000000000000000000000000000000000000000",
    }),
  },
  Utils: {
    buildChallengeTx: () => {
      mockChallengeCounter += 1;
      return `CHALLENGE_XDR_${mockChallengeCounter}`;
    },
    verifyChallengeTx: jest.fn(),
  },
}));
// Avoid loading better-sqlite3 / knex for this route-focused suite.
jest.mock("../src/db/connection", () => {
  const mock = jest.fn();
  mock.destroy = jest.fn();
  return mock;
});

jest.mock("../src/services/tokenService", () => ({
  getAccessTokenTTLSeconds: () => 900,
  getRefreshTokenTTLSeconds: () => 604800,
  issueTokens: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeToken: jest.fn(),
  revokeTokenFamily: jest.fn(),
  revokeAllUserTokens: jest.fn(),
  revokeSessionById: jest.fn(),
  getActiveSessions: jest.fn(),
  getRefreshTokenData: jest.fn(),
  clearAll: jest.fn(),
}));

function buildApp(authRoutes) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

describe("GET /api/auth signing-key metadata", () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    mockChallengeCounter = 0;
    process.env.SERVER_PRIVATE_KEY = SERVER_SECRET;
    delete process.env.SIGNING_KEY_VERSION;

    // Require after env is set so the cached keypair matches SERVER_PRIVATE_KEY.
    const authRoutes = require("../src/routes/auth");
    app = buildApp(authRoutes);
  });

  afterAll(() => {
    if (ORIGINAL_SERVER_PRIVATE_KEY === undefined) {
      delete process.env.SERVER_PRIVATE_KEY;
    } else {
      process.env.SERVER_PRIVATE_KEY = ORIGINAL_SERVER_PRIVATE_KEY;
    }
    if (ORIGINAL_SIGNING_KEY_VERSION === undefined) {
      delete process.env.SIGNING_KEY_VERSION;
    } else {
      process.env.SIGNING_KEY_VERSION = ORIGINAL_SIGNING_KEY_VERSION;
    }
  });

  it("advertises signingKey matching the configured SERVER_PRIVATE_KEY public key", async () => {
    const res = await request(app).get(`/api/auth?account=${ACCOUNT}`);

    expect(res.status).toBe(200);
    expect(res.body.transaction).toEqual(expect.any(String));
    expect(res.body.networkPassphrase).toEqual(expect.any(String));
    expect(res.body.signingKey).toBe(SERVER_PUBLIC);
    expect(res.body.signingKeyVersion).toEqual(expect.any(String));
    expect(res.body.signingKeyVersion.length).toBeGreaterThan(0);

    // Never expose the private key in the challenge response.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain(SERVER_SECRET);
    expect(res.body).not.toHaveProperty("serverPrivateKey");
    expect(res.body).not.toHaveProperty("secret");
  });

  it("keeps signingKey and signingKeyVersion stable across challenges when configured", async () => {
    const first = await request(app).get(`/api/auth?account=${ACCOUNT}`);
    const second = await request(app).get(`/api/auth?account=${ACCOUNT}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(first.body.signingKey).toBe(SERVER_PUBLIC);
    expect(second.body.signingKey).toBe(first.body.signingKey);
    expect(second.body.signingKeyVersion).toBe(first.body.signingKeyVersion);

    // Challenge XDR itself should still vary (nonce / sequence).
    expect(second.body.transaction).not.toBe(first.body.transaction);
  });

  it("honours SIGNING_KEY_VERSION when set", async () => {
    jest.resetModules();
    mockChallengeCounter = 0;
    process.env.SERVER_PRIVATE_KEY = SERVER_SECRET;
    process.env.SIGNING_KEY_VERSION = "rotation-2026-08-27";

    const authRoutes = require("../src/routes/auth");
    const versionedApp = buildApp(authRoutes);

    const res = await request(versionedApp).get(`/api/auth?account=${ACCOUNT}`);

    expect(res.status).toBe(200);
    expect(res.body.signingKey).toBe(SERVER_PUBLIC);
    expect(res.body.signingKeyVersion).toBe("rotation-2026-08-27");
  });
});

describe("OpenAPI AuthChallengeResponse", () => {
  it("documents signingKey and signingKeyVersion on GET /api/v1/auth", () => {
    const spec = require("../src/swagger");
    const schema = spec.components.schemas.AuthChallengeResponse;

    expect(schema).toBeDefined();
    expect(schema.required).toEqual(
      expect.arrayContaining(["transaction", "networkPassphrase", "signingKey"]),
    );
    expect(schema.properties.signingKey).toBeDefined();
    expect(schema.properties.signingKeyVersion).toBeDefined();

    const getAuth = spec.paths["/api/v1/auth"].get;
    expect(getAuth.responses[200].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/AuthChallengeResponse",
    );
  });
});
