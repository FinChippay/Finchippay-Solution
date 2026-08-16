//! # Escrow & Dispute Resolution
//!
//! Time-locked token custody with claim/cancel flows and arbitrator-mediated
//! dispute resolution. Extracted from the main FinchippayContract impl.

use soroban_sdk::{token, Address, Env, Symbol, Vec};

use crate::{
    contract_transfer_out, decrease_locked_balance, get_admin, get_token_client,
    increase_locked_balance, require_initialized, require_not_paused, require_transfer_succeeded,
    ContractError, DataKey, Escrow, EscrowStatus, ARBITRATOR_SLASH_BPS, DISPUTE_REVIEW_LEDGERS,
    MAX_APPEAL_DEPTH, MAX_ESCROW_AMOUNT, MAX_ESCROW_LEDGERS, MAX_USER_ESCROWS,
    MIN_ARBITRATOR_STAKE, MIN_ESCROW_AMOUNT,
};

use crate::storage::*;

fn increase_arbitrator_assignments(env: &Env, arbitrator: &Address) {
    let key = DataKey::ArbitratorActiveEscrows(arbitrator.clone());
    let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
    let updated = current.checked_add(1).expect("assignment count overflow");
    env.storage().persistent().set(&key, &updated);
    bump_to_floor(env, &key);
}

fn decrease_arbitrator_assignments(env: &Env, arbitrator: &Address) {
    let key = DataKey::ArbitratorActiveEscrows(arbitrator.clone());
    let current: u32 = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Arbitrator assignment count not found");
    let updated = current.checked_sub(1).expect("assignment count underflow");
    env.storage().persistent().set(&key, &updated);
    bump(env, &key);
}
/// Lock `amount` tokens from `from` until `release_ledger`. Returns the escrow ID.
///
/// Funds are held by the contract itself until `claim_escrow` or `cancel_escrow`.
///
/// # Errors
/// - Returns `ContractError::IndexFull` if `to` already has `MAX_USER_ESCROWS`
///   escrows tracked in its recipient index, before any funds move.
pub fn create_escrow(
    env: Env,
    token_address: Address,
    from: Address,
    to: Address,
    amount: i128,
    release_ledger: u32,
    memo: Symbol,
) -> Result<u32, ContractError> {
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();
    if from == to {
        panic!("cannot create escrow to yourself");
    }
    if amount <= 0 {
        panic!("amount must be positive");
    }
    if amount > MAX_ESCROW_AMOUNT {
        panic!("amount exceeds maximum escrow size");
    }
    if amount < MIN_ESCROW_AMOUNT {
        panic!("amount below minimum escrow size");
    }
    if release_ledger <= env.ledger().sequence() {
        panic!("release_ledger must be in the future");
    }
    if release_ledger > env.ledger().sequence() + MAX_ESCROW_LEDGERS {
        panic!("release_ledger is too far in the future");
    }

    // Enforce the recipient escrow index cap before any funds move, so a
    // rejected call has no side effects.
    let rkey = DataKey::EscrowByRecipient(to.clone());
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .unwrap_or(Vec::new(&env));
    if r_escrows.len() >= MAX_USER_ESCROWS {
        return Err(ContractError::IndexFull);
    }

    let token = get_token_client(&env, &token_address);
    let contract_address = env.current_contract_address();
    require_transfer_succeeded(&env, &token, &from, &contract_address, &amount);
    increase_locked_balance(&env, &token_address, amount);

    let next_id: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowCount)
        .unwrap_or(0);
    let escrow = Escrow {
        id: next_id,
        from: from.clone(),
        to: to.clone(),
        token: token_address,
        amount,
        release_ledger,
        status: EscrowStatus::Pending,
        memo,
        arbitrator: Option::None,
        disputed: false,
        dispute_raised_by: Option::None,
        dispute_raised_at: 0,
        appeal_depth: 0,
        appeal_arbitrator: Option::None,
        resolution_ledger: 0,
    };

    env.storage()
        .persistent()
        .set(&DataKey::EscrowRecipient(next_id), &to);
    bump_to_floor(&env, &DataKey::EscrowRecipient(next_id));

    env.storage()
        .persistent()
        .set(&DataKey::EscrowCount, &(next_id + 1));
    bump(&env, &DataKey::EscrowCount);

    r_escrows.push_back(escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump_to_floor(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "escrow_create"), next_id),
        (from.clone(), to.clone(), amount, release_ledger),
    );
    Ok(next_id)
}

/// Claim a partial amount from the escrow. The caller must be the
/// escrow recipient and the release ledger must have passed.
/// Returns the remaining escrow amount after the partial claim.
pub fn claim_escrow_partial(env: Env, id: u32, claim_amount: i128) -> i128 {
    require_not_paused(&env);
    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(id))
        .expect("escrow recipient not found");
    bump(&env, &DataKey::EscrowRecipient(id));

    let rkey = DataKey::EscrowByRecipient(recipient);
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .expect("escrow list not found");

    let mut found_index = None;
    let mut escrow = None;
    for i in 0..r_escrows.len() {
        let e = r_escrows.get(i).unwrap();
        if e.id == id {
            found_index = Some(i);
            escrow = Some(e);
            break;
        }
    }

    let mut escrow = escrow.expect("escrow not found");
    let idx = found_index.unwrap();

    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
    }
    if escrow.disputed {
        panic!("disputed escrow must be resolved by its arbitrator");
    }
    if env.ledger().sequence() < escrow.release_ledger {
        panic!("release_ledger not reached");
    }
    escrow.to.require_auth();
    if claim_amount <= 0 {
        panic!("claim amount must be positive");
    }
    if claim_amount > escrow.amount {
        panic!("claim amount exceeds escrow balance");
    }

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.to, &claim_amount);
    decrease_locked_balance(&env, &escrow.token, claim_amount);

    let remaining = escrow.amount.checked_sub(claim_amount).expect("overflow");
    if remaining == 0 {
        escrow.status = EscrowStatus::Released;
        if let Some(arbitrator) = escrow.arbitrator.clone() {
            decrease_arbitrator_assignments(&env, &arbitrator);
        }
    }
    escrow.amount = remaining;

    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "escrow_claim_partial"), id),
        (escrow.to.clone(), claim_amount, remaining),
    );
    remaining
}

/// Return the list of escrow IDs associated with a recipient address.
pub fn get_user_escrows(env: Env, recipient: Address) -> Vec<u32> {
    let key = DataKey::EscrowByRecipient(recipient);
    let val: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(&env));
    if env.storage().persistent().has(&key) {
        bump(&env, &key);
    }
    let mut ids = Vec::new(&env);
    for escrow in val.iter() {
        ids.push_back(escrow.id);
    }
    ids
}

/// Recipient claims the escrowed funds after `release_ledger` has passed.
pub fn claim_escrow(env: Env, id: u32) {
    require_not_paused(&env);
    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(id))
        .expect("escrow recipient not found");
    bump(&env, &DataKey::EscrowRecipient(id));

    let rkey = DataKey::EscrowByRecipient(recipient);
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .expect("escrow list not found");

    let mut found_index = None;
    let mut escrow = None;
    for i in 0..r_escrows.len() {
        let e = r_escrows.get(i).unwrap();
        if e.id == id {
            found_index = Some(i);
            escrow = Some(e);
            break;
        }
    }

    let mut escrow = escrow.expect("escrow not found");
    let idx = found_index.unwrap();

    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
    }
    if escrow.disputed {
        panic!("disputed escrow must be resolved by its arbitrator");
    }
    if env.ledger().sequence() < escrow.release_ledger {
        panic!("release_ledger not reached");
    }
    escrow.to.require_auth();

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.to, &escrow.amount);
    decrease_locked_balance(&env, &escrow.token, escrow.amount);

    escrow.status = EscrowStatus::Released;
    if let Some(arbitrator) = escrow.arbitrator.clone() {
        decrease_arbitrator_assignments(&env, &arbitrator);
    }
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "escrow_claim"), id),
        (escrow.to, escrow.amount),
    );
}

/// Payer cancels the escrow before `release_ledger`; funds are returned.
pub fn cancel_escrow(env: Env, id: u32) {
    require_not_paused(&env);
    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(id))
        .expect("escrow recipient not found");
    bump(&env, &DataKey::EscrowRecipient(id));

    let rkey = DataKey::EscrowByRecipient(recipient);
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .expect("escrow list not found");

    let mut found_index = None;
    let mut escrow = None;
    for i in 0..r_escrows.len() {
        let e = r_escrows.get(i).unwrap();
        if e.id == id {
            found_index = Some(i);
            escrow = Some(e);
            break;
        }
    }

    let mut escrow = escrow.expect("escrow not found");
    let idx = found_index.unwrap();

    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
    }
    if escrow.disputed {
        panic!("disputed escrow must be resolved by its arbitrator");
    }
    if env.ledger().sequence() >= escrow.release_ledger {
        panic!("release_ledger already reached — cancellation is no longer allowed");
    }
    escrow.from.require_auth();

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.from, &escrow.amount);
    decrease_locked_balance(&env, &escrow.token, escrow.amount);

    escrow.status = EscrowStatus::Cancelled;
    if let Some(arbitrator) = escrow.arbitrator.clone() {
        decrease_arbitrator_assignments(&env, &arbitrator);
    }
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "escrow_cancelled"),),
        (id, escrow.from, escrow.amount),
    );
}

pub fn get_escrow(env: Env, id: u32) -> Result<Escrow, ContractError> {
    let recipient: Address = match env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(id))
    {
        Some(r) => r,
        None => return Err(ContractError::NotFound),
    };

    let rkey = DataKey::EscrowByRecipient(recipient);
    let r_escrows: Vec<Escrow> = match env.storage().persistent().get(&rkey) {
        Some(e) => e,
        None => return Err(ContractError::NotFound),
    };

    for escrow in r_escrows.iter() {
        if escrow.id == id {
            bump(&env, &DataKey::EscrowRecipient(id));
            bump(&env, &rkey);
            return Ok(escrow);
        }
    }
    Err(ContractError::NotFound)
}

/// Return the total number of escrows ever created.
pub fn get_escrow_count(env: Env) -> u32 {
    let key = DataKey::EscrowCount;
    let count = env.storage().persistent().get(&key).unwrap_or(0);
    bump_if_present(&env, &key);
    count
}

/// Stable alias for `get_escrow_count`. Provides a consistent SDK
/// binding for dashboard and analytics consumers.
pub fn escrow_count(env: Env) -> u32 {
    {
        let key = DataKey::EscrowCount;
        let c = env.storage().persistent().get(&key).unwrap_or(0);
        bump_if_present(&env, &key);
        c
    }
}

// ─── Dispute resolution ──────────────────────────────────────────────────

pub fn add_arbitrator(
    env: Env,
    admin: Address,
    arbitrator: Address,
    stake_token: Address,
    stake_amount: i128,
    tier: u32,
) {
    admin.require_auth();
    let stored = get_admin(&env);
    if admin != stored {
        panic!("Unauthorized");
    }
    register_arbitrator_with_tier(env, arbitrator, stake_amount, stake_token, tier);
}

/// Register a primary arbitrator by locking the caller's own stake.
pub fn register_arbitrator(
    env: Env,
    arbitrator: Address,
    stake_amount: i128,
    stake_token: Address,
) {
    register_arbitrator_with_tier(env, arbitrator, stake_amount, stake_token, 0);
}

fn register_arbitrator_with_tier(
    env: Env,
    arbitrator: Address,
    stake_amount: i128,
    stake_token: Address,
    tier: u32,
) {
    arbitrator.require_auth();
    if stake_amount < MIN_ARBITRATOR_STAKE {
        panic!("Arbitrator stake is below the minimum");
    }
    if tier > MAX_APPEAL_DEPTH {
        panic!("Invalid arbitrator tier");
    }

    let mut arbitrators: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Arbitrators)
        .unwrap_or(Vec::new(&env));

    if arbitrators.contains(&arbitrator) {
        panic!("Arbitrator already registered");
    }

    let token = get_token_client(&env, &stake_token);
    let contract = env.current_contract_address();
    require_transfer_succeeded(&env, &token, &arbitrator, &contract, &stake_amount);
    increase_locked_balance(&env, &stake_token, stake_amount);

    env.storage()
        .persistent()
        .set(&DataKey::ArbitratorStake(arbitrator.clone()), &stake_amount);
    bump_to_floor(&env, &DataKey::ArbitratorStake(arbitrator.clone()));
    env.storage().persistent().set(
        &DataKey::ArbitratorStakeToken(arbitrator.clone()),
        &stake_token,
    );
    bump_to_floor(&env, &DataKey::ArbitratorStakeToken(arbitrator.clone()));
    env.storage()
        .persistent()
        .set(&DataKey::ArbitratorTier(arbitrator.clone()), &tier);
    bump_to_floor(&env, &DataKey::ArbitratorTier(arbitrator.clone()));

    arbitrators.push_back(arbitrator.clone());
    env.storage()
        .persistent()
        .set(&DataKey::Arbitrators, &arbitrators);
    bump_to_floor(&env, &DataKey::Arbitrators);

    let count: u32 = arbitrators.len();
    env.storage()
        .persistent()
        .set(&DataKey::ArbitratorCount, &count);
    bump_to_floor(&env, &DataKey::ArbitratorCount);

    env.events().publish(
        (Symbol::new(&env, "arbitrator_added"),),
        (arbitrator, stake_token, stake_amount, tier),
    );
}

/// Admin: remove an arbitrator from the global arbitrator list.
pub fn remove_arbitrator(env: Env, admin: Address, arbitrator: Address) {
    admin.require_auth();
    let stored = get_admin(&env);
    if admin != stored {
        panic!("Unauthorized");
    }

    let arbitrators: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Arbitrators)
        .unwrap_or_else(|| panic!("No arbitrators registered"));

    if !arbitrators.contains(&arbitrator) {
        panic!("Arbitrator not found");
    }
    let assignment_key = DataKey::ArbitratorActiveEscrows(arbitrator.clone());
    let active_escrows: u32 = env.storage().persistent().get(&assignment_key).unwrap_or(0);
    bump_if_present(&env, &assignment_key);
    if active_escrows > 0 {
        panic!("Arbitrator still has active escrows");
    }

    let mut new_list = Vec::new(&env);
    for arb in arbitrators.iter() {
        if arb != arbitrator {
            new_list.push_back(arb);
        }
    }

    env.storage()
        .persistent()
        .set(&DataKey::Arbitrators, &new_list);
    bump_to_floor(&env, &DataKey::Arbitrators);

    let count: u32 = new_list.len();
    env.storage()
        .persistent()
        .set(&DataKey::ArbitratorCount, &count);
    bump_to_floor(&env, &DataKey::ArbitratorCount);

    let stake_key = DataKey::ArbitratorStake(arbitrator.clone());
    let stake: i128 = env
        .storage()
        .persistent()
        .get(&stake_key)
        .expect("Arbitrator stake not found");
    bump(&env, &stake_key);
    let token_key = DataKey::ArbitratorStakeToken(arbitrator.clone());
    let stake_token: Address = env
        .storage()
        .persistent()
        .get(&token_key)
        .expect("Arbitrator stake token not found");
    bump(&env, &token_key);

    let token = get_token_client(&env, &stake_token);
    contract_transfer_out(&env, &token, &arbitrator, &stake);
    decrease_locked_balance(&env, &stake_token, stake);
    env.storage().persistent().remove(&stake_key);
    env.storage().persistent().remove(&token_key);
    env.storage()
        .persistent()
        .remove(&DataKey::ArbitratorTier(arbitrator.clone()));
    env.storage().persistent().remove(&assignment_key);

    env.events().publish(
        (Symbol::new(&env, "arbitrator_removed"),),
        (arbitrator, stake),
    );
}

/// Create a disputable escrow with a designated arbitrator.
/// Same as create_escrow but allows dispute resolution.
pub fn create_disputable_escrow(
    env: Env,
    token_address: Address,
    from: Address,
    to: Address,
    amount: i128,
    release_ledger: u32,
    arbitrator: Address,
) -> Result<u32, ContractError> {
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();
    if from == to {
        panic!("cannot create escrow to yourself");
    }
    if amount <= 0 {
        panic!("amount must be positive");
    }
    let current_ledger = env.ledger().sequence();
    if release_ledger <= current_ledger {
        panic!("release_ledger must be in the future");
    }

    // Validate arbitrator is registered
    let arbitrators: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Arbitrators)
        .unwrap_or_else(|| panic!("No arbitrators registered"));
    bump(&env, &DataKey::Arbitrators);
    if !arbitrators.contains(&arbitrator) {
        panic!("Arbitrator is not registered");
    }
    let stake: i128 = env
        .storage()
        .persistent()
        .get(&DataKey::ArbitratorStake(arbitrator.clone()))
        .unwrap_or(0);
    bump_if_present(&env, &DataKey::ArbitratorStake(arbitrator.clone()));
    if stake < MIN_ARBITRATOR_STAKE {
        panic!("Arbitrator does not have the minimum stake");
    }

    let rkey = DataKey::EscrowByRecipient(to.clone());
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .unwrap_or(Vec::new(&env));
    if r_escrows.len() >= MAX_USER_ESCROWS {
        return Err(ContractError::IndexFull);
    }

    let token = get_token_client(&env, &token_address);
    let contract_address = env.current_contract_address();
    require_transfer_succeeded(&env, &token, &from, &contract_address, &amount);
    increase_locked_balance(&env, &token_address, amount);
    increase_arbitrator_assignments(&env, &arbitrator);

    let next_id: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowCount)
        .unwrap_or(0);
    let escrow = Escrow {
        id: next_id,
        from: from.clone(),
        to: to.clone(),
        token: token_address,
        amount,
        release_ledger,
        status: EscrowStatus::Pending,
        memo: Symbol::new(&env, ""),
        arbitrator: Some(arbitrator.clone()),
        disputed: false,
        dispute_raised_by: Option::None,
        dispute_raised_at: 0,
        appeal_depth: 0,
        appeal_arbitrator: Option::None,
        resolution_ledger: 0,
    };

    env.storage()
        .persistent()
        .set(&DataKey::EscrowRecipient(next_id), &to);
    bump_to_floor(&env, &DataKey::EscrowRecipient(next_id));
    env.storage()
        .persistent()
        .set(&DataKey::EscrowCount, &(next_id + 1));
    bump(&env, &DataKey::EscrowCount);

    // Persist the escrow record in the recipient's escrow list (same
    // storage layout as `create_escrow`). Without this write the escrow
    // existed only transiently and could never be claimed or disputed.
    r_escrows.push_back(escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump_to_floor(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "disputable_escrow_created"),),
        (next_id, arbitrator),
    );

    Ok(next_id)
}

/// Raise a dispute on a disputable escrow. Only the sender or recipient
/// can raise a dispute.
pub fn raise_dispute(env: Env, escrow_id: u32, by: Address) {
    by.require_auth();

    // `EscrowRecipient(id)` holds the recipient address, not the escrow
    // record — load the escrow from the recipient's escrow list.
    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(escrow_id))
        .unwrap_or_else(|| panic!("Escrow not found"));
    bump(&env, &DataKey::EscrowRecipient(escrow_id));

    let rkey = DataKey::EscrowByRecipient(recipient);
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .expect("escrow list not found");

    let mut found_index = None;
    let mut escrow = None;
    for i in 0..r_escrows.len() {
        let e = r_escrows.get(i).unwrap();
        if e.id == escrow_id {
            found_index = Some(i);
            escrow = Some(e);
            break;
        }
    }

    let mut escrow = escrow.expect("escrow not found");
    let idx = found_index.unwrap();

    if escrow.arbitrator.is_none() {
        panic!("Escrow is not disputable");
    }
    if escrow.status != EscrowStatus::Pending {
        panic!("Escrow must be in pending status to dispute");
    }
    if escrow.disputed {
        panic!("Escrow is already disputed");
    }
    if by != escrow.from && by != escrow.to {
        panic!("Only escrow participants can raise a dispute");
    }

    escrow.disputed = true;
    escrow.dispute_raised_by = Some(by.clone());
    escrow.dispute_raised_at = env.ledger().sequence();
    let review_period_end = escrow
        .dispute_raised_at
        .checked_add(DISPUTE_REVIEW_LEDGERS)
        .expect("review period overflow");

    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "dispute_raised"),),
        (escrow_id, by, review_period_end),
    );
}

/// Escalate a pending dispute to a registered higher-tier arbitrator.
pub fn appeal_dispute(env: Env, escrow_id: u32, appellant: Address, appeal_to: Address) {
    appellant.require_auth();

    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(escrow_id))
        .unwrap_or_else(|| panic!("Escrow not found"));
    bump(&env, &DataKey::EscrowRecipient(escrow_id));

    let rkey = DataKey::EscrowByRecipient(recipient);
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .expect("escrow list not found");

    let mut found_index = None;
    let mut escrow = None;
    for i in 0..r_escrows.len() {
        let e = r_escrows.get(i).unwrap();
        if e.id == escrow_id {
            found_index = Some(i);
            escrow = Some(e);
            break;
        }
    }

    let mut escrow = escrow.expect("escrow not found");
    let idx = found_index.unwrap();

    if escrow.status != EscrowStatus::Pending || !escrow.disputed {
        panic!("Only an unresolved dispute can be appealed");
    }
    if appellant != escrow.from && appellant != escrow.to {
        panic!("Only escrow participants can appeal");
    }
    if escrow.appeal_depth >= MAX_APPEAL_DEPTH {
        panic!("Maximum appeal depth reached");
    }

    let now = env.ledger().sequence();
    let review_period_end = escrow
        .dispute_raised_at
        .checked_add(DISPUTE_REVIEW_LEDGERS)
        .expect("review period overflow");
    if now >= review_period_end {
        panic!("Appeal period has elapsed");
    }

    let current_arbitrator = escrow
        .arbitrator
        .clone()
        .unwrap_or_else(|| panic!("Escrow is not disputable"));
    if current_arbitrator == appeal_to {
        panic!("Appeal arbitrator must be different");
    }

    let arbitrators: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Arbitrators)
        .unwrap_or_else(|| panic!("No arbitrators registered"));
    bump(&env, &DataKey::Arbitrators);
    if !arbitrators.contains(&appeal_to) {
        panic!("Appeal arbitrator is not registered");
    }

    let current_tier = get_arbitrator_tier(env.clone(), current_arbitrator.clone());
    let appeal_tier = get_arbitrator_tier(env.clone(), appeal_to.clone());
    if appeal_tier <= current_tier {
        panic!("Appeals require a higher-tier arbitrator");
    }
    let appeal_stake = get_arbitrator_stake(env.clone(), appeal_to.clone());
    if appeal_stake < MIN_ARBITRATOR_STAKE {
        panic!("Appeal arbitrator does not have the minimum stake");
    }

    increase_arbitrator_assignments(&env, &appeal_to);
    escrow.appeal_depth = escrow.appeal_depth.checked_add(1).expect("appeal overflow");
    escrow.arbitrator = Some(appeal_to.clone());
    escrow.appeal_arbitrator = Some(appeal_to.clone());
    escrow.dispute_raised_at = now;
    let new_review_period_end = now
        .checked_add(DISPUTE_REVIEW_LEDGERS)
        .expect("review period overflow");

    env.storage().persistent().set(
        &DataKey::AppealedArbitrator(escrow_id, escrow.appeal_depth),
        &current_arbitrator,
    );
    bump_to_floor(
        &env,
        &DataKey::AppealedArbitrator(escrow_id, escrow.appeal_depth),
    );
    env.storage().persistent().set(
        &DataKey::AppealAppellant(escrow_id, escrow.appeal_depth),
        &appellant,
    );
    bump_to_floor(
        &env,
        &DataKey::AppealAppellant(escrow_id, escrow.appeal_depth),
    );

    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "dispute_appealed"),),
        (
            escrow_id,
            appellant,
            current_arbitrator,
            appeal_to,
            new_review_period_end,
        ),
    );
}

fn slash_arbitrator(env: &Env, arbitrator: &Address, beneficiary: &Address) -> i128 {
    let stake_key = DataKey::ArbitratorStake(arbitrator.clone());
    let stake: i128 = env.storage().persistent().get(&stake_key).unwrap_or(0);
    if stake <= 0 {
        return 0;
    }
    bump(env, &stake_key);

    let slash_amount = stake
        .checked_mul(ARBITRATOR_SLASH_BPS)
        .expect("slash amount overflow")
        / 10_000;
    if slash_amount <= 0 {
        return 0;
    }

    let token_key = DataKey::ArbitratorStakeToken(arbitrator.clone());
    let stake_token: Address = env
        .storage()
        .persistent()
        .get(&token_key)
        .expect("Arbitrator stake token not found");
    bump(env, &token_key);

    let token = get_token_client(env, &stake_token);
    contract_transfer_out(env, &token, beneficiary, &slash_amount);
    decrease_locked_balance(env, &stake_token, slash_amount);

    let remaining = stake.checked_sub(slash_amount).expect("stake underflow");
    env.storage().persistent().set(&stake_key, &remaining);
    bump(env, &stake_key);

    env.events().publish(
        (Symbol::new(env, "arbitrator_slashed"),),
        (arbitrator.clone(), beneficiary.clone(), slash_amount),
    );
    slash_amount
}

/// Resolve a dispute. Only the designated arbitrator can call this.
/// Resolution types: "release" (to recipient), "refund" (to sender),
/// "split" (amount to recipient, rest to sender).
pub fn resolve_dispute(
    env: Env,
    escrow_id: u32,
    arbitrator: Address,
    resolution: Symbol,
    to: Address,
    amount: i128,
) {
    arbitrator.require_auth();

    // `EscrowRecipient(id)` holds the recipient address, not the escrow
    // record — load the escrow from the recipient's escrow list.
    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(escrow_id))
        .unwrap_or_else(|| panic!("Escrow not found"));
    bump(&env, &DataKey::EscrowRecipient(escrow_id));

    let rkey = DataKey::EscrowByRecipient(recipient);
    let mut r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&rkey)
        .expect("escrow list not found");

    let mut found_index = None;
    let mut escrow = None;
    for i in 0..r_escrows.len() {
        let e = r_escrows.get(i).unwrap();
        if e.id == escrow_id {
            found_index = Some(i);
            escrow = Some(e);
            break;
        }
    }

    let mut escrow = escrow.expect("escrow not found");
    let idx = found_index.unwrap();

    if !escrow.disputed {
        panic!("Escrow is not disputed");
    }
    if escrow.arbitrator != Some(arbitrator.clone()) {
        panic!("Only the designated arbitrator can resolve this dispute");
    }
    let review_period_end = escrow
        .dispute_raised_at
        .checked_add(DISPUTE_REVIEW_LEDGERS)
        .expect("review period overflow");
    if env.ledger().sequence() < review_period_end {
        panic!("Review period has not elapsed");
    }

    let client = token::Client::new(&env, &escrow.token);

    let transferred;
    let prevailing_party;
    if resolution == Symbol::new(&env, "release") {
        if to != escrow.to || amount != escrow.amount {
            panic!("Invalid release amount");
        }
        contract_transfer_out(&env, &client, &escrow.to, &amount);
        transferred = amount;
        prevailing_party = Some(escrow.to.clone());
    } else if resolution == Symbol::new(&env, "refund") {
        // Refund the full escrow amount to the original sender
        contract_transfer_out(&env, &client, &escrow.from, &escrow.amount);
        transferred = escrow.amount;
        prevailing_party = Some(escrow.from.clone());
    } else if resolution == Symbol::new(&env, "split") {
        if to != escrow.to || amount <= 0 || amount >= escrow.amount {
            panic!("Invalid split amount");
        }
        let refund = escrow.amount.checked_sub(amount).expect("split underflow");
        contract_transfer_out(&env, &client, &escrow.to, &amount);
        contract_transfer_out(&env, &client, &escrow.from, &refund);
        transferred = escrow.amount;
        prevailing_party = Option::None;
    } else {
        panic!("Invalid resolution type");
    }

    escrow.status = EscrowStatus::Released;
    escrow.resolution_ledger = env.ledger().sequence();
    decrease_locked_balance(&env, &escrow.token, transferred);
    decrease_arbitrator_assignments(&env, &arbitrator);

    let appeal_depth = escrow.appeal_depth;
    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    let mut slashed: i128 = 0;
    for depth in 1..=appeal_depth {
        let appellant_key = DataKey::AppealAppellant(escrow_id, depth);
        let displaced_key = DataKey::AppealedArbitrator(escrow_id, depth);
        let appellant: Option<Address> = env.storage().persistent().get(&appellant_key);
        let displaced: Option<Address> = env.storage().persistent().get(&displaced_key);
        bump_if_present(&env, &appellant_key);
        bump_if_present(&env, &displaced_key);

        if let Some(displaced) = displaced {
            if let (Some(winner), Some(appellant)) = (&prevailing_party, &appellant) {
                if appellant == winner {
                    slashed = slashed
                        .checked_add(slash_arbitrator(&env, &displaced, winner))
                        .expect("total slash overflow");
                }
            }
            decrease_arbitrator_assignments(&env, &displaced);
        }
    }

    env.events().publish(
        (Symbol::new(&env, "dispute_resolved"),),
        (escrow_id, resolution, to, amount, slashed),
    );
}

/// Return the list of registered arbitrators.
pub fn get_arbitrators(env: Env) -> Vec<Address> {
    let key = DataKey::Arbitrators;
    let arbitrators = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(&env));
    bump_if_present(&env, &key);
    arbitrators
}

/// Return an arbitrator's remaining locked stake.
pub fn get_arbitrator_stake(env: Env, arbitrator: Address) -> i128 {
    let key = DataKey::ArbitratorStake(arbitrator);
    let stake = env.storage().persistent().get(&key).unwrap_or(0);
    bump_if_present(&env, &key);
    stake
}

/// Return an arbitrator's registered hierarchy tier.
pub fn get_arbitrator_tier(env: Env, arbitrator: Address) -> u32 {
    let key = DataKey::ArbitratorTier(arbitrator);
    let tier = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic!("Arbitrator tier not found"));
    bump(&env, &key);
    tier
}
