//! # Escrow & Dispute Resolution
//!
//! Time-locked token custody with claim/cancel flows and arbitrator-mediated
//! dispute resolution. Extracted from the main FinchippayContract impl.

use soroban_sdk::{token, Address, Env, Symbol, Vec};

use crate::{
    contract_transfer_out, decrease_locked_balance, get_admin, get_token_client,
    increase_locked_balance, require_initialized, require_not_paused, require_transfer_succeeded,
    ContractError, DataKey, Escrow, EscrowStatus, MAX_ESCROW_AMOUNT, MAX_ESCROW_LEDGERS,
    MAX_USER_ESCROWS, MIN_ESCROW_AMOUNT,
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
    }
    escrow.amount = remaining;

    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

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
    if env.ledger().sequence() < escrow.release_ledger {
        panic!("release_ledger not reached");
    }
    escrow.to.require_auth();

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.to, &escrow.amount);
    decrease_locked_balance(&env, &escrow.token, escrow.amount);

    escrow.status = EscrowStatus::Released;
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish_event(&EscrowClaimed {
        escrow_id: id,
        recipient: escrow.to,
        amount: escrow.amount,
    });
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
    if env.ledger().sequence() >= escrow.release_ledger {
        panic!("release_ledger already reached — cancellation is no longer allowed");
    }
    escrow.from.require_auth();

    let token = get_token_client(&env, &escrow.token);
    contract_transfer_out(&env, &token, &escrow.from, &escrow.amount);
    decrease_locked_balance(&env, &escrow.token, escrow.amount);

    escrow.status = EscrowStatus::Cancelled;
    r_escrows.set(idx, escrow.clone());
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

    env.events().publish_event(&EscrowCancelled {
        escrow_id: id,
        from: escrow.from,
        amount: escrow.amount,
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

    let client = token::Client::new(&env, &escrow.token);
    let contract = env.current_contract_address();

    let transferred;
    if resolution == Symbol::new(&env, "release") {
        if amount <= 0 || amount > escrow.amount {
            panic!("Invalid release amount");
        }
        client.transfer(&contract, &to, &amount);
        transferred = amount;
    } else if resolution == Symbol::new(&env, "refund") {
        // Refund the full escrow amount to the original sender
        client.transfer(&contract, &escrow.from, &escrow.amount);
        transferred = escrow.amount;
    } else if resolution == Symbol::new(&env, "split") {
        if amount <= 0 || amount >= escrow.amount {
            panic!("Invalid split amount");
        }
        let refund = escrow.amount - amount;
        client.transfer(&contract, &to, &amount);
        client.transfer(&contract, &escrow.from, &refund);
        transferred = escrow.amount;
    } else {
        panic!("Invalid resolution type");
    }

    escrow.status = EscrowStatus::Released;
    decrease_locked_balance(&env, &escrow.token, transferred);

    r_escrows.set(idx, escrow);
    env.storage().persistent().set(&rkey, &r_escrows);
    bump(&env, &rkey);

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
