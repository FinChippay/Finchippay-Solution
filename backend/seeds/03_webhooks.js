/**
 * Seed: webhooks
 *
 * Development-only sample webhook registration. Resets the table so re-running
 * produces a deterministic set. Skipped in production.
 */

const { ACCOUNTS } = require("./01_usernames");

exports.seed = async function (knex) {
  if (process.env.NODE_ENV === "production") return;

  await knex("webhooks").del();
  await knex("webhooks").insert([
    {
      id: "seed-webhook-1",
      public_key: ACCOUNTS.alice,
      url: "https://example.com/webhooks/finchippay",
      secret: "seed-webhook-secret-do-not-use-in-prod",
      created_at: new Date().toISOString(),
    },
  ]);
};
