/**
 * src/services/turretsService.js
 * Knex-backed Turrets txFunctions registry with DCA and stop-loss evaluators.
 *
 * Migrated from in-memory Maps/arrays to SQLite/PostgreSQL for persistence
 * across server restarts.
 */

"use strict";

const crypto = require("crypto");
const {
  Account,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} = require("@stellar/stellar-sdk");
const knex = require("../db/connection");
const priceFeedService = require("./priceFeedService");


const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;

const server = new Horizon.Server(HORIZON_URL);

let runnerStarted = false;
let runnerTimer = null;

function validatePublicKey(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

function getConfigHash(type, config) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ type, config }))
    .digest("hex");
}

function normalizeDcaConfig(config = {}) {
  const intervalMinutes = Number(config.intervalMinutes || 60);
  const amountQuote = Number(config.amountQuote || 10);
  const quoteAssetCode = (config.quoteAssetCode || "USDC").toUpperCase();
  const quoteAssetIssuer = config.quoteAssetIssuer || null;

  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
    const err = new Error("DCA intervalMinutes must be at least 1");
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(amountQuote) || amountQuote <= 0) {
    const err = new Error("DCA amountQuote must be greater than 0");
    err.status = 400;
    throw err;
  }

  return {
    intervalMinutes,
    amountQuote,
    quoteAssetCode,
    quoteAssetIssuer,
  };
}

function normalizeStopLossConfig(config = {}) {
  const thresholdPrice = Number(config.thresholdPrice);
  const amountSell = Number(config.amountSell || 0);
  const sellAssetCode = (config.sellAssetCode || "XLM").toUpperCase();
  const sellAssetIssuer = config.sellAssetIssuer || null;
  const cooldownMinutes = Number(config.cooldownMinutes || 30);

  if (!Number.isFinite(thresholdPrice) || thresholdPrice <= 0) {
    const err = new Error("Stop-loss thresholdPrice must be greater than 0");
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(amountSell) || amountSell <= 0) {
    const err = new Error("Stop-loss amountSell must be greater than 0");
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 1) {
    const err = new Error("Stop-loss cooldownMinutes must be at least 1");
    err.status = 400;
    throw err;
  }

  return {
    thresholdPrice,
    amountSell,
    sellAssetCode,
    sellAssetIssuer,
    cooldownMinutes,
  };
}

function normalizeEscrowReleaseConfig(config = {}) {
  const escrowPublicKey = config.escrowPublicKey || null;
  const beneficiaryPublicKey = config.beneficiaryPublicKey || null;
  const releaseAmount = Number(config.releaseAmount || 0);
  const assetCode = (config.assetCode || "XLM").toUpperCase();
  const assetIssuer = config.assetIssuer || null;
  const releaseCondition = config.releaseCondition || "time";
  const releaseAfterMs = Number(config.releaseAfterMs || 0);

  if (!escrowPublicKey || !/^G[A-Z0-9]{55}$/.test(escrowPublicKey)) {
    const err = new Error("escrow_release: valid escrowPublicKey is required");
    err.status = 400;
    throw err;
  }

  if (!beneficiaryPublicKey || !/^G[A-Z0-9]{55}$/.test(beneficiaryPublicKey)) {
    const err = new Error(
      "escrow_release: valid beneficiaryPublicKey is required",
    );
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(releaseAmount) || releaseAmount <= 0) {
    const err = new Error(
      "escrow_release: releaseAmount must be greater than 0",
    );
    err.status = 400;
    throw err;
  }

  if (!["time", "manual"].includes(releaseCondition)) {
    const err = new Error(
      "escrow_release: releaseCondition must be 'time' or 'manual'",
    );
    err.status = 400;
    throw err;
  }

  if (
    releaseCondition === "time" &&
    (!Number.isFinite(releaseAfterMs) || releaseAfterMs <= 0)
  ) {
    const err = new Error(
      "escrow_release: releaseAfterMs must be greater than 0 for time-based release",
    );
    err.status = 400;
    throw err;
  }

  return {
    escrowPublicKey,
    beneficiaryPublicKey,
    releaseAmount,
    assetCode,
    assetIssuer,
    releaseCondition,
    releaseAfterMs,
  };
}

function normalizeConfig(type, config) {
  if (type === "dca") return normalizeDcaConfig(config);
  if (type === "stop_loss") return normalizeStopLossConfig(config);
  if (type === "escrow_release") return normalizeEscrowReleaseConfig(config);
  const err = new Error(
    "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'.",
  );
  err.status = 400;
  throw err;
}

async function createSigningChallenge({ ownerPublicKey, type, config }) {
  validatePublicKey(ownerPublicKey);

  const normalizedConfig = normalizeConfig(type, config);
  const deploymentHash = getConfigHash(type, normalizedConfig);

  let sourceAccount;
  try {
    sourceAccount = await server.loadAccount(ownerPublicKey);
  } catch {
    sourceAccount = new Account(ownerPublicKey, "0");
  }

  const challengeTx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.manageData({
        name: `turrets-deploy:${type}`,
        value: deploymentHash,
      }),
    )
    .setTimeout(300)
    .build();

  return {
    challengeXDR: challengeTx.toXDR(),
    deploymentHash,
    normalizedConfig,
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

function verifySignedChallenge({ ownerPublicKey, signedChallengeXDR }) {
  validatePublicKey(ownerPublicKey);

  const tx = new Transaction(signedChallengeXDR, NETWORK_PASSPHRASE);

  if (tx.source !== ownerPublicKey) {
    const err = new Error("Signed challenge source account mismatch");
    err.status = 400;
    throw err;
  }

  const signer = Keypair.fromPublicKey(ownerPublicKey);
  const expectedHint = Buffer.from(signer.signatureHint()).toString("hex");
  const txHash = tx.hash();

  const hasValidSignature = tx.signatures.some((sig) => {
    const hint = Buffer.from(sig.hint()).toString("hex");
    if (hint !== expectedHint) return false;
    try {
      return signer.verify(txHash, sig.signature());
    } catch {
      return false;
    }
  });

  if (!hasValidSignature) {
    const err = new Error(
      "Signed challenge was not signed by the owner account",
    );
    err.status = 401;
    throw err;
  }
}

function toDexAsset(code, issuer) {
  if (code === "XLM") return Asset.native();
  if (!issuer) {
    const err = new Error(
      `Asset issuer is required for non-native asset ${code}`,
    );
    err.status = 400;
    throw err;
  }
  return new Asset(code, issuer);
}

function dcaTxFunction(config, xlmUsdPrice) {
  const quoteToXlm = xlmUsdPrice > 0 ? 1 / xlmUsdPrice : 0;
  const estXlm = config.amountQuote * quoteToXlm;

  return {
    action: "buy_xlm_dca",
    dexOperation: "manageSellOffer",
    selling: {
      code: config.quoteAssetCode,
      issuer: config.quoteAssetIssuer,
    },
    buying: { code: "XLM", issuer: null },
    quoteAmount: config.amountQuote.toFixed(7),
    estimatedXlm: estXlm.toFixed(7),
    referencePriceUsd: xlmUsdPrice,
    note: "Place a DEX sell offer to swap quote asset into XLM on schedule.",
  };
}

function stopLossTxFunction(config, xlmUsdPrice) {
  return {
    action: "stop_loss_sell",
    dexOperation: "manageSellOffer",
    selling: {
      code: config.sellAssetCode,
      issuer: config.sellAssetIssuer,
    },
    buying: { code: "XLM", issuer: null },
    amount: config.amountSell.toFixed(7),
    triggerPriceUsd: config.thresholdPrice,
    observedPriceUsd: xlmUsdPrice,
    note: "Sell configured asset into XLM when observed price is below threshold.",
  };
}

function escrowReleaseTxFunction(config) {
  const asset =
    config.assetCode === "XLM"
      ? { code: "XLM", issuer: null }
      : { code: config.assetCode, issuer: config.assetIssuer };

  return {
    action: "escrow_release",
    stellarOperation: "payment",
    from: config.escrowPublicKey,
    to: config.beneficiaryPublicKey,
    asset,
    amount: config.releaseAmount.toFixed(7),
    releaseCondition: config.releaseCondition,
    note: "Release escrowed funds to beneficiary without the backend holding private keys.",
  };
}

async function addExecutionLog(deploymentId, status, message, result = null) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await knex("turrets_history").insert({
    id,
    deployment_id: deploymentId,
    status,
    message,
    result: result ? JSON.stringify(result) : null,
    created_at: createdAt,
  });

  // Prune old history entries (keep last 1000)
  const [{ count }] = await knex("turrets_history")
    .where("deployment_id", deploymentId)
    .count("* as count");
  if (Number(count) > 1000) {
    const excess = Number(count) - 1000;
    const oldestIds = await knex("turrets_history")
      .where("deployment_id", deploymentId)
      .orderBy("created_at", "asc")
      .limit(excess)
      .select("id");
    if (oldestIds.length > 0) {
      await knex("turrets_history")
        .whereIn(
          "id",
          oldestIds.map((r) => r.id),
        )
        .del();
    }
  }
}

async function getXlmUsdPrice() {
  const priceQuote = await priceFeedService.getXLMPrice();
  return priceQuote.price;

  const now = Date.now();
  if (priceCache.value !== null && now - priceCache.fetchedAt < 30_000) {
    return priceCache.value;
  }

  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
  );

  if (!res.ok) {
    throw new Error(`Price lookup failed (${res.status})`);
  }

  const data = await res.json();
  const value = Number(data?.stellar?.usd);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid price response from upstream provider");
  }

  priceCache = { value, fetchedAt: now };
  return value;
}

function nextRunIso(intervalMinutes) {
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}

function dbRowToDeployment(row) {
  return {
    id: row.id,
    ownerPublicKey: row.owner_pk,
    type: row.type,
    status: row.status,
    config:
      typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    deploymentHash: row.deployment_hash,
    signedChallengeXDR: row.signed_challenge_xdr,
    createdAt: row.created_at,
    createdAtMs: row.created_at_ms,
    nextRunAt: row.next_run_at,
    lastExecutedAt: row.last_executed_at,
    lastCheckedAt: row.last_checked_at,
    lastObservedPriceUsd: row.last_observed_price_usd,
    lastError: row.last_error,
  };
}

async function evaluateDeployment(deployment) {
  const now = Date.now();
  const nextRunMs = deployment.nextRunAt ? Date.parse(deployment.nextRunAt) : 0;

  if (nextRunMs && now < nextRunMs) return;

  try {
    const price = await getXlmUsdPrice();

    const updates = {
      last_observed_price_usd: price,
      last_checked_at: new Date().toISOString(),
    };

    if (deployment.type === "dca") {
      const result = dcaTxFunction(deployment.config, price);
      updates.last_executed_at = new Date().toISOString();
      updates.next_run_at = nextRunIso(deployment.config.intervalMinutes);
      await knex("turrets_deployments")
        .where("id", deployment.id)
        .update(updates);
      await addExecutionLog(
        deployment.id,
        "executed",
        "DCA txFunction generated",
        result,
      );
      return;
    }

    if (deployment.type === "stop_loss") {
      if (price <= deployment.config.thresholdPrice) {
        const result = stopLossTxFunction(deployment.config, price);
        updates.last_executed_at = new Date().toISOString();
        updates.next_run_at = nextRunIso(deployment.config.cooldownMinutes);
        await knex("turrets_deployments")
          .where("id", deployment.id)
          .update(updates);
        await addExecutionLog(
          deployment.id,
          "executed",
          "Stop-loss condition met",
          result,
        );
      } else {
        updates.next_run_at = new Date(Date.now() + 60 * 1000).toISOString();
        await knex("turrets_deployments")
          .where("id", deployment.id)
          .update(updates);
      }
    }

    if (deployment.type === "escrow_release") {
      const releaseAt =
        deployment.createdAtMs + deployment.config.releaseAfterMs;
      if (deployment.config.releaseCondition === "time" && now >= releaseAt) {
        const result = escrowReleaseTxFunction(deployment.config);
        updates.last_executed_at = new Date().toISOString();
        updates.status = "completed";
        await knex("turrets_deployments")
          .where("id", deployment.id)
          .update(updates);
        await addExecutionLog(
          deployment.id,
          "executed",
          "Escrow time-lock expired, release triggered",
          result,
        );
      } else {
        // Manual release or time-based release not yet due — persist last_checked_at
        await knex("turrets_deployments")
          .where("id", deployment.id)
          .update(updates);
      }
    }
  } catch (err) {
    await knex("turrets_deployments").where("id", deployment.id).update({
      last_error: err.message,
      last_checked_at: new Date().toISOString(),
    });
    await addExecutionLog(deployment.id, "error", err.message);
  }
}

function startRunner() {
  if (runnerStarted) return;
  runnerStarted = true;

  const pollIntervalMs = Number(
    process.env.TURRETS_EVALUATION_INTERVAL_MS || 30_000,
  );

  runnerTimer = setInterval(() => {
    // fire-and-forget with catch to avoid unhandled rejections
    (async () => {
      try {
        const rows = await knex("turrets_deployments").where(
          "status",
          "active",
        );
        for (const row of rows) {
          const deployment = dbRowToDeployment(row);
          await evaluateDeployment(deployment);
        }
      } catch (err) {
        // Log and continue polling; individual errors are logged in evaluateDeployment
      }
    })();
  }, pollIntervalMs);
}

function stopRunner() {
  if (runnerTimer) clearInterval(runnerTimer);
  runnerTimer = null;
  runnerStarted = false;
}

async function deployTxFunction({
  ownerPublicKey,
  type,
  config,
  deploymentHash,
  signedChallengeXDR,
}) {
  validatePublicKey(ownerPublicKey);
  verifySignedChallenge({ ownerPublicKey, signedChallengeXDR });

  const normalizedConfig = normalizeConfig(type, config);
  const calculatedHash = getConfigHash(type, normalizedConfig);

  if (calculatedHash !== deploymentHash) {
    const err = new Error(
      "Configuration hash mismatch. Recreate challenge and sign again.",
    );
    err.status = 400;
    throw err;
  }

  if (type === "dca") {
    toDexAsset(
      normalizedConfig.quoteAssetCode,
      normalizedConfig.quoteAssetIssuer,
    );
  }

  if (type === "stop_loss") {
    toDexAsset(
      normalizedConfig.sellAssetCode,
      normalizedConfig.sellAssetIssuer,
    );
  }

  if (type === "escrow_release" && normalizedConfig.assetCode !== "XLM") {
    toDexAsset(normalizedConfig.assetCode, normalizedConfig.assetIssuer);
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  let nextRunAt;
  if (type === "dca") {
    nextRunAt = nextRunIso(normalizedConfig.intervalMinutes);
  } else if (type === "escrow_release") {
    nextRunAt = new Date(now + normalizedConfig.releaseAfterMs).toISOString();
  } else {
    nextRunAt = new Date(now + 60 * 1000).toISOString();
  }

  await knex("turrets_deployments").insert({
    id,
    owner_pk: ownerPublicKey,
    type,
    status: "active",
    config: JSON.stringify(normalizedConfig),
    deployment_hash: deploymentHash,
    signed_challenge_xdr: signedChallengeXDR,
    created_at: new Date(now).toISOString(),
    created_at_ms: now,
    next_run_at: nextRunAt,
  });

  await addExecutionLog(id, "created", "txFunction deployed");

  startRunner();

  const row = await knex("turrets_deployments").where("id", id).first();
  return dbRowToDeployment(row);
}

async function listDeployments(ownerPublicKey) {
  let query = knex("turrets_deployments");

  if (ownerPublicKey) {
    validatePublicKey(ownerPublicKey);
    query = query.where("owner_pk", ownerPublicKey);
  }

  const rows = await query;
  return rows.map(dbRowToDeployment);
}

async function getDeployment(id) {
  const row = await knex("turrets_deployments").where("id", id).first();
  if (!row) {
    const err = new Error("txFunction not found");
    err.status = 404;
    throw err;
  }
  return dbRowToDeployment(row);
}

async function getExecutionHistory(deploymentId) {
  const rows = await knex("turrets_history")
    .where("deployment_id", deploymentId)
    .orderBy("created_at", "desc");

  return rows.map((row) => ({
    id: row.id,
    deploymentId: row.deployment_id,
    status: row.status,
    message: row.message,
    result: row.result ? JSON.parse(row.result) : null,
    createdAt: row.created_at,
  }));
}

async function setDeploymentStatus(id, status) {
  const deployment = await getDeployment(id);
  await knex("turrets_deployments").where("id", id).update({ status });
  await addExecutionLog(id, "status", `txFunction ${status}`);
  deployment.status = status;
  return deployment;
}

async function countDeploymentsByStatus(status) {
  const [{ count }] = await knex("turrets_deployments")
    .where("status", status)
    .count("* as count");
  return Number(count);
}

module.exports = {
  createSigningChallenge,
  deployTxFunction,
  listDeployments,
  getDeployment,
  getExecutionHistory,
  setDeploymentStatus,
  countDeploymentsByStatus,
  startRunner,
  stopRunner,
};
