/* eslint-env jest */
/**
 * __tests__/graphqlPersistedOperations.test.js
 * Tests for the optional persisted-operations enforcement scaffold (#630).
 */

"use strict";

jest.mock("../src/services/stellarService", () => ({
  getAccount: jest.fn(async () => ({ publicKey: "x", balances: [], sequence: "1" })),
  getPayments: jest.fn(async () => []),
}));

jest.mock("../src/services/turretsService", () => ({
  listDeployments: jest.fn(async () => []),
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const request = require("supertest");
const { mountGraphQL } = require("../src/graphql");
const { hashQuery } = require("../src/graphql/persistedOperations");

const QUERY = "{ turrets { id } }";

describe("GraphQL persisted operations (#630)", () => {
  const originalEnforced = process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY;
  const originalManifest = process.env.GRAPHQL_PERSISTED_OPERATIONS_MANIFEST;
  let apolloServer;
  let manifestPath;

  afterEach(async () => {
    if (originalEnforced === undefined) {
      delete process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY;
    } else {
      process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY = originalEnforced;
    }
    if (originalManifest === undefined) {
      delete process.env.GRAPHQL_PERSISTED_OPERATIONS_MANIFEST;
    } else {
      process.env.GRAPHQL_PERSISTED_OPERATIONS_MANIFEST = originalManifest;
    }
    if (manifestPath) {
      fs.rmSync(manifestPath, { force: true });
      manifestPath = undefined;
    }
    if (apolloServer) {
      await apolloServer.stop();
      apolloServer = undefined;
    }
  });

  it("allows any ad-hoc query when enforcement is disabled (default)", async () => {
    delete process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY;
    const app = express();
    const built = mountGraphQL(app);
    apolloServer = built.apolloServer;
    await built.ready;

    const res = await request(app).post("/api/graphql").send({ query: QUERY });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
  });

  it("rejects a query not present in the manifest when enforcement is enabled", async () => {
    manifestPath = path.join(os.tmpdir(), `persisted-ops-${Date.now()}.json`);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ [hashQuery("{ __typename }")]: "{ __typename }" }),
    );
    process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY = "true";
    process.env.GRAPHQL_PERSISTED_OPERATIONS_MANIFEST = manifestPath;

    const app = express();
    const built = mountGraphQL(app);
    apolloServer = built.apolloServer;
    await built.ready;

    const res = await request(app).post("/api/graphql").send({ query: QUERY });

    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].extensions.code).toBe("PERSISTED_OPERATION_NOT_FOUND");
    expect(res.body.data).toBeUndefined();
  });

  it("allows a query whose hash is registered in the manifest when enforcement is enabled", async () => {
    manifestPath = path.join(os.tmpdir(), `persisted-ops-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ [hashQuery(QUERY)]: QUERY }));
    process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY = "true";
    process.env.GRAPHQL_PERSISTED_OPERATIONS_MANIFEST = manifestPath;

    const app = express();
    const built = mountGraphQL(app);
    apolloServer = built.apolloServer;
    await built.ready;

    const res = await request(app).post("/api/graphql").send({ query: QUERY });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
  });
});
