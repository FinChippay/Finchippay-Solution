/* eslint-env jest */
"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../src/services/ipfsService", () => ({
  uploadMetadata: jest.fn(async (metadata) => ({ cid: "QmTest" })),
  fetchMetadata: jest.fn(async () => ({ hello: "world" })),
  mintWithIpfs: jest.fn(async ({ publicKey, memo, metadata }) => ({
    cid: "QmTest",
    memo: memo || "QmTest",
    publicKey,
    metadata,
  })),
}));

const ipfsRoutes = require("../src/routes/receipts");
const ipfsService = require("../src/services/ipfsService");

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/receipts", ipfsRoutes);
  return server;
}

describe("IPFS receipt routes", () => {
  it("uploads metadata and returns a CID", async () => {
    const res = await request(app())
      .post("/api/receipts/ipfs")
      .send({ metadata: { invoice: "1" } });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cid).toBe("QmTest");
  });

  it("fetches metadata by CID", async () => {
    const res = await request(app()).get("/api/receipts/ipfs/QmTest");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ hello: "world" });
  });

  it("mints receipt metadata with an IPFS memo", async () => {
    const res = await request(app())
      .post("/api/receipts/mint-with-ipfs")
      .send({
        publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        memo: "invoice-1",
        metadata: { invoice: "1" },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.memo).toBe("invoice-1");
    expect(ipfsService.mintWithIpfs).toHaveBeenCalled();
  });
});
