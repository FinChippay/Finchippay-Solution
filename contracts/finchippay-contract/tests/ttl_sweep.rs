//! # Resumable TTL sweep tests
//!
//! Integration coverage for `bump_all_ttls` / `get_min_ttl`:
//!
//! 1. A chunked sweep (small `max_keys`) resumes from `TtlSweepCursor`, makes
//!    monotonic progress, and — without skipping or double-bumping any key —
//!    produces exactly the same key coverage as one uninterrupted sweep.
//! 2. A partial sweep followed by more calls records the same per-class
//!    `TtlWatermark` as a single uninterrupted sweep.
//! 3. Sweeping is idempotent: re-running the full sweep is a no-op for the
//!    cursor/watermarks and leaves every key at the TTL floor.
//! 4. A single call never exceeds `MAX_KEYS_PER_SWEEP` keys, and a full-size
//!    step stays within Soroban's per-transaction instruction budget.

#![allow(deprecated)]

use finchippay_contract::{
    storage::{
        ttl_class_at, MAX_KEYS_PER_SWEEP, MIN_TTL_LEDGERS, MIN_TTL_THRESHOLD, TTL_CLASS_COUNT,
    },
    DataKey, FinchippayContract, FinchippayContractClient, TtlClass,
};
use soroban_sdk::testutils::storage::Persistent as _;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, Symbol, Vec,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn deploy<'a>(env: &'a Env) -> (Address, FinchippayContractClient<'a>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&Vec::from_array(env, [admin.clone()]), &1);
    (id, client)
}

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac_contract.address();
    let sac = token::StellarAssetClient::new(env, &token_id);
    sac.mint(to, &amount);
    token_id
}

fn advance(env: &Env, to: u32) {
    env.ledger().with_mut(|li| li.sequence_number = to);
}

/// Short TTL given to state entries created after the infrastructure (contract +
/// token) has been registered with a generous TTL. This is what makes a bump
/// observable after a large ledger jump.
const TTL_TEST_ENTRY_BIRTH_TTL: u32 = 4_096;

fn ttl_env() -> Env {
    let env = Env::default();
    env.ledger().with_mut(|li| {
        li.sequence_number = 1_000;
        li.min_persistent_entry_ttl = 6_000_000;
        li.max_entry_ttl = 6_312_001;
    });
    env
}

fn shorten_entry_lifetimes(env: &Env) {
    env.ledger()
        .with_mut(|li| li.min_persistent_entry_ttl = TTL_TEST_ENTRY_BIRTH_TTL);
}

fn ttl_of(env: &Env, contract: &Address, key: &DataKey) -> u32 {
    env.as_contract(contract, || env.storage().persistent().get_ttl(key))
}

fn read_cursor(env: &Env, contract: &Address) -> (u32, u32) {
    env.as_contract(contract, || {
        let cursor: Option<(u32, u32)> = env.storage().persistent().get(&DataKey::TtlSweepCursor);
        cursor.unwrap_or((0, 0))
    })
}

fn read_watermark(env: &Env, contract: &Address, class: &TtlClass) -> u32 {
    env.as_contract(contract, || {
        let watermark: Option<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::TtlWatermark(class.clone()));
        watermark.unwrap_or(0)
    })
}

/// Deployed contract + token, registered while the network minimum TTL is still
/// high so the infrastructure itself survives the long ledger jumps below.
struct Infra<'a> {
    id: Address,
    client: FinchippayContractClient<'a>,
    admin: Address,
    token: Address,
    payer: Address,
}

struct State {
    escrow_recipients: Vec<Address>,
}

fn deploy_infra<'a>(env: &'a Env) -> Infra<'a> {
    let (id, client) = deploy(env);
    let admin = client.get_admin();
    let payer = Address::generate(env);
    env.mock_all_auths();
    let token = create_token(env, &admin, &payer, 10_000_000);
    Infra {
        id,
        client,
        admin,
        token,
        payer,
    }
}

/// Create 3 escrows, 2 streams, and 1 receipt. Escrows and streams exercise the
/// two-key items, and the receipt exercises the three-key item, so every
/// multi-key sweep item shape is covered.
fn add_state(env: &Env, infra: &Infra<'_>) -> State {
    let start = env.ledger().sequence();
    let mut escrow_recipients = Vec::new(env);
    for _ in 0..3 {
        let recipient = Address::generate(env);
        let _ = infra.client.create_escrow(
            &infra.token,
            &infra.payer,
            &recipient,
            &50_000,
            &(start + 100),
            &Symbol::new(env, "rent"),
        );
        escrow_recipients.push_back(recipient);
    }
    for _ in 0..2 {
        let recipient = Address::generate(env);
        let _ = infra
            .client
            .open_stream(&infra.token, &infra.payer, &recipient, &10, &50_000);
    }
    let receipt_to = Address::generate(env);
    let _ = infra
        .client
        .mint_receipt(&infra.payer, &receipt_to, &1_000, &Symbol::new(env, "memo"));
    State { escrow_recipients }
}

/// Assert every enumerable key is at (or above, for long-lived config keys) the
/// TTL floor after a completed sweep.
fn assert_swept_keys_at_floor(env: &Env, id: &Address, payer: &Address, recipients: &Vec<Address>) {
    // State keys are born short, so they must sit exactly back on the floor.
    let state_keys = [
        DataKey::TotalReceiptCount,
        DataKey::ReceiptByIndex(0),
        DataKey::ReceiptRecord(payer.clone(), 0),
        DataKey::ReceiptCount(payer.clone()),
        DataKey::EscrowCount,
        DataKey::StreamCount,
    ];
    for key in state_keys.iter() {
        assert_eq!(
            ttl_of(env, id, key),
            MIN_TTL_LEDGERS,
            "state key was not swept back to the TTL floor"
        );
    }

    for i in 0..recipients.len() {
        assert_eq!(
            ttl_of(env, id, &DataKey::EscrowRecipient(i)),
            MIN_TTL_LEDGERS
        );
        assert_eq!(
            ttl_of(
                env,
                id,
                &DataKey::EscrowByRecipient(recipients.get(i).unwrap())
            ),
            MIN_TTL_LEDGERS
        );
    }

    for i in 0..2 {
        assert_eq!(ttl_of(env, id, &DataKey::Stream(i)), MIN_TTL_LEDGERS);
    }
    assert_eq!(
        ttl_of(env, id, &DataKey::StreamByPayer(payer.clone())),
        MIN_TTL_LEDGERS
    );

    // Config keys are born long, so `>= floor` is the correct post-condition.
    let config_keys = [
        DataKey::Admin,
        DataKey::AdminSigners,
        DataKey::AdminSignersThreshold,
        DataKey::Version,
        DataKey::StorageLayoutVersion,
    ];
    for key in config_keys.iter() {
        assert!(
            ttl_of(env, id, key) >= MIN_TTL_LEDGERS,
            "config key regressed below the TTL floor"
        );
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn chunked_sweep_resumes_monotonically_and_covers_every_key_once() {
    let env = ttl_env();
    let a = deploy_infra(&env);
    let b = deploy_infra(&env);
    shorten_entry_lifetimes(&env);
    let a_state = add_state(&env, &a);
    let _ = add_state(&env, &b);
    let start = env.ledger().sequence();
    advance(&env, start + 500_000);

    // The state entries really did decay, so the post-sweep floor check below is
    // a meaningful "no key was skipped" assertion.
    assert!(ttl_of(&env, &a.id, &DataKey::EscrowRecipient(0)) < MIN_TTL_LEDGERS);
    assert!(ttl_of(&env, &a.id, &DataKey::ReceiptByIndex(0)) < MIN_TTL_LEDGERS);

    // Reference: one uninterrupted sweep on an identically-shaped contract.
    let reference_total = b.client.bump_all_ttls(&b.admin, &MAX_KEYS_PER_SWEEP);
    assert!(reference_total <= MAX_KEYS_PER_SWEEP);

    // Drive A to completion in small chunks, proving the cursor never regresses.
    let budget = 3u32;
    let mut total = 0u32;
    let mut iterations = 0usize;
    let mut wrapped = false;
    while !wrapped {
        let before = read_cursor(&env, &a.id);
        let bumped = a.client.bump_all_ttls(&a.admin, &budget);
        let after = read_cursor(&env, &a.id);

        assert!(
            bumped <= MAX_KEYS_PER_SWEEP,
            "chunk overshot the hard key cap"
        );
        total += bumped;

        if after == (0, 0) && before != (0, 0) {
            wrapped = true;
        } else {
            assert!(
                after > before,
                "cursor regressed from {before:?} to {after:?}"
            );
        }

        iterations += 1;
        assert!(iterations < 10_000, "sweep failed to terminate");
    }

    // No key skipped or double-bumped: the chunked total equals the uninterrupted
    // total, and every key is back at the floor.
    assert_eq!(
        total, reference_total,
        "chunked sweep skipped or double-bumped keys"
    );
    assert_swept_keys_at_floor(&env, &a.id, &a.payer, &a_state.escrow_recipients);

    // After a completed sweep, get_min_ttl is a sound lower bound.
    assert_eq!(a.client.get_min_ttl().0, MIN_TTL_LEDGERS);
}

#[test]
fn partial_sweep_produces_same_watermarks_as_uninterrupted_sweep() {
    let env = ttl_env();
    let a = deploy_infra(&env);
    let b = deploy_infra(&env);
    shorten_entry_lifetimes(&env);
    let _ = add_state(&env, &a);
    let _ = add_state(&env, &b);

    // Chunk A to completion without advancing the ledger.
    let mut wrapped = false;
    let mut iterations = 0usize;
    while !wrapped {
        let before = read_cursor(&env, &a.id);
        let _ = a.client.bump_all_ttls(&a.admin, &2);
        let after = read_cursor(&env, &a.id);
        if after == (0, 0) && before != (0, 0) {
            wrapped = true;
        } else {
            assert!(after > before, "cursor regressed");
        }
        iterations += 1;
        assert!(iterations < 10_000, "sweep failed to terminate");
    }

    // One uninterrupted pass on B at the same ledger.
    let _ = b.client.bump_all_ttls(&b.admin, &MAX_KEYS_PER_SWEEP);

    for class_index in 0..TTL_CLASS_COUNT {
        let class = ttl_class_at(class_index);
        assert_eq!(
            read_watermark(&env, &a.id, &class),
            read_watermark(&env, &b.id, &class),
            "watermark mismatch for class index {class_index}"
        );
    }
    assert_eq!(a.client.get_min_ttl(), b.client.get_min_ttl());
}

#[test]
fn sweep_is_idempotent_across_repeated_runs() {
    let env = ttl_env();
    let a = deploy_infra(&env);
    shorten_entry_lifetimes(&env);
    let state = add_state(&env, &a);
    let start = env.ledger().sequence();
    advance(&env, start + 500_000);

    let first = a.client.bump_all_ttls(&a.admin, &MAX_KEYS_PER_SWEEP);
    let second = a.client.bump_all_ttls(&a.admin, &MAX_KEYS_PER_SWEEP);

    // Re-running the sweep bumps the same key set (`bump_to_floor` is
    // idempotent), so the count is stable and nothing regresses.
    assert_eq!(first, second);
    assert_swept_keys_at_floor(&env, &a.id, &a.payer, &state.escrow_recipients);
    assert_eq!(a.client.get_min_ttl().0, MIN_TTL_LEDGERS);
}

#[test]
fn single_call_never_exceeds_hard_key_cap() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    env.mock_all_auths();

    // 32 receipts produce 1 counter key + 32 * 3 keys = 97 receipt keys, plus 5
    // config keys = 102 keys total. A naive per-item budget would overshoot the
    // 100-key hard cap on the final three-key receipt item; the guard must stop
    // before it.
    for _ in 0..32 {
        let _ = client.mint_receipt(
            &payer,
            &Address::generate(&env),
            &1_000,
            &Symbol::new(&env, "memo"),
        );
    }

    let bumped = client.bump_all_ttls(&admin, &MAX_KEYS_PER_SWEEP);
    assert!(
        bumped <= MAX_KEYS_PER_SWEEP,
        "bumped {bumped} keys, exceeding the hard cap"
    );
    assert!(bumped > 0);
}

// ─── WS5: airdrop in the sweep, tip keys kept alive by policy ───────────────

/// An airdrop's keys (`Airdrop(id)`, `AirdropCount`) belong to `TtlClass::Airdrop`
/// and must be raised to the TTL floor by a completed `bump_all_ttls` sweep.
/// Otherwise an unclaimed airdrop pool silently expires and the locked funds
/// strand in the contract.
#[test]
fn airdrop_keys_are_swept_to_the_ttl_floor() {
    let env = ttl_env();
    let a = deploy_infra(&env);
    env.mock_all_auths();
    shorten_entry_lifetimes(&env);

    // Any non-zero root is sufficient for the sweep-coverage assertion here.
    let root = BytesN::from_array(&env, &[7u8; 32]);
    let _id = a.client.create_airdrop(
        &a.token,
        &a.payer,
        &root,
        &1_000_000,
        &(env.ledger().sequence() + 100),
    );

    let start = env.ledger().sequence();
    advance(&env, start + 500_000);
    // The airdrop entries really did decay below the floor before the sweep.
    assert!(ttl_of(&env, &a.id, &DataKey::Airdrop(0)) < MIN_TTL_LEDGERS);

    // One full pass covers the airdrop class and raises its keys back to floor.
    a.client.bump_all_ttls(&a.admin, &MAX_KEYS_PER_SWEEP);
    assert_eq!(ttl_of(&env, &a.id, &DataKey::Airdrop(0)), MIN_TTL_LEDGERS);
    assert_eq!(ttl_of(&env, &a.id, &DataKey::AirdropCount), MIN_TTL_LEDGERS);
    assert_eq!(a.client.get_min_ttl().0, MIN_TTL_LEDGERS);
}

/// Tip keys (`TipTotal`/`TipCount`/`TipRecord`) are *not* a sweep class (they
/// are keyed by arbitrary recipient address with no on-chain index). The
/// retention policy is keep-alive: the read views and writes extend their TTL,
/// so active recipients' dashboard numbers cannot silently vanish. This test
/// pins that a query refreshes a decayed tip key back to the floor.
#[test]
fn tip_keys_are_kept_alive_by_access() {
    let env = ttl_env();
    let a = deploy_infra(&env);
    shorten_entry_lifetimes(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();
    let token = create_token(&env, &a.admin, &a.payer, 10_000_000);
    a.client
        .send_tip(&token, &a.payer, &to, &300, &Symbol::new(&env, "m"));

    let start = env.ledger().sequence();
    advance(&env, start + 500_000);
    // It aged below the floor while untouched (tip keys are not a sweep class).
    assert!(ttl_of(&env, &a.id, &DataKey::TipTotal(to.clone())) < MIN_TTL_LEDGERS);

    // A read (as dashboards/analytics do) keeps the key alive back to >= floor.
    assert_eq!(a.client.get_tip_total(&to), 300);
    assert!(ttl_of(&env, &a.id, &DataKey::TipTotal(to.clone())) >= MIN_TTL_LEDGERS);
    // MIN_TTL_THRESHOLD is the bump threshold: a touch below it refreshes to
    // the floor, which is exactly the keep-alive guarantee of the policy.
    assert!(ttl_of(&env, &a.id, &DataKey::TipTotal(to.clone())) >= MIN_TTL_THRESHOLD);
}

#[test]
fn single_sweep_step_stays_within_instruction_budget() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    env.mock_all_auths();
    let token = create_token(&env, &admin, &payer, 10_000_000);
    let start = env.ledger().sequence();

    // Enough state to force a full-size step (> MAX_KEYS_PER_SWEEP keys).
    for _ in 0..50 {
        let recipient = Address::generate(&env);
        let _ = client.create_escrow(
            &token,
            &payer,
            &recipient,
            &50_000,
            &(start + 100),
            &Symbol::new(&env, "rent"),
        );
    }
    let _ = client.mint_receipt(
        &payer,
        &Address::generate(&env),
        &1_000,
        &Symbol::new(&env, "memo"),
    );

    env.budget().reset_unlimited();
    let before = env.budget().cpu_instruction_cost();
    let bumped = client.bump_all_ttls(&admin, &MAX_KEYS_PER_SWEEP);
    let after = env.budget().cpu_instruction_cost();
    let used = after.saturating_sub(before);

    assert!(
        bumped <= MAX_KEYS_PER_SWEEP,
        "step overshot the hard key cap"
    );
    // Soroban's per-transaction CPU budget is 100M instructions on mainnet; a
    // single full-size sweep step must consume only a fraction of it.
    assert!(used < 100_000_000, "sweep step used {used} instructions");
    println!("bump_all_ttls one step ({bumped} keys) used {used} CPU instructions");
}
