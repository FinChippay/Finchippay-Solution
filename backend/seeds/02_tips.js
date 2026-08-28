/**
 * Seed: tips
 *
 * Development-only sample tips between the seeded test accounts. Resets the
 * table so re-running produces a deterministic set. Skipped in production.
 */

const { ACCOUNTS } = require("./01_usernames");

exports.seed = async function (knex) {
  if (process.env.NODE_ENV === "production") return;

  await knex("tips").del();
  await knex("tips").insert([
    {
      sender_pk: ACCOUNTS.bob,
      creator_pk: ACCOUNTS.alice,
      amount: "10.0000000",
      asset: "XLM",
      memo: "Great work!",
      tx_hash: "seedtx0000000000000000000000000000000000000000000000000000000001",
    },
    {
      sender_pk: ACCOUNTS.carol,
      creator_pk: ACCOUNTS.alice,
      amount: "5.5000000",
      asset: "XLM",
      memo: "Thanks for the stream",
      tx_hash: "seedtx0000000000000000000000000000000000000000000000000000000002",
    },
    {
      sender_pk: ACCOUNTS.alice,
      creator_pk: ACCOUNTS.bob,
      amount: "2.0000000",
      asset: "XLM",
      memo: "",
      tx_hash: "seedtx0000000000000000000000000000000000000000000000000000000003",
    },
  ]);
};
