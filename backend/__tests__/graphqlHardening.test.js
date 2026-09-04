/* eslint-env jest */
/**
 * __tests__/graphqlHardening.test.js
 * Tests for GraphQL depth/complexity limits, introspection gating, and
 * error sanitization (#630).
 *
 * Each test builds its own minimal Express app via mountGraphQL() so it can
 * set env vars (GRAPHQL_MAX_DEPTH, GRAPHQL_MAX_COMPLEXITY, NODE_ENV, ...)
 * before the Apollo Server instance is constructed, without affecting other
 * test files that require the full src/server.js app.
 */

"use strict";

// stellarService/turretsService pull in @stellar/stellar-sdk, which these
// hardening tests have no need to exercise (queries either get rejected
// before resolvers run, or use resolvers that don't touch Stellar). Mocking
// them keeps these tests focused and network-free.
jest.mock("../src/services/stellarService", () => ({
  getAccount: jest.fn(async (publicKey) => {
    if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
      throw new Error("Invalid Stellar public key format");
    }
    return { publicKey, balances: [], sequence: "1" };
  }),
  getPayments: jest.fn(async () => []),
}));

jest.mock("../src/services/turretsService", () => ({
  listDeployments: jest.fn(async () => []),
}));

const express = require("express");
const request = require("supertest");
const { mountGraphQL } = require("../src/graphql");

const ENV_KEYS = [
  "GRAPHQL_MAX_DEPTH",
  "GRAPHQL_MAX_COMPLEXITY",
  "GRAPHQL_INTROSPECTION",
  "GRAPHQL_MAX_RESPONSE_SIZE_BYTES",
  "NODE_ENV",
];

function snapshotEnv() {
  return ENV_KEYS.reduce((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {});
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

/** Build a fresh app + Apollo Server reading current process.env. */
async function buildApp() {
  const app = express();
  const { apolloServer, ready } = mountGraphQL(app);
  await ready;
  return { app, apolloServer };
}

describe("GraphQL hardening (#630)", () => {
  let envSnapshot;
  let apolloServer;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    if (apolloServer) {
      await apolloServer.stop();
      apolloServer = undefined;
    }
  });

  describe("Query depth limit", () => {
    it("rejects a query nested deeper than GRAPHQL_MAX_DEPTH with a clear error", async () => {
      process.env.GRAPHQL_MAX_DEPTH = "1";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: '{ account(publicKey: "x") { balances { assetCode } } }' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/exceeds maximum operation depth/i);
      expect(res.body.data).toBeUndefined();
    });

    it("allows a query within GRAPHQL_MAX_DEPTH", async () => {
      process.env.GRAPHQL_MAX_DEPTH = "1";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ turrets { id } }" });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data).toBeDefined();
    });

    it("defaults to a safe max depth when GRAPHQL_MAX_DEPTH is unset", async () => {
      delete process.env.GRAPHQL_MAX_DEPTH;
      const { getMaxDepth, DEFAULT_MAX_DEPTH } = require("../src/graphql/limits");

      expect(getMaxDepth()).toBe(DEFAULT_MAX_DEPTH);
    });

    it("falls back to the default depth for an invalid GRAPHQL_MAX_DEPTH value", () => {
      process.env.GRAPHQL_MAX_DEPTH = "not-a-number";
      const { getMaxDepth, DEFAULT_MAX_DEPTH } = require("../src/graphql/limits");

      expect(getMaxDepth()).toBe(DEFAULT_MAX_DEPTH);
    });
  });

  describe("Query complexity limit", () => {
    it("rejects a highly aliased query exceeding GRAPHQL_MAX_COMPLEXITY with a clear error", async () => {
      process.env.GRAPHQL_MAX_COMPLEXITY = "5";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const aliasedQuery = `{
        a1: turrets { id }
        a2: turrets { id }
        a3: turrets { id }
        a4: turrets { id }
        a5: turrets { id }
        a6: turrets { id }
      }`;

      const res = await request(built.app).post("/api/graphql").send({ query: aliasedQuery });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/complexity/i);
      expect(res.body.data).toBeUndefined();
    });

    it("allows a query within GRAPHQL_MAX_COMPLEXITY", async () => {
      process.env.GRAPHQL_MAX_COMPLEXITY = "5";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ turrets { id } }" });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
    });

    it("defaults to a safe max complexity when GRAPHQL_MAX_COMPLEXITY is unset", () => {
      delete process.env.GRAPHQL_MAX_COMPLEXITY;
      const { getMaxComplexity, DEFAULT_MAX_COMPLEXITY } = require("../src/graphql/limits");

      expect(getMaxComplexity()).toBe(DEFAULT_MAX_COMPLEXITY);
    });
  });

  describe("Introspection gating", () => {
    it("allows introspection when GRAPHQL_INTROSPECTION=true regardless of NODE_ENV", async () => {
      process.env.NODE_ENV = "production";
      process.env.GRAPHQL_INTROSPECTION = "true";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ __schema { queryType { name } } }" });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.__schema.queryType.name).toBe("Query");
    });

    it("blocks introspection in production by default", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.GRAPHQL_INTROSPECTION;
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ __schema { queryType { name } } }" });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/introspection/i);
      expect(res.body.data).toBeUndefined();
    });

    it("allows introspection by default outside production", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.GRAPHQL_INTROSPECTION;
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ __schema { queryType { name } } }" });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
    });

    it("blocks introspection outside production when GRAPHQL_INTROSPECTION=false", async () => {
      process.env.NODE_ENV = "development";
      process.env.GRAPHQL_INTROSPECTION = "false";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ __schema { queryType { name } } }" });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.data).toBeUndefined();
    });
  });

  describe("Error sanitization", () => {
    it("masks resolver error details behind a generic message in production", async () => {
      process.env.NODE_ENV = "production";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      // Invalid public key format throws inside stellarService — a resolver
      // ("business logic") error, not a validation error.
      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: '{ account(publicKey: "not-a-valid-key") { publicKey } }' });

      expect(res.status).toBe(200);
      expect(res.body.errors[0].message).toBe("Internal server error");
      expect(res.body.errors[0].message).not.toMatch(/stellar|key format/i);
      expect(JSON.stringify(res.body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack frames
    });

    it("still surfaces a clear message for depth-limit rejections in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.GRAPHQL_MAX_DEPTH = "1";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: '{ account(publicKey: "x") { balances { assetCode } } }' });

      expect(res.body.errors[0].message).toMatch(/exceeds maximum operation depth/i);
    });
  });

  describe("Response size guard", () => {
    it("replaces an oversized response with a size-limit error", async () => {
      process.env.GRAPHQL_MAX_RESPONSE_SIZE_BYTES = "10";
      const built = await buildApp();
      apolloServer = built.apolloServer;

      const res = await request(built.app)
        .post("/api/graphql")
        .send({ query: "{ turrets { id } }" });

      expect(res.status).toBe(200);
      expect(res.body.errors[0].extensions.code).toBe("RESPONSE_TOO_LARGE");
      expect(res.body.data).toBeNull();
    });
  });
});
