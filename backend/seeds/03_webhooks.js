/**
 * Seed: webhooks
 *
 * Development-only sample webhook registration. Resets the table so re-running
 * produces a deterministic set. Skipped in production.
 */

const crypto = require("crypto");
const { ACCOUNTS } = require("./01_usernames");

/**
 * Development-only seed. Generates a cryptographically random webhook secret
 * for each seed run so no hardcoded value ever reaches a deployed environment.
 * Skipped entirely in production.
 */
exports.seed = async function (knex) {
  if (process.env.NODE_ENV === "production") return;

  await knex("webhooks").del();
  await knex("webhooks").insert([
    {
      id: "seed-webhook-1",
      public_key: ACCOUNTS.alice,
      url: "https://example.com/webhooks/finchippay",
      secret: `whsec_${crypto.randomBytes(32).toString("hex")}`,
      created_at: new Date().toISOString(),
    },
  ]);
};
