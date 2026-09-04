/* eslint-env jest */
/**
 * __tests__/authAlgorithmPin.test.js
 * verifyJWT must pin the signing algorithm to HS256 (WS7) so an attacker
 * cannot mint a token under a different algorithm family with the same secret.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { verifyJWT, JWT_SECRET } = require("../src/middleware/auth");

const OWNER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

function app() {
  const server = express();
  server.get("/secure", verifyJWT, (req, res) =>
    res.json({ ok: true, publicKey: req.user.publicKey }),
  );
  return server;
}

describe("verifyJWT algorithm pinning (WS7)", () => {
  it("accepts an HS256 token", async () => {
    const token = jwt.sign({ publicKey: OWNER }, JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "10m",
    });
    const res = await request(app()).get("/secure").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(OWNER);
  });

  it("rejects a token signed with a non-HS256 algorithm using the same secret", async () => {
    // HS512 uses the same raw secret — without the explicit algorithms pin this
    // would verify. With `algorithms: ["HS256"]` it must be rejected.
    const token = jwt.sign({ publicKey: OWNER }, JWT_SECRET, {
      algorithm: "HS512",
      expiresIn: "10m",
    });
    const res = await request(app()).get("/secure").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = jwt.sign({ publicKey: OWNER }, "totally-different-secret", {
      algorithm: "HS256",
      expiresIn: "10m",
    });
    const res = await request(app()).get("/secure").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a missing Authorization header", async () => {
    const res = await request(app()).get("/secure");
    expect(res.status).toBe(401);
  });
});
