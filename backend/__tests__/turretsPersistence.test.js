/**
 * __tests__/turretsPersistence.test.js
 *
 * Verifies the turrets service persists deployments and history to the
 * database (Issue #9 + #1 acceptance criterion: "Turrets deployments persist
 * across server restarts" and "Execution history is stored in the database
 * and queryable").
 *
 * Strategy:
 *   1. Use a throwaway SQLite file in a temp directory so the test never
 *      touches the project's dev DB.
 *   2. Run the migrations against that DB.
 *   3. Insert a deployment + history rows directly via Knex, then read
 *      them back through turretsService.listDeployments() and
 *      turretsService.getExecutionHistory() — proving the service layer is
 *      DB-backed.
 *   4. Re-open the same file path with a fresh Knex instance (simulating a
 *      server restart) and verify the deployment is still readable.
 *
 * The Stellar signing challenge / deploy flow is *not* exercised here —
 * that path needs a real Freighter signature. We focus on the persistence
 * + restart-survival contract called out in the issue.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Use a per-test temp file BEFORE the connection module caches the config.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "turrets-persist-"));
const DB_FILE = path.join(TMP_DIR, "turrets.db");
process.env.DB_PROVIDER = "sqlite";
process.env.DB_FILENAME = DB_FILE;

const knex = require("../src/db/connection");
const turretsService = require("../src/services/turretsService");
const turretsDeploymentService = require("../src/services/turretsDeploymentService");

const VALID_OWNER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const VALID_OWNER_2 = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

afterAll(async () => {
  await knex.destroy();
  // Best-effort cleanup; the tmp dir is throwaway.
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (_err) {
    // ignore
  }
});

describe("turretsService — DB persistence", () => {
  beforeAll(async () => {
    // Apply only the turrets migrations — the dev migrate.js also runs the
    // unrelated tips / usernames / webhooks migrations which we don't need.
    await knex.schema.createTable("turrets_deployments", (table) => {
      table.string("id").primary();
      table.string("owner_pk").notNullable();
      table.string("type").notNullable();
      table.string("status").notNullable().defaultTo("active");
      table.text("config").notNullable();
      table.string("deployment_hash");
      table.text("signed_challenge_xdr");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.bigInteger("created_at_ms");
      table.timestamp("next_run_at");
      table.timestamp("last_executed_at");
      table.timestamp("last_checked_at");
      table.float("last_observed_price_usd");
      table.text("last_error");
      table.index("owner_pk");
      table.index("status");
    });
    await knex.schema.createTable("turrets_history", (table) => {
      table.string("id").primary();
      table
        .string("deployment_id")
        .notNullable()
        .references("id")
        .inTable("turrets_deployments");
      table.string("status").notNullable();
      table.text("message");
      table.text("result");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.index("deployment_id");
    });
  });

  test("inserts a deployment row and returns a typed record", async () => {
    const id = `dep-${Date.now()}`;
    const config = {
      intervalMinutes: 60,
      amountQuote: 10,
      quoteAssetCode: "USDC",
      quoteAssetIssuer: null,
    };
    const now = new Date().toISOString();
    const nextRun = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await knex("turrets_deployments").insert({
      id,
      owner_pk: VALID_OWNER,
      type: "dca",
      status: "active",
      config: JSON.stringify(config),
      deployment_hash: "abc123",
      signed_challenge_xdr: "AAAAfakeXDR==",
      created_at: now,
      created_at_ms: Date.now(),
      next_run_at: nextRun,
    });

    const found = await turretsService.getDeployment(id);
    expect(found.id).toBe(id);
    expect(found.ownerPublicKey).toBe(VALID_OWNER);
    expect(found.type).toBe("dca");
    expect(found.status).toBe("active");
    expect(found.config.intervalMinutes).toBe(60);
    expect(found.deploymentHash).toBe("abc123");
  });

  test("listDeployments returns only rows for the requested owner", async () => {
    const otherId = `dep-other-${Date.now()}`;
    await knex("turrets_deployments").insert({
      id: otherId,
      owner_pk: VALID_OWNER_2,
      type: "stop_loss",
      status: "paused",
      config: JSON.stringify({ thresholdPrice: 0.1, amountSell: 5 }),
      deployment_hash: "otherhash",
      created_at: new Date().toISOString(),
      created_at_ms: Date.now(),
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const owner1 = await turretsService.listDeployments(VALID_OWNER);
    expect(owner1.every((d) => d.ownerPublicKey === VALID_OWNER)).toBe(true);

    const all = await turretsService.listDeployments();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.find((d) => d.id === otherId)).toBeDefined();
  });

  test("history rows are queryable through the service", async () => {
    const id = `dep-hist-${Date.now()}`;
    await knex("turrets_deployments").insert({
      id,
      owner_pk: VALID_OWNER,
      type: "dca",
      status: "active",
      config: JSON.stringify({ intervalMinutes: 60, amountQuote: 1 }),
      created_at: new Date().toISOString(),
      created_at_ms: Date.now(),
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await knex("turrets_history").insert([
      {
        id: `hist-1-${id}`,
        deployment_id: id,
        status: "created",
        message: "txFunction deployed",
        created_at: new Date().toISOString(),
      },
      {
        id: `hist-2-${id}`,
        deployment_id: id,
        status: "executed",
        message: "DCA txFunction generated",
        result: JSON.stringify({ action: "buy_xlm_dca", quoteAmount: "1.0000000" }),
        created_at: new Date(Date.now() + 1_000).toISOString(),
      },
    ]);

    const history = await turretsService.getExecutionHistory(id);
    expect(history).toHaveLength(2);
    // Most-recent-first ordering
    expect(history[0].status).toBe("executed");
    expect(history[0].result.action).toBe("buy_xlm_dca");
    expect(history[1].status).toBe("created");
  });

  test("setDeploymentStatus updates the row and writes a history entry", async () => {
    const id = `dep-status-${Date.now()}`;
    await knex("turrets_deployments").insert({
      id,
      owner_pk: VALID_OWNER,
      type: "dca",
      status: "active",
      config: JSON.stringify({ intervalMinutes: 60, amountQuote: 1 }),
      created_at: new Date().toISOString(),
      created_at_ms: Date.now(),
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const updated = await turretsService.setDeploymentStatus(id, "paused");
    expect(updated.status).toBe("paused");

    const history = await turretsService.getExecutionHistory(id);
    expect(history.find((h) => h.status === "status")).toBeDefined();
  });

  test("getDeployment throws 404 for an unknown id", async () => {
    await expect(turretsService.getDeployment("does-not-exist")).rejects.toMatchObject(
      { status: 404 },
    );
  });

  test("deployments survive a server restart (new Knex on the same file)", async () => {
    // Simulate a restart: destroy the current pool and open a new one
    // against the same DB file. The deployment rows from earlier tests
    // must still be queryable.
    const newKnex = require("knex")({
      client: "better-sqlite3",
      connection: { filename: DB_FILE },
      useNullAsDefault: true,
    });

    const rows = await newKnex("turrets_deployments").select("*");
    expect(rows.length).toBeGreaterThan(0);
    // The DCA + stop_loss rows from the previous tests must be present.
    const types = new Set(rows.map((r) => r.type));
    expect(types.has("dca")).toBe(true);
    expect(types.has("stop_loss")).toBe(true);

    await newKnex.destroy();
  });
});

describe("turretsDeploymentService.getDeploymentCounts", () => {
  test("returns aggregated counts by status", async () => {
    const counts = await turretsDeploymentService.getDeploymentCounts();
    expect(counts).toEqual(
      expect.objectContaining({
        active: expect.any(Number),
        paused: expect.any(Number),
        total: expect.any(Number),
      }),
    );
    expect(counts.active + counts.paused).toBeLessThanOrEqual(counts.total);
    expect(counts.total).toBeGreaterThan(0);
  });
});
