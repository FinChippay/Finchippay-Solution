/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const nock = require("nock");

describe("turrets DB persistence", () => {
  let knex;
  let turretsService;
  let dbFile;

  beforeEach(async () => {
    jest.resetModules();
    dbFile = path.join(os.tmpdir(), `turrets-${Date.now()}-${Math.random()}.db`);
    process.env.DB_PROVIDER = "sqlite";
    process.env.DB_FILENAME = dbFile;

    knex = require("../src/db/connection");
    turretsService = require("../src/services/turretsService");

    await knex.schema.createTable("turrets_deployments", (table) => {
      table.string("id").primary();
      table.string("owner_pk").notNullable();
      table.string("type").notNullable();
      table.string("status").notNullable().defaultTo("active");
      table.text("config").notNullable();
      table.string("deployment_hash");
      table.text("signed_challenge_xdr");
      table.timestamp("created_at");
      table.bigInteger("created_at_ms");
      table.timestamp("next_run_at");
      table.timestamp("last_executed_at");
      table.timestamp("last_checked_at");
      table.float("last_observed_price_usd");
      table.text("last_error");
    });

    await knex.schema.createTable("turrets_history", (table) => {
      table.string("id").primary();
      table.string("deployment_id").notNullable();
      table.string("status").notNullable();
      table.text("message");
      table.text("result");
      table.timestamp("created_at");
    });
  });

  afterEach(async () => {
    if (turretsService) turretsService.stopRunner();
    if (knex) await knex.destroy();
    if (dbFile && fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    delete process.env.DB_FILENAME;
    delete process.env.DB_PROVIDER;
  });

  test("lists deployments and history from the database after service reload", async () => {
    const deployment = {
      id: "turret-1",
      owner_pk: "GC72GRI7BO2TU5VN2RTB5KURJVFTUHVFS46TNJR2HDQYJ3QWGTXZHXIU",
      type: "stop_loss",
      status: "active",
      config: JSON.stringify({ thresholdPrice: 0.1, amountSell: 5, sellAssetCode: "XLM", sellAssetIssuer: null, cooldownMinutes: 30 }),
      deployment_hash: "hash",
      signed_challenge_xdr: "signed-xdr",
      created_at: new Date().toISOString(),
      created_at_ms: Date.now(),
      next_run_at: new Date().toISOString(),
    };
    await knex("turrets_deployments").insert(deployment);
    await knex("turrets_history").insert({
      id: "history-1",
      deployment_id: deployment.id,
      status: "created",
      message: "txFunction deployed",
      result: JSON.stringify({ ok: true }),
      created_at: new Date().toISOString(),
    });

    // Simulate a process restart by reloading only the service module. Data must
    // still be read from the database, not from an in-memory Map.
    delete require.cache[require.resolve("../src/services/turretsService")];
    const reloadedService = require("../src/services/turretsService");

    const deployments = await reloadedService.listDeployments(deployment.owner_pk);
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({
      id: deployment.id,
      ownerPublicKey: deployment.owner_pk,
      type: "stop_loss",
      status: "active",
    });
    expect(deployments[0].config.thresholdPrice).toBe(0.1);

    const history = await reloadedService.getExecutionHistory(deployment.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      deploymentId: deployment.id,
      status: "created",
      result: { ok: true },
    });
  });
});

describe("priceFeedService", () => {
  let priceFeedService;

  beforeEach(() => {
    jest.resetModules();
    nock.cleanAll();
    delete process.env.PRICE_FEED_COINGECKO_API_KEY;
    priceFeedService = require("../src/services/priceFeedService");
    priceFeedService._resetForTests();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  test("falls back from CoinGecko to Binance", async () => {
    nock("https://api.coingecko.com")
      .get("/api/v3/simple/price")
      .query(true)
      .reply(429, { error: "rate limited" });

    nock("https://api.binance.com")
      .get("/api/v3/ticker/price")
      .query({ symbol: "XLMUSDT" })
      .reply(200, { symbol: "XLMUSDT", price: "0.1234" });

    const result = await priceFeedService.getXLMPrice();
    expect(result).toMatchObject({ price: 0.1234, source: "Binance" });
  });

  test("caches successful prices for 30 seconds", async () => {
    nock("https://api.coingecko.com")
      .get("/api/v3/simple/price")
      .query(true)
      .once()
      .reply(200, { stellar: { usd: 0.11 } });

    const first = await priceFeedService.getXLMPrice();
    const second = await priceFeedService.getXLMPrice();

    expect(first).toMatchObject({ price: 0.11, source: "CoinGecko", cached: false });
    expect(second).toMatchObject({ price: 0.11, source: "CoinGecko", cached: true });
    expect(nock.isDone()).toBe(true);
  });

  test("health reports provider status", async () => {
    nock("https://api.coingecko.com").get("/api/v3/simple/price").query(true).reply(500);
    nock("https://api.binance.com").get("/api/v3/ticker/price").query(true).reply(200, { price: "0.12" });
    nock("https://api.coincap.io").get("/v2/assets/stellar").reply(200, { data: { priceUsd: "0.13" } });

    const health = await priceFeedService.getHealth();
    expect(health.status).toBe("ok");
    expect(health.providers.coingecko.status).toBe("error");
    expect(health.providers.binance.status).toBe("ok");
    expect(health.providers.coincap.status).toBe("ok");
  });
});
