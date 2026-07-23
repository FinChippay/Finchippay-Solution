/**
 * src/routes/auth.js
 * SEP-0010 Stellar Web Authentication endpoints.
 *
 * GET  /api/auth?account=G... → returns a challenge transaction
 * POST /api/auth              → verifies signed challenge, returns JWT
 */
"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const { Utils, Keypair } = require("@stellar/stellar-sdk");
 160-issue-38-rtl-language-support-arabic-hebrew-fix
const { JWT_SECRET } = require("../middleware/auth");
const {
  formatErrorResponse,
  ERROR_CODES,
} = require("../../../shared/errorCodes");
const { validate } = require("../validation/middleware");
const {
  authChallengeQuerySchema,
  authTokenBodySchema,
} = require("../validation/schemas");


const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
const tokenService = require("../services/tokenService");
const { sendError } = require("../utils/errorResponse");
 master

const router = express.Router();

const HOME_DOMAIN = process.env.HOME_DOMAIN || "localhost:4000";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";

// Cache the server keypair — regenerated only on cold start.
let cachedServerKeypair = null;
function getServerKeypair() {
  if (!cachedServerKeypair) {
    const secret = process.env.SERVER_PRIVATE_KEY || Keypair.random().secret();
    cachedServerKeypair = Keypair.fromSecret(secret);
  }
  return cachedServerKeypair;
}

// GET /api/auth?account=G... — issue a SEP-0010 challenge transaction
router.get("/", validate(authChallengeQuerySchema, "query"), (req, res) => {
  const { account } = req.validated;

  try {
    const keypair = getServerKeypair();
    const challenge = Utils.buildChallengeTx(
      keypair,
      account,
      HOME_DOMAIN,
      300, // 5-minute validity window
      NETWORK_PASSPHRASE,
    );
    res.json({ transaction: challenge, networkPassphrase: NETWORK_PASSPHRASE });
  } catch (e) {
    res
      .status(ERROR_CODES.AUTH_CHALLENGE_FAILED.httpStatus)
      .json(
        formatErrorResponse("AUTH_CHALLENGE_FAILED", { reason: e.message }),
      );
  }
});

// POST /api/auth — verify signed challenge and issue JWT
router.post("/", validate(authTokenBodySchema), (req, res) => {
  const { transaction } = req.validated;

  try {
    const keypair = getServerKeypair();
    const accountId = Utils.verifyChallengeTx(
      transaction,
      keypair.publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      "",
    );

 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const token = jwt.sign({ publicKey: accountId }, JWT_SECRET, {
      expiresIn: "24h",

    const { accessToken, refreshToken } = tokenService.issueTokens(accountId);

    res.cookie("jwt", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge:   15 * 60 * 1000, // 15 mins
 master
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
 160-issue-38-rtl-language-support-arabic-hebrew-fix
      maxAge: 24 * 60 * 60 * 1000,

      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
 master
    });

    res.json({
      success: true,
      token: accessToken, // for backward compatibility
      accessToken,
      refreshToken
    });
  } catch (e) {
    res
      .status(ERROR_CODES.AUTH_CHALLENGE_FAILED.httpStatus)
      .json(
        formatErrorResponse("AUTH_CHALLENGE_FAILED", { reason: e.message }),
      );
  }
});

// POST /api/auth/refresh — Rotate access + refresh tokens
router.post("/refresh", (req, res) => {
  const refreshToken = req.body.refreshToken || req.cookies?.refreshToken;
  if (!refreshToken) {
    return res
      .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
      .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["refreshToken"] }));
  }

  const rotated = tokenService.rotateRefreshToken(refreshToken);
  if (!rotated) {
    res.clearCookie("jwt");
    res.clearCookie("refreshToken");
    return sendError(res, "AUTH_INVALID_TOKEN", {
      message: "Invalid or expired refresh token.",
    });
  }

  const { accessToken, refreshToken: newRefreshToken } = rotated;

  res.cookie("jwt", accessToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   15 * 60 * 1000,
  });

  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    token: accessToken,
    accessToken,
    refreshToken: newRefreshToken
  });
});

// POST /api/auth/logout — Revoke the token family
router.post("/logout", (req, res) => {
  const refreshToken = req.body.refreshToken || req.cookies?.refreshToken;
  let publicKey = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.publicKey) {
        publicKey = decoded.publicKey;
      }
    } catch (e) {
      // ignore decoding errors
    }
  }

  if (refreshToken) {
    const tokenData = tokenService.getRefreshTokenData(refreshToken);
    if (tokenData) {
      publicKey = tokenData.publicKey;
    }
  }

  if (publicKey) {
    tokenService.revokeTokenFamily(publicKey);
  }

  res.clearCookie("jwt");
  res.clearCookie("refreshToken");

  res.json({ success: true, message: "Logged out successfully." });
});

module.exports = router;
