/**
 * Seed: usernames
 *
 * Development-only seed data. Populates the reserved "alice" federation
 * mapping (relied on by the account controller tests) plus a couple of test
 * accounts. Idempotent — existing rows are left untouched.
 *
 * Shared test public keys are exported for reuse by the tips/webhooks seeds.
 */

const ACCOUNTS = {
  alice: "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW",
  bob: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
  carol: "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
};

exports.ACCOUNTS = ACCOUNTS;

exports.seed = async function (knex) {
  if (process.env.NODE_ENV === "production") return;

  await knex("usernames")
    .insert([
      {
        username: "alice",
        public_key: ACCOUNTS.alice,
        registered_at: new Date().toISOString(),
      },
      {
        username: "bob",
        public_key: ACCOUNTS.bob,
        registered_at: new Date().toISOString(),
      },
      {
        username: "carol",
        public_key: ACCOUNTS.carol,
        registered_at: new Date().toISOString(),
      },
    ])
    .onConflict("username")
    .ignore();
};
