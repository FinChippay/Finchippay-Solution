/* eslint-env jest */
/**
 * __tests__/graphqlRequestTimeout.test.js
 * Tests for the GraphQL request-timeout guard (#630).
 *
 * Isolated in its own file because it needs a resolver slow enough to
 * exceed a very short GRAPHQL_TIMEOUT_MS, which is easiest done by mocking
 * stellarService — kept separate from graphqlHardening.test.js so that
 * mock doesn't affect the (fast, real-ish) queries used there.
 */

"use strict";

jest.mock("../src/services/stellarService", () => ({
  getAccount: jest.fn(
    (publicKey) =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ publicKey, balances: [], sequence: "1" }), 60);
      }),
  ),
  getPayments: jest.fn(async () => []),
}));

jest.mock("../src/services/turretsService", () => ({
  listDeployments: jest.fn(async () => []),
}));

const express = require("express");
const request = require("supertest");
const { mountGraphQL } = require("../src/graphql");

describe("GraphQL request-timeout guard (#630)", () => {
  const originalTimeout = process.env.GRAPHQL_TIMEOUT_MS;
  let apolloServer;

  afterEach(async () => {
    if (originalTimeout === undefined) {
      delete process.env.GRAPHQL_TIMEOUT_MS;
    } else {
      process.env.GRAPHQL_TIMEOUT_MS = originalTimeout;
    }
    if (apolloServer) {
      await apolloServer.stop();
      apolloServer = undefined;
    }
  });

  it("responds 504 when a resolver exceeds GRAPHQL_TIMEOUT_MS", async () => {
    process.env.GRAPHQL_TIMEOUT_MS = "10";
    const app = express();
    const built = mountGraphQL(app);
    apolloServer = built.apolloServer;
    await built.ready;

    const res = await request(app).post("/api/graphql").send({
      query:
        '{ account(publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF") { publicKey } }',
    });

    expect(res.status).toBe(504);
    expect(res.body.errors[0].extensions.code).toBe("REQUEST_TIMEOUT");
  });

  it("responds normally when the resolver finishes within GRAPHQL_TIMEOUT_MS", async () => {
    process.env.GRAPHQL_TIMEOUT_MS = "2000";
    const app = express();
    const built = mountGraphQL(app);
    apolloServer = built.apolloServer;
    await built.ready;

    const res = await request(app).post("/api/graphql").send({
      query:
        '{ account(publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF") { publicKey } }',
    });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.account.publicKey).toBe(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
  });
});
