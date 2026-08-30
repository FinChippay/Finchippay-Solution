/* eslint-env jest */
"use strict";

/**
 * Shared @stellar/stellar-sdk stub for suites that load the SDK through the
 * app/service layer. The SDK's CJS build pulls an ESM-only dependency that
 * Jest cannot transform, so suites that merely exercise turrets logic stub
 * the SDK surface they touch instead of loading the real package.
 *
 * Usage: `jest.mock("@stellar/stellar-sdk", () => require("./turretsSdkStub"));`
 */
const keypair = () => ({
  publicKey: () => "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
  secret: () => "SDUMMY00000000000000000000000000000000000000000000000000000000",
  sign: () => Buffer.from("deadbeef"),
  signatureHint: () => Buffer.from("beef"),
  rawPublicKey: () => Buffer.from("raw"),
});

const builder = {
  addOperation: () => builder,
  addMemo: () => builder,
  setTimeout: () => builder,
  setTimebounds: () => builder,
  build: () => ({
    toXDR: () => "AAAA",
    sign: () => {},
    signatureBase: () => Buffer.from("base"),
  }),
};

const https = require("https");
const http = require("http");

/**
 * Minimal real-HTTP Horizon client so tests that nock Horizon URLs (e.g.
 * __tests__/integration.test.js) work end to end, while suites that only need
 * the SDK to load never touch the network.
 */
function horizonRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const u = new URL(url);
    const req = lib.request(
      {
        method: options.method || "GET",
        hostname: u.hostname,
        port: u.port || (url.startsWith("https:") ? 443 : 80),
        path: u.pathname + u.search,
        headers: options.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(
              Object.assign(new Error(`Horizon request failed with status ${res.statusCode}`), {
                status: res.statusCode,
                response: { status: res.statusCode, data },
              }),
            );
            return;
          }
          try {
            resolve(JSON.parse(data || "{}"));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function makeHorizonServer(baseUrl) {
  const get = (path, qs) => {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(qs || {})) url.searchParams.set(k, v);
    return horizonRequest(url.toString());
  };

  const payments = (publicKey) => {
    const state = { limit: 10, order: "asc", cursor: null };
    const chain = {
      forAccount: (id) => payments(id),
      limit: (n) => {
        state.limit = n;
        return chain;
      },
      order: (o) => {
        state.order = o;
        return chain;
      },
      cursor: (c) => {
        state.cursor = c;
        return chain;
      },
      call: async () => {
        const qs = { limit: state.limit, order: state.order };
        if (state.cursor) qs.cursor = state.cursor;
        const body = await get(`/accounts/${publicKey}/payments`, qs);
        // Horizon returns collection pages under `_embedded.records`; the real
        // SDK exposes them as `page.records`.
        return {
          ...body,
          records: (body._embedded && body._embedded.records) || body.records || [],
        };
      },
    };
    return chain;
  };

  return {
    loadAccount: (id) => get(`/accounts/${id}`),
    getTransaction: (hash) => get(`/transactions/${hash}`),
    accounts: () => ({ accountId: (id) => ({ call: () => get(`/accounts/${id}`) }) }),
    payments: () => payments(),
    fees: () => ({ call: () => get("/fees") }),
    transactions: () => ({
      call: () => get("/transactions"),
      submitTransaction: (tx) =>
        horizonRequest(new URL("/transactions", baseUrl).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `tx=${encodeURIComponent(typeof tx === "string" ? tx : tx && tx.toXDR ? tx.toXDR() : "")}`,
        }),
    }),
    orderbook: (args) => ({ call: () => get("/order_book", args) }),
  };
}

module.exports = {
  Horizon: {
    Server: jest.fn((baseUrl) =>
      makeHorizonServer(baseUrl || "https://horizon-testnet.stellar.org"),
    ),
  },
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; October 2015",
  },
  Keypair: {
    random: keypair,
    fromPublicKey: keypair,
    fromSecret: keypair,
  },
  Account: function Account(accountId, sequence) {
    this.accountId = () => accountId;
    this.sequenceNumber = () => sequence;
    this.incrementSequenceNumber = () => {};
    this.signatureHint = () => Buffer.from("beef");
  },
  TransactionBuilder: Object.assign(
    function TransactionBuilder() {
      return builder;
    },
    {
      fromXDR: jest.fn(() => ({ hash: () => "hash", toXDR: () => "AAAA" })),
      buildFeeBumpTransaction: jest.fn(),
    },
  ),
  Asset: Object.assign(
    function Asset(code, issuer) {
      this.code = () => code || "XLM";
      this.issuer = () => issuer || null;
      this.isNative = () => !code;
      // Deterministic, format-valid SEP-41 contract ID (C + 55 base32 chars),
      // distinct per asset so route validation and known-asset maps behave
      // like the real SDK without needing its hashing internals.
      this.contractId = () =>
        `C${String(code || "F")[0]
          .toUpperCase()
          .replace(/[^A-Z2-7]/g, "A")
          .repeat(55)}`;
      // Real SDK accessors (getCode/getIssuer) in addition to code()/issuer().
      this.getCode = this.code;
      this.getIssuer = this.issuer;
    },
    {
      native: () =>
        new (function NativeAsset() {
          this.isNative = () => true;
          this.code = () => "XLM";
          this.issuer = () => null;
          this.contractId = () => `C${String("F").repeat(55)}`;
          this.getCode = () => "XLM";
          this.getIssuer = () => null;
        })(),
      fromOperation: jest.fn(),
    },
  ),
  Memo: { text: jest.fn(() => ({})), none: jest.fn(() => ({})) },
  Operation: {
    payment: jest.fn(() => ({})),
    createAccount: jest.fn(() => ({})),
    manageData: jest.fn(() => ({})),
    setOptions: jest.fn(() => ({})),
    accountMerge: jest.fn(() => ({})),
  },
  StrKey: {
    encodeEd25519PublicKey: jest.fn(() => "G..."),
    isValidEd25519PublicKey: jest.fn(() => true),
  },
  xdr: {},
  SorobanRpc: { Server: jest.fn(() => ({})) },
};
