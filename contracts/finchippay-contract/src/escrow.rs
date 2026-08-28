//! # Escrow & Dispute Resolution
//!
//! Time-locked token custody with claim/cancel flows and arbitrator-mediated
//! dispute resolution. Extracted from the main FinchippayContract impl.

use soroban_sdk::{token, Address, Env, Symbol, Vec};

use crate::{
    contract_transfer_out, decrease_locked_balance, get_admin, get_token_client,
    increase_locked_balance, require_initialized, require_not_paused, require_transfer_succeeded,
    ContractError, DataKey, Escrow, EscrowStatus, EscrowSummary, Milestone, MAX_ESCROW_AMOUNT,
    MAX_ESCROW_LEDGERS, MAX_MILESTONES, MAX_USER_ESCROWS, MIN_ESCROW_AMOUNT,
};

use crate::storage::*;
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
    let _guard = ReentrancyGuard::acquire(&env);
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
        agent: Option::None,
        milestones: Vec::new(&env),
        is_milestone_based: false,
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
    let _guard = ReentrancyGuard::acquire(&env);
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

    if escrow.is_milestone_based {
        panic!("milestone escrow must be claimed via claim_milestone");
    }
    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
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

    // Checks-effects-interactions: compute and commit all state changes before
    // the external token transfer, so a re-entrant claim cannot observe a
    // still-unclaimed escrow.
    let remaining = escrow.amount.checked_sub(claim_amount).expect("overflow");
    if remaining == 0 {
        escrow.status = EscrowStatus::Released;
    }
    escrow.amount = remaining;
    decrease_locked_balance(&env, &escrow.token, claim_amount);

    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.to, &claim_amount);

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
    let _guard = ReentrancyGuard::acquire(&env);
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

    if escrow.is_milestone_based {
        panic!("milestone escrow must be claimed via claim_milestone");
    }
    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
    }
    if env.ledger().sequence() < escrow.release_ledger {
        panic!("release_ledger not reached");
    }
    escrow.to.require_auth();

    // Checks-effects-interactions: commit the released state and release the
    // locked balance *before* the external token transfer, so a re-entrant
    // claim cannot observe a still-pending escrow.
    escrow.status = EscrowStatus::Released;
    decrease_locked_balance(&env, &escrow.token, escrow.amount);
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.to, &escrow.amount);

    env.events().publish(
        (Symbol::new(&env, "escrow_claim"), id),
        (escrow.to, escrow.amount),
    );
}

/// Payer cancels the escrow before `release_ledger`; funds are returned.
pub fn cancel_escrow(env: Env, id: u32) {
    let _guard = ReentrancyGuard::acquire(&env);
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
    escrow.from.require_auth();

    // Milestone escrows have no single release ledger: cancellation is allowed
    // any time while pending, and refunds only the milestone amounts that have
    // not been claimed yet (claimed milestones are already with the recipient).
    let refund_amount = if escrow.is_milestone_based {
        let mut total: i128 = 0;
        for m in escrow.milestones.iter() {
            if !m.claimed {
                total = total.checked_add(m.amount).expect("overflow");
            }
        }
        total
    } else {
        if env.ledger().sequence() >= escrow.release_ledger {
            panic!("release_ledger already reached — cancellation is no longer allowed");
        }
        escrow.amount
    };

    // Checks-effects-interactions: commit the cancelled state and release the
    // locked balance *before* the external token transfer.
    escrow.status = EscrowStatus::Cancelled;
    decrease_locked_balance(&env, &escrow.token, refund_amount);
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.from, &refund_amount);

    env.events().publish(
        (Symbol::new(&env, "escrow_cancelled"),),
        (id, escrow.from, refund_amount),
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

// ─── Milestone-based escrows ───────────────────────────────────────────────

/// Create an escrow whose funds release per approved milestone.
///
/// `milestones` must contain between 1 and `MAX_MILESTONES` entries, every
/// milestone amount must be positive, and the sum of milestone amounts must
/// equal `deposit`. Milestone ids are assigned sequentially (0..n) by the
/// contract, ignoring any ids supplied by the caller.
///
/// The `agent` is the designated approver; the client (`from`) may also
/// approve. The agent may not be the recipient, otherwise the recipient could
/// approve their own milestones.
pub fn create_milestone_escrow(
    env: Env,
    token_address: Address,
    from: Address,
    to: Address,
    agent: Address,
    milestones: Vec<Milestone>,
    deposit: i128,
) -> Result<u32, ContractError> {
    let _guard = ReentrancyGuard::acquire(&env);
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();
    if from == to {
        panic!("cannot create escrow to yourself");
    }
    if agent == to {
        panic!("agent cannot be the recipient");
    }
    if deposit <= 0 {
        panic!("amount must be positive");
    }
    if deposit > MAX_ESCROW_AMOUNT {
        panic!("amount exceeds maximum escrow size");
    }
    if deposit < MIN_ESCROW_AMOUNT {
        panic!("amount below minimum escrow size");
    }
    if milestones.len() == 0 {
        panic!("at least one milestone is required");
    }
    if milestones.len() > MAX_MILESTONES {
        panic!("too many milestones");
    }

    let current_ledger = env.ledger().sequence();
    let milestone_count = milestones.len();
    let mut total: i128 = 0;
    let mut normalized = Vec::new(&env);
    for (i, m) in milestones.iter().enumerate() {
        if m.amount <= 0 {
            panic!("milestone amount must be positive");
        }
        if m.approval_deadline_ledger > 0 && m.approval_deadline_ledger <= current_ledger {
            panic!("approval deadline must be in the future");
        }
        total = total.checked_add(m.amount).expect("overflow");
        let mut m = m;
        m.id = i as u32;
        normalized.push_back(m);
    }
    if total != deposit {
        panic!("milestone amounts must sum to the deposit");
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
    require_transfer_succeeded(&env, &token, &from, &contract_address, &deposit);
    increase_locked_balance(&env, &token_address, deposit);

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
        amount: deposit,
        // Milestone escrows have no single release ledger; each milestone
        // carries its own approval deadline. Cancellation and claims are
        // gated on the milestone flags instead of this field.
        release_ledger: 0,
        status: EscrowStatus::Pending,
        memo: Symbol::new(&env, ""),
        arbitrator: Option::None,
        disputed: false,
        dispute_raised_by: Option::None,
        dispute_raised_at: 0,
        agent: Some(agent.clone()),
        milestones: normalized,
        is_milestone_based: true,
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
        (Symbol::new(&env, "milestone_escrow_created"), next_id),
        milestone_count,
    );
    Ok(next_id)
}

/// Approve a milestone for release. Only the escrow agent or the client
/// (`from`) may approve. Once approved, the milestone can be claimed by the
/// recipient.
pub fn approve_milestone(env: Env, escrow_id: u32, milestone_id: u32, approver: Address) {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    approver.require_auth();

    let recipient: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(escrow_id))
        .expect("escrow recipient not found");
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

    if !escrow.is_milestone_based {
        panic!("escrow is not milestone-based");
    }
    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
    }
    if escrow.agent.as_ref() != Some(&approver) && approver != escrow.from {
        panic!("Unauthorized");
    }

    let mut milestone_found = false;
    for i in 0..escrow.milestones.len() {
        let mut m = escrow.milestones.get(i).unwrap();
        if m.id == milestone_id {
            if m.approved {
                panic!("milestone already approved");
            }
            if m.approval_deadline_ledger > 0
                && env.ledger().sequence() > m.approval_deadline_ledger
            {
                panic!("approval deadline passed");
            }
            m.approved = true;
            escrow.milestones.set(i, m);
            milestone_found = true;
            break;
        }
    }
    if !milestone_found {
        panic!("milestone not found");
    }

    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish(
        (Symbol::new(&env, "milestone_approved"), escrow_id),
        milestone_id,
    );
}

/// Claim an approved milestone. Only the escrow recipient (`to`) may claim.
/// When the last milestone is claimed the escrow is marked `Released`.
pub fn claim_milestone(env: Env, escrow_id: u32, milestone_id: u32, recipient: Address) {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    recipient.require_auth();

    let to: Address = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowRecipient(escrow_id))
        .expect("escrow recipient not found");
    bump(&env, &DataKey::EscrowRecipient(escrow_id));

    let rkey = DataKey::EscrowByRecipient(to);
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

    if !escrow.is_milestone_based {
        panic!("escrow is not milestone-based");
    }
    if escrow.status != EscrowStatus::Pending {
        panic!("escrow is not pending");
    }
    if recipient != escrow.to {
        panic!("Unauthorized");
    }

    // Find the milestone and compute the payout before any state changes.
    let mut claim_amount: i128 = 0;
    let mut milestone_found = false;
    for i in 0..escrow.milestones.len() {
        let mut m = escrow.milestones.get(i).unwrap();
        if m.id == milestone_id {
            if !m.approved {
                panic!("milestone not approved");
            }
            if m.claimed {
                panic!("milestone already claimed");
            }
            claim_amount = m.amount;
            m.claimed = true;
            escrow.milestones.set(i, m);
            milestone_found = true;
            break;
        }
    }
    if !milestone_found {
        panic!("milestone not found");
    }

    // After the last milestone is claimed the escrow is fully released.
    if escrow.milestones.iter().all(|m| m.claimed) {
        escrow.status = EscrowStatus::Released;
    }

    // Checks-effects-interactions: commit state before the external transfer.
    decrease_locked_balance(&env, &escrow.token, claim_amount);
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &recipient, &claim_amount);

    env.events().publish(
        (
            Symbol::new(&env, "milestone_claimed"),
            escrow_id,
            milestone_id,
        ),
        claim_amount,
    );
}

/// Return the milestone schedule of a milestone-based escrow.
pub fn get_milestones(env: Env, escrow_id: u32) -> Vec<Milestone> {
    let escrow = get_escrow(env, escrow_id).expect("escrow not found");
    escrow.milestones
}

/// Return an aggregated summary of an escrow for dashboards/off-chain consumers.
pub fn get_escrow_summary(env: Env, escrow_id: u32) -> EscrowSummary {
    let escrow = get_escrow(env, escrow_id).expect("escrow not found");
    let (mut released_amount, mut approved, mut claimed) = (0i128, 0u32, 0u32);
    if escrow.is_milestone_based {
        for m in escrow.milestones.iter() {
            if m.claimed {
                released_amount = released_amount.checked_add(m.amount).expect("overflow");
                claimed += 1;
            }
            if m.approved {
                approved += 1;
            }
        }
    } else if escrow.status == EscrowStatus::Released {
        released_amount = escrow.amount;
    }
    // Cancelled escrows have refunded everything not yet claimed, so nothing
    // remains in the contract even though `amount` still holds the original
    // deposit.
    let remaining_amount = if escrow.status == EscrowStatus::Cancelled {
        0
    } else {
        escrow.amount - released_amount
    };
    EscrowSummary {
        id: escrow.id,
        total_amount: escrow.amount,
        released_amount,
        remaining_amount,
        milestone_count: escrow.milestones.len(),
        approved_milestones: approved,
        claimed_milestones: claimed,
        status: escrow.status,
        is_milestone_based: escrow.is_milestone_based,
    }
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

pub fn add_arbitrator(env: Env, admin: Address, arbitrator: Address) {
    admin.require_auth();
    let stored = get_admin(&env);
    if admin != stored {
        panic!("Unauthorized");
    }

    let mut arbitrators: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Arbitrators)
        .unwrap_or(Vec::new(&env));

    if arbitrators.contains(&arbitrator) {
        panic!("Arbitrator already registered");
    }

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

    env.events()
        .publish((Symbol::new(&env, "arbitrator_added"),), arbitrator);
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

    env.events()
        .publish((Symbol::new(&env, "arbitrator_removed"),), arbitrator);
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
    let _guard = ReentrancyGuard::acquire(&env);
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
        memo: Symbol::new(&env, ""),
        arbitrator: Some(arbitrator.clone()),
        disputed: false,
        dispute_raised_by: Option::None,
        dispute_raised_at: 0,
        agent: Option::None,
        milestones: Vec::new(&env),
        is_milestone_based: false,
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

    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events()
        .publish((Symbol::new(&env, "dispute_raised"),), (escrow_id, by));
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
    let _guard = ReentrancyGuard::acquire(&env);
    // Dispute resolution transfers funds out of the contract, so it is a
    // value-transferring operation and must be blocked while the circuit
    // breaker is engaged. (`raise_dispute` only flags state and moves no
    // funds, so it deliberately remains callable while paused.)
    require_not_paused(&env);
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

    if escrow.status != EscrowStatus::Pending {
        panic!("Escrow is not pending");
    }
    if !escrow.disputed {
        panic!("Escrow is not disputed");
    }
    if escrow.arbitrator != Some(arbitrator.clone()) {
        panic!("Only the designated arbitrator can resolve this dispute");
    }

    let token_address = escrow.token.clone();
    let sender = escrow.from.clone();
    let escrow_amount = escrow.amount;

    let release_sym = Symbol::new(&env, "release");
    let refund_sym = Symbol::new(&env, "refund");
    let split_sym = Symbol::new(&env, "split");

    // Checks: validate the resolution and compute the outgoing transfers
    // without executing them yet (checks-effects-interactions).
    let (to_amount, sender_amount, transferred) = if resolution == release_sym {
        if amount <= 0 || amount > escrow_amount {
            panic!("Invalid release amount");
        }
        (amount, 0, amount)
    } else if resolution == refund_sym {
        // Refund the full escrow amount to the original sender.
        (0, escrow_amount, escrow_amount)
    } else if resolution == split_sym {
        if amount <= 0 || amount >= escrow_amount {
            panic!("Invalid split amount");
        }
        let refund = escrow_amount - amount;
        (amount, refund, escrow_amount)
    } else {
        panic!("Invalid resolution type");
    };

    // Effects: commit the released state before the external transfers.
    escrow.status = EscrowStatus::Released;
    escrow.disputed = false;
    decrease_locked_balance(&env, &token_address, transferred);

    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    // Interactions: execute the transfers last.
    let client = token::Client::new(&env, &token_address);
    let contract = env.current_contract_address();
    if to_amount > 0 {
        client.transfer(&contract, &to, &to_amount);
    }
    if sender_amount > 0 {
        client.transfer(&contract, &sender, &sender_amount);
    }

    env.events().publish(
        (Symbol::new(&env, "dispute_resolved"),),
        (escrow_id, resolution, to, amount),
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
