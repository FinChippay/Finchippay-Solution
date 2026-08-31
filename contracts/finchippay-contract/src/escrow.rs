//! # Escrow & Dispute Resolution
//!
//! Time-locked token custody with claim/cancel flows and arbitrator-mediated
//! dispute resolution. Extracted from the main FinchippayContract impl.

use soroban_sdk::{token, Address, Env, Symbol, Vec};

use crate::{
    contract_transfer_out, decrease_locked_balance, get_admin, get_token_client,
    increase_locked_balance, require_initialized, require_not_paused, require_transfer_succeeded,
    BatchClaimCursor, BatchClaimResult, BatchEscrowInput, BatchEscrowResult, ContractError,
    DataKey, Escrow, EscrowStatus, BATCH_ESCROW_CURSOR_STEP, MAX_BATCH_SIZE, MAX_ESCROW_AMOUNT,
    MAX_ESCROW_LEDGERS, MAX_MILESTONES, MAX_USER_ESCROWS, MIN_ESCROW_AMOUNT,
};

use crate::events::*;
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

    env.events().publish_event(&EscrowCreated {
        escrow_id: next_id,
        from: from.clone(),
        to: to.clone(),
        amount,
        release_ledger,
    });
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
    if escrow.disputed {
        panic!("escrow is disputed");
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

    env.events().publish_event(&EscrowClaimPartial {
        escrow_id: id,
        to: escrow.to.clone(),
        claim_amount,
        remaining,
    });
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
    if escrow.disputed {
        panic!("escrow is disputed");
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

    env.events().publish_event(&EscrowClaimed {
        escrow_id: id,
        recipient: escrow.to,
        amount: escrow.amount,
    });
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
    if escrow.disputed {
        panic!("escrow is disputed");
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

    env.events().publish_event(&EscrowCancelled {
        escrow_id: id,
        from: escrow.from,
        amount: refund_amount,
    });
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

    env.events().publish_event(&MilestoneEscrowCreated {
        escrow_id: next_id,
        milestone_count,
    });
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

    env.events().publish_event(&MilestoneApproved {
        escrow_id,
        milestone_id,
    });
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

// ─── Batch escrow operations ───────────────────────────────────────────────

/// Create up to `MAX_BATCH_SIZE` escrows in a single transaction.
///
/// The total amount of all *valid* items is transferred from `from` to the
/// contract in a single `require_transfer_succeeded` call before any escrow is
/// recorded (one transfer instead of N), and the locked balance is updated
/// once at the end. Items that fail per-item validation (self-transfer,
/// out-of-bounds amount, out-of-range release ledger, recipient index full)
/// are reported as `Skipped(index)` and do not block the rest of the batch.
///
/// # Panics
/// - If `recipients` is empty or longer than `MAX_BATCH_SIZE`.
pub fn batch_create_escrow(
    env: Env,
    token_address: Address,
    from: Address,
    recipients: Vec<BatchEscrowInput>,
) -> Vec<BatchEscrowResult> {
    let _guard = ReentrancyGuard::acquire(&env);
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();
    if recipients.len() == 0 {
        panic!("recipients must not be empty");
    }
    if recipients.len() > MAX_BATCH_SIZE {
        panic!("batch exceeds maximum size");
    }

    let current_ledger = env.ledger().sequence();
    let mut results: Vec<BatchEscrowResult> = Vec::new(&env);
    // Parallel to `recipients`: whether the item passed per-item validation.
    let mut valid: Vec<bool> = Vec::new(&env);
    // Total amount of the valid items; this is what actually moves in the
    // single transfer and what the locked balance is raised by at the end.
    let mut total_amount: i128 = 0;
    // Recipient escrow indexes loaded once and written back once, keyed by
    // recipient, plus the projected per-recipient count so the
    // `MAX_USER_ESCROWS` cap is enforced even when several batch items target
    // the same recipient.
    let mut lists: soroban_sdk::Map<Address, Vec<Escrow>> = soroban_sdk::Map::new(&env);
    let mut dirty: soroban_sdk::Map<Address, bool> = soroban_sdk::Map::new(&env);
    let mut projected: soroban_sdk::Map<Address, u32> = soroban_sdk::Map::new(&env);

    // Pass 1 — validate every item and compute the single transfer amount.
    for i in 0..recipients.len() {
        let input = recipients.get(i).unwrap();
        let mut skipped = false;
        if from == input.to {
            skipped = true;
        }
        if input.amount <= 0 || input.amount > MAX_ESCROW_AMOUNT || input.amount < MIN_ESCROW_AMOUNT
        {
            skipped = true;
        }
        if input.release_ledger <= current_ledger
            || input.release_ledger > current_ledger + MAX_ESCROW_LEDGERS
        {
            skipped = true;
        }
        if !skipped {
            // Load the recipient's escrow index once per unique recipient.
            if !lists.contains_key(input.to.clone()) {
                let key = DataKey::EscrowByRecipient(input.to.clone());
                let list: Vec<Escrow> = env
                    .storage()
                    .persistent()
                    .get(&key)
                    .unwrap_or(Vec::new(&env));
                lists.set(input.to.clone(), list);
            }
            let base_len = lists.get(input.to.clone()).unwrap().len();
            let projected_count = projected.get(input.to.clone()).unwrap_or(0);
            if base_len.checked_add(projected_count).expect("overflow") >= MAX_USER_ESCROWS {
                skipped = true;
            } else {
                projected.set(input.to.clone(), projected_count + 1);
            }
        }
        // Every position gets an entry now so the returned vector lines up
        // with the input order; valid positions are overwritten in pass 3.
        results.push_back(BatchEscrowResult::Skipped(i));
        if skipped {
            valid.push_back(false);
        } else {
            valid.push_back(true);
            dirty.set(input.to.clone(), true);
            total_amount = total_amount.checked_add(input.amount).expect("overflow");
        }
    }

    // Pass 2 — move the funds once, before any state is written. Skipped items
    // are never funded, so no refund bookkeeping is needed.
    if total_amount > 0 {
        let token = get_token_client(&env, &token_address);
        let contract_address = env.current_contract_address();
        require_transfer_succeeded(&env, &token, &from, &contract_address, &total_amount);
    }

    // Pass 3 — create the escrow records for the valid items.
    let mut next_id: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::EscrowCount)
        .unwrap_or(0);
    let mut created_count: u32 = 0;
    for i in 0..recipients.len() {
        if !valid.get(i).unwrap() {
            continue;
        }
        let input = recipients.get(i).unwrap();
        let escrow = Escrow {
            id: next_id,
            from: from.clone(),
            to: input.to.clone(),
            token: token_address.clone(),
            amount: input.amount,
            release_ledger: input.release_ledger,
            status: EscrowStatus::Pending,
            memo: input.memo.clone(),
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
            .set(&DataKey::EscrowRecipient(next_id), &input.to);
        bump_to_floor(&env, &DataKey::EscrowRecipient(next_id));

        let mut list = lists.get(input.to.clone()).unwrap();
        list.push_back(escrow);
        lists.set(input.to.clone(), list);

        results.set(i, BatchEscrowResult::Success(next_id));
        next_id = next_id.checked_add(1).expect("overflow");
        created_count += 1;
    }

    // Pass 4 — persist the touched recipient indexes, the counter, and the
    // locked balance, each exactly once.
    for (to, _) in dirty.iter() {
        let key = DataKey::EscrowByRecipient(to.clone());
        let updated = lists.get(to).unwrap();
        env.storage().persistent().set(&key, &updated);
        bump_to_floor(&env, &key);
    }
    if created_count > 0 {
        env.storage()
            .persistent()
            .set(&DataKey::EscrowCount, &next_id);
        bump(&env, &DataKey::EscrowCount);
    }
    if total_amount > 0 {
        increase_locked_balance(&env, &token_address, total_amount);
    }

    let skipped_count = recipients
        .len()
        .checked_sub(created_count)
        .expect("underflow");
    env.events().publish(
        (Symbol::new(&env, "batch_escrow_created"),),
        (from, created_count, skipped_count, total_amount),
    );

    results
}

/// Claim up to `BATCH_ESCROW_CURSOR_STEP` matured escrows, resuming from
/// `start_index` into `escrow_ids`. Each call returns a `BatchClaimCursor`;
/// pass `next_index` back as `start_index` (with the same `escrow_ids`) to
/// process the next chunk. `max_items == 0` means the default cursor step.
///
/// Partial-success semantics: an id that is missing, not pending, or not yet
/// matured is reported as `Skipped(index)` and never blocks the other ids.
/// The recipient (`to`) of every escrow in the chunk must have authorised the
/// call — each one is checked via `require_auth` as it is processed.
pub fn batch_claim_escrow(
    env: Env,
    escrow_ids: Vec<u32>,
    start_index: u32,
    max_items: u32,
) -> BatchClaimCursor {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);

    let len = escrow_ids.len();
    let start = start_index.min(len);
    let step = if max_items == 0 {
        BATCH_ESCROW_CURSOR_STEP
    } else {
        max_items.min(BATCH_ESCROW_CURSOR_STEP)
    };
    let end = (start + step).min(len);

    let mut results: Vec<BatchClaimResult> = Vec::new(&env);
    // Claimed amounts accumulated per token so the locked balance is updated
    // once per token at the end instead of once per escrow.
    let mut claimed_by_token: soroban_sdk::Map<Address, i128> = soroban_sdk::Map::new(&env);

    for i in start..end {
        let id = escrow_ids.get(i).unwrap();

        let recipient: Address = match env
            .storage()
            .persistent()
            .get(&DataKey::EscrowRecipient(id))
        {
            Some(r) => r,
            None => {
                results.push_back(BatchClaimResult::Skipped(i));
                continue;
            }
        };
        bump(&env, &DataKey::EscrowRecipient(id));

        let rkey = DataKey::EscrowByRecipient(recipient);
        let mut r_escrows: Vec<Escrow> = match env.storage().persistent().get(&rkey) {
            Some(list) => list,
            None => {
                results.push_back(BatchClaimResult::Skipped(i));
                continue;
            }
        };

        let mut found_index = None;
        for j in 0..r_escrows.len() {
            if r_escrows.get(j).unwrap().id == id {
                found_index = Some(j);
                break;
            }
        }
        let idx = match found_index {
            Some(j) => j,
            None => {
                results.push_back(BatchClaimResult::Skipped(i));
                continue;
            }
        };

        let mut escrow = r_escrows.get(idx).unwrap();
        if escrow.status != EscrowStatus::Pending {
            results.push_back(BatchClaimResult::Skipped(i));
            continue;
        }
        if env.ledger().sequence() < escrow.release_ledger {
            results.push_back(BatchClaimResult::Skipped(i));
            continue;
        }
        // Auth: each escrow's recipient must have authorised the call. Every
        // unique `to` in the chunk is covered by its own require_auth as its
        // escrows are processed.
        escrow.to.require_auth();

        let amount = escrow.amount;
        let to = escrow.to.clone();
        let token_address = escrow.token.clone();

        // Checks-effects-interactions: commit the released state and the
        // per-token claimed total before the external transfers, so a
        // re-entrant claim cannot observe a still-pending escrow.
        escrow.status = EscrowStatus::Released;
        r_escrows.set(idx, escrow);
        env.storage().persistent().set(&rkey, &r_escrows);
        bump(&env, &rkey);

        let prev = claimed_by_token.get(token_address.clone()).unwrap_or(0);
        claimed_by_token.set(
            token_address.clone(),
            prev.checked_add(amount).expect("overflow"),
        );

        let token = get_token_client(&env, &token_address);
        contract_transfer_out(&env, &token, &to, &amount);
        results.push_back(BatchClaimResult::Success(amount));
    }

    let mut total_claimed: i128 = 0;
    for (token_address, total) in claimed_by_token.iter() {
        total_claimed = total_claimed.checked_add(total).expect("overflow");
        decrease_locked_balance(&env, &token_address, total);
    }

    env.events().publish(
        (Symbol::new(&env, "batch_escrow_claimed"),),
        (start, end, total_claimed),
    );

    BatchClaimCursor {
        start_index: start,
        next_index: end,
        results,
        done: end >= len,
    }
}

/// Cancel up to `BATCH_ESCROW_CURSOR_STEP` pending escrows, resuming from
/// `start_index` into `escrow_ids`. Mirrors `batch_claim_escrow`: each call
/// returns a `BatchClaimCursor` used to continue with `next_index`.
///
/// Only the escrow creator (`from`) may cancel, so the `from` address of every
/// escrow in the chunk must have authorised the call. An id that is missing,
/// not pending, or already past its release ledger is reported as
/// `Skipped(index)` and never blocks the other ids.
pub fn batch_cancel_escrow(
    env: Env,
    escrow_ids: Vec<u32>,
    start_index: u32,
    max_items: u32,
) -> BatchClaimCursor {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);

    let len = escrow_ids.len();
    let start = start_index.min(len);
    let step = if max_items == 0 {
        BATCH_ESCROW_CURSOR_STEP
    } else {
        max_items.min(BATCH_ESCROW_CURSOR_STEP)
    };
    let end = (start + step).min(len);

    let mut results: Vec<BatchClaimResult> = Vec::new(&env);
    let mut refunded_by_token: soroban_sdk::Map<Address, i128> = soroban_sdk::Map::new(&env);

    for i in start..end {
        let id = escrow_ids.get(i).unwrap();

        let recipient: Address = match env
            .storage()
            .persistent()
            .get(&DataKey::EscrowRecipient(id))
        {
            Some(r) => r,
            None => {
                results.push_back(BatchClaimResult::Skipped(i));
                continue;
            }
        };
        bump(&env, &DataKey::EscrowRecipient(id));

        let rkey = DataKey::EscrowByRecipient(recipient);
        let mut r_escrows: Vec<Escrow> = match env.storage().persistent().get(&rkey) {
            Some(list) => list,
            None => {
                results.push_back(BatchClaimResult::Skipped(i));
                continue;
            }
        };

        let mut found_index = None;
        for j in 0..r_escrows.len() {
            if r_escrows.get(j).unwrap().id == id {
                found_index = Some(j);
                break;
            }
        }
        let idx = match found_index {
            Some(j) => j,
            None => {
                results.push_back(BatchClaimResult::Skipped(i));
                continue;
            }
        };

        let mut escrow = r_escrows.get(idx).unwrap();
        if escrow.status != EscrowStatus::Pending {
            results.push_back(BatchClaimResult::Skipped(i));
            continue;
        }
        if env.ledger().sequence() >= escrow.release_ledger {
            results.push_back(BatchClaimResult::Skipped(i));
            continue;
        }
        // Auth: only the escrow creator can cancel, so every `from` in the
        // chunk must have authorised the call.
        escrow.from.require_auth();

        let amount = escrow.amount;
        let from_addr = escrow.from.clone();
        let token_address = escrow.token.clone();

        // Checks-effects-interactions: commit the cancelled state before the
        // external refund transfers.
        escrow.status = EscrowStatus::Cancelled;
        r_escrows.set(idx, escrow);
        env.storage().persistent().set(&rkey, &r_escrows);
        bump(&env, &rkey);

        let prev = refunded_by_token.get(token_address.clone()).unwrap_or(0);
        refunded_by_token.set(
            token_address.clone(),
            prev.checked_add(amount).expect("overflow"),
        );

        let token = get_token_client(&env, &token_address);
        contract_transfer_out(&env, &token, &from_addr, &amount);
        results.push_back(BatchClaimResult::Success(amount));
    }

    let mut total_refunded: i128 = 0;
    for (token_address, total) in refunded_by_token.iter() {
        total_refunded = total_refunded.checked_add(total).expect("overflow");
        decrease_locked_balance(&env, &token_address, total);
    }

    env.events().publish(
        (Symbol::new(&env, "batch_escrow_cancelled"),),
        (start, end, total_refunded),
    );

    BatchClaimCursor {
        start_index: start,
        next_index: end,
        results,
        done: end >= len,
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

    env.events().publish_event(&ArbitratorAdded { arbitrator });
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
        .publish_event(&ArbitratorRemoved { arbitrator });
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

    env.events().publish_event(&DisputableEscrowCreated {
        escrow_id: next_id,
        arbitrator,
    });

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

    env.events().publish_event(&DisputeRaised {
        escrow_id,
        raised_by: by,
    });
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

    env.events().publish_event(&DisputeResolved {
        escrow_id,
        resolution,
        to,
        amount,
    });
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
