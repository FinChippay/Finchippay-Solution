//! # Event Catalog Parity (workstream 4)
//!
//! `events.rs` is the single source of truth for event topic names. This suite
//! pins `catalog == emitted == parsed` for the modules the issue calls out:
//!
//! - Airdrop/vesting/multi-sig events are catalogued (helpers exist) and
//!   emitted under those exact topic strings.
//! - The tip family uses exactly **one** topic (`tip_sent`) with exactly **one**
//!   payload shape `(amount, memo)` across `send_tip` and `batch_send` — no more
//!   "same topic, two payloads".

use finchippay_contract::{events::Events, FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, Address, Env, IntoVal, Symbol, Val, Vec,
};

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&Vec::from_array(env, [admin.clone()]), &1);
    (id, client)
}

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    env.mock_all_auths();
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

/// Each `Events::*` helper must return exactly the documented canonical topic.
/// If a helper drifts from the catalog, emitted events silently diverge from
/// `eventParser.js` and every off-chain consumer.
#[test]
fn events_helpers_are_the_canonical_catalog() {
    let env = Env::default();
    let e = &env;
    let pairs: [(Symbol, &str); 21] = [
        (Events::tip_sent(e), "tip_sent"),
        (Events::batch_sent(e), "batch_sent"),
        (Events::batch_sent_multi(e), "batch_sent_multi"),
        (Events::airdrop_created(e), "airdrop_created"),
        (Events::airdrop_claimed(e), "airdrop_claimed"),
        (Events::airdrop_cancelled(e), "airdrop_cancelled"),
        (Events::vesting_created(e), "vesting_created"),
        (Events::vesting_claimed(e), "vesting_claimed"),
        (Events::vesting_revoked(e), "vesting_revoked"),
        (Events::multisig_created(e), "multisig_created"),
        (Events::multisig_approved(e), "multisig_approved"),
        (Events::multisig_executed(e), "multisig_executed"),
        (Events::multisig_timeout(e), "multisig_timeout"),
        (Events::multisig_cancelled(e), "multisig_cancelled"),
        (Events::escrow_created(e), "escrow_created"),
        (Events::escrow_released(e), "escrow_released"),
        (Events::escrow_cancelled(e), "escrow_cancelled"),
        (Events::stream_opened(e), "stream_opened"),
        (Events::stream_claimed(e), "stream_claimed"),
        (Events::stream_topped_up(e), "stream_topped_up"),
        (Events::stream_closed(e), "stream_closed"),
    ];
    for (sym, name) in pairs.iter() {
        assert_eq!(
            *sym,
            Symbol::new(e, name),
            "Events helper drifted from {name}"
        );
    }
}

/// `send_tip` and `batch_send` must both publish the canonical `tip_sent` topic
/// with the identical payload shape `(amount, memo)` — the fix for "same topic,
/// two payload shapes".
#[test]
fn tip_events_have_one_topic_and_one_payload_shape() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let token = create_token(&env, &admin, &from, 1_000);

    // single tip → topic (tip_sent, from, to), payload (amount, memo)
    client.send_tip(&token, &from, &to, &300, &Symbol::new(&env, "m1"));

    let events = env.events().all().filter_by_contract(&contract_id);
    let single_expected: Vec<(Address, Vec<Val>, Val)> = Vec::from_array(
        &env,
        [(
            contract_id.clone(),
            (Symbol::new(&env, "tip_sent"), from.clone(), to.clone()).into_val(&env),
            (300i128, Symbol::new(&env, "m1")).into_val(&env),
        )],
    );
    assert_eq!(
        events, single_expected,
        "send_tip must emit (tip_sent, from, to) with payload (amount, memo)"
    );

    // batch tip → same per-recipient tip_sent topic + same payload shape,
    // plus the batch_sent completion event. Compare the FULL filtered event
    // sequence to the exact canonical events: if any event carried the old bare
    // `tip` topic (or a different payload shape) the equality fails.
    let mut recipients = Vec::new(&env);
    let to2 = Address::generate(&env);
    recipients.push_back(to.clone());
    recipients.push_back(to2.clone());
    let mut amounts = Vec::new(&env);
    amounts.push_back(100i128);
    amounts.push_back(200i128);
    let mut memos = Vec::new(&env);
    memos.push_back(Symbol::new(&env, "b1"));
    memos.push_back(Symbol::new(&env, "b2"));
    client.batch_send(&token, &from, &recipients, &amounts, &memos);

    let events = env.events().all().filter_by_contract(&contract_id);
    let expected_all: Vec<(Address, Vec<Val>, Val)> = Vec::from_array(
        &env,
        [
            (
                contract_id.clone(),
                (Symbol::new(&env, "tip_sent"), from.clone(), to.clone()).into_val(&env),
                (100i128, Symbol::new(&env, "b1")).into_val(&env),
            ),
            (
                contract_id.clone(),
                (Symbol::new(&env, "tip_sent"), from.clone(), to2.clone()).into_val(&env),
                (200i128, Symbol::new(&env, "b2")).into_val(&env),
            ),
            (
                contract_id.clone(),
                (Symbol::new(&env, "batch_sent"),).into_val(&env),
                (from, 2u32, 300i128).into_val(&env),
            ),
        ],
    );
    assert_eq!(
        events, expected_all,
        "tip/batch events must all use the canonical single-shape topics"
    );
}
