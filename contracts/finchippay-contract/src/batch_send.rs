//! # Batch Send
//!
//! Fan-out token transfers to multiple recipients in a single transaction
//! to minimize fee overhead. Supports single-token and multi-token batches.
//! Extracted from the main FinchippayContract impl.

use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::{
    decrease_locked_balance, get_admin, get_token_client, increase_locked_balance,
    require_initialized, require_not_paused, require_transfer_succeeded, ContractError, DataKey,
    SwapItem, TipRecord, TokenTotal, VestingSchedule, MAX_BATCH_SIZE, MAX_VESTING_AMOUNT,
    MAX_VESTING_DURATION_LEDGERS,
};

use crate::storage::*;
// ─── Batch send ───────────────────────────────────────────────────────────

/// Fan-out a single token transfer from `from` to multiple `recipients` in
/// one transaction. `recipients[i]` receives `amounts[i]` with optional `memos[i]`.
///
/// # Errors
/// - Returns `ContractError::LengthMismatch` if `recipients.len() != amounts.len()` or `recipients.len() != memos.len()`.
/// - Returns `ContractError::BatchTooLarge` if `recipients.len() > MAX_BATCH_SIZE`.
///
/// # Panics
/// - If `recipients.len() == 0`.
/// - If any amount is not positive.
pub fn batch_send(
    env: Env,
    token_address: Address,
    from: Address,
    recipients: Vec<Address>,
    amounts: Vec<i128>,
    memos: Vec<Symbol>,
) -> Result<(), ContractError> {
    let _guard = ReentrancyGuard::acquire(&env);
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();
    if recipients.len() == 0 {
        return Err(ContractError::InvalidState);
    }
    if recipients.len() > MAX_BATCH_SIZE {
        return Err(ContractError::BatchTooLarge);
    }
    if recipients.len() != amounts.len() || recipients.len() != memos.len() {
        return Err(ContractError::LengthMismatch);
    }
    for i in 0..amounts.len() {
        let amount = amounts.get(i).unwrap();
        if amount <= 0 {
            return Err(ContractError::NonPositiveAmount);
        }
    }
    let token = get_token_client(&env, &token_address);
    let mut total_amount: i128 = 0;
    let mut recipient_updates: soroban_sdk::Map<Address, (u32, i128)> = soroban_sdk::Map::new(&env);

    for i in 0..recipients.len() {
        let to = recipients.get(i).unwrap();
        let amount = amounts.get(i).unwrap();
        let memo = memos.get(i).unwrap();

        require_transfer_succeeded(&env, &token, &from, &to, &amount);
        total_amount = total_amount.checked_add(amount).expect("overflow");

        let (current_count, acc_amt) = match recipient_updates.get(to.clone()) {
            Some((count, acc)) => (count, acc),
            None => {
                let count = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TipCount(to.clone()))
                    .unwrap_or(0);
                (count, 0)
            }
        };

        let record = TipRecord {
            from: from.clone(),
            to: to.clone(),
            amount,
            ledger: env.ledger().sequence(),
            memo: memo.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::TipRecord(to.clone(), current_count), &record);
        bump_to_floor(&env, &DataKey::TipRecord(to.clone(), current_count));

        recipient_updates.set(
            to.clone(),
            (
                current_count.checked_add(1).expect("overflow"),
                acc_amt.checked_add(amount).expect("overflow"),
            ),
        );

        env.events().publish(
            (Symbol::new(&env, "tip"), from.clone(), to.clone()),
            (amount, memo),
        );
    }

    for (to, (final_count, batch_accumulated_amount)) in recipient_updates.iter() {
        let initial_total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TipTotal(to.clone()))
            .unwrap_or(0);

        let final_total = initial_total
            .checked_add(batch_accumulated_amount)
            .expect("overflow");

        env.storage()
            .persistent()
            .set(&DataKey::TipTotal(to.clone()), &final_total);
        bump(&env, &DataKey::TipTotal(to.clone()));

        env.storage()
            .persistent()
            .set(&DataKey::TipCount(to.clone()), &final_count);
        bump(&env, &DataKey::TipCount(to.clone()));
    }

    env.events().publish(
        (Symbol::new(&env, "batch_sent"),),
        (from, recipients.len(), total_amount),
    );
    Ok(())
}

/// Fan-out multi-token transfers from `from` to multiple `recipients` in
/// one transaction. `recipients[i]` receives `amounts[i]` of `tokens[i]` with memo `memos[i]`.
///
/// # Errors
/// Returns `ContractError::LengthMismatch` if any of the four vectors have different lengths.
/// Returns `ContractError::NonPositiveAmount` if any amount is not positive.
/// Returns `ContractError::BatchTooLarge` if batch size exceeds MAX_BATCH_SIZE.
///
/// # Panics
/// - If any recipient is the same as the sender (self-transfer).
/// - If the contract is paused.
pub fn batch_send_multi(
    env: Env,
    from: Address,
    tokens: Vec<Address>,
    recipients: Vec<Address>,
    amounts: Vec<i128>,
    memos: Vec<Symbol>,
) -> Result<(), ContractError> {
    let _guard = ReentrancyGuard::acquire(&env);
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();

    if recipients.len() == 0 {
        return Err(ContractError::InvalidState);
    }
    if recipients.len() > MAX_BATCH_SIZE {
        return Err(ContractError::BatchTooLarge);
    }
    if tokens.len() != recipients.len()
        || amounts.len() != recipients.len()
        || memos.len() != recipients.len()
    {
        return Err(ContractError::LengthMismatch);
    }

    // Pre-validate: verify all amounts are positive before initiating any transfers
    for i in 0..amounts.len() {
        let amount = amounts.get(i).unwrap();
        if amount <= 0 {
            return Err(ContractError::NonPositiveAmount);
        }
    }

    // Pre-validate: check for self-transfers
    for i in 0..recipients.len() {
        let to = recipients.get(i).unwrap();
        if from == to {
            return Err(ContractError::SelfTransfer);
        }
    }

    let mut total_amount: i128 = 0;

    for i in 0..recipients.len() {
        let token_address = tokens.get(i).unwrap();
        let to = recipients.get(i).unwrap();
        let amount = amounts.get(i).unwrap();
        let memo = memos.get(i).unwrap();

        let token = get_token_client(&env, &token_address);
        require_transfer_succeeded(&env, &token, &from, &to, &amount);
        total_amount = total_amount.checked_add(amount).expect("overflow");

        let total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TipTotal(to.clone()))
            .unwrap_or(0);
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCount(to.clone()))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::TipTotal(to.clone()),
            &(total.checked_add(amount).expect("overflow")),
        );
        bump(&env, &DataKey::TipTotal(to.clone()));

        env.storage()
            .persistent()
            .set(&DataKey::TipCount(to.clone()), &(count + 1));
        bump(&env, &DataKey::TipCount(to.clone()));

        let record = TipRecord {
            from: from.clone(),
            to: to.clone(),
            amount,
            ledger: env.ledger().sequence(),
            memo: memo.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::TipRecord(to.clone(), count), &record);
        bump_to_floor(&env, &DataKey::TipRecord(to.clone(), count));
    }

    env.events().publish(
        (Symbol::new(&env, "batch_sent_multi"),),
        (from, recipients.len(), total_amount),
    );
    Ok(())
}

/// Estimate total amounts per token for a batch of swap items.
///
/// Useful for off-chain clients to validate totals before submitting a
/// composite transaction. This function is pure (reads no mutable state)
/// and returns aggregated totals for each token present in `swaps`.
pub fn estimate_batch_swap_totals(env: Env, swaps: Vec<SwapItem>) -> Vec<TokenTotal> {
    require_initialized(&env);
    let mut totals: soroban_sdk::Map<Address, i128> = soroban_sdk::Map::new(&env);
    for i in 0..swaps.len() {
        let s = swaps.get(i).unwrap();
        if s.amount <= 0 {
            panic!("Non-positive amount in swap item");
        }
        let prev = match totals.get(s.token.clone()) {
            Some(v) => v,
            None => 0,
        };
        let new_total = prev.checked_add(s.amount).expect("overflow");
        totals.set(s.token.clone(), new_total);
    }
    let mut out: Vec<TokenTotal> = Vec::new(&env);
    for (tok, tot) in totals.iter() {
        out.push_back(TokenTotal {
            token: tok,
            total: tot,
        });
    }
    out
}

pub fn create_vesting(
    env: Env,
    token: Address,
    from: Address,
    beneficiary: Address,
    amount: i128,
    cliff_ledger: u32,
    end_ledger: u32,
) -> u32 {
    let _guard = ReentrancyGuard::acquire(&env);
    require_initialized(&env);
    require_not_paused(&env);
    from.require_auth();

    if cliff_ledger >= end_ledger {
        panic!("cliff_ledger must be less than end_ledger");
    }
    if amount <= 0 {
        panic!("amount must be positive");
    }
    if amount > MAX_VESTING_AMOUNT {
        panic!("amount exceeds maximum vesting size");
    }
    let current_ledger = env.ledger().sequence();
    if end_ledger <= current_ledger {
        panic!("end_ledger must be greater than current_ledger");
    }
    let duration = end_ledger.checked_sub(current_ledger).unwrap_or(0);
    if duration > MAX_VESTING_DURATION_LEDGERS {
        panic!("duration exceeds maximum vesting duration");
    }

    let token_client = get_token_client(&env, &token);
    let contract_address = env.current_contract_address();
    require_transfer_succeeded(&env, &token_client, &from, &contract_address, &amount);
    // The deposited funds are owed to the beneficiary (or returned on revoke),
    // so they must be counted as locked or the emergency withdrawal path could
    // sweep an active vesting schedule. Mirrors the escrow/stream/multi-sig
    // accounting.
    increase_locked_balance(&env, &token, amount);

    let next_id: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::VestingCount)
        .unwrap_or(0);

    let vesting = VestingSchedule {
        id: next_id,
        funder: from.clone(),
        token,
        beneficiary: beneficiary.clone(),
        total_amount: amount,
        cliff_ledger,
        end_ledger,
        claimed: 0,
        revoked: false,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Vesting(next_id), &vesting);
    bump_to_floor(&env, &DataKey::Vesting(next_id));

    env.storage()
        .persistent()
        .set(&DataKey::VestingCount, &(next_id + 1));
    bump(&env, &DataKey::VestingCount);

    env.events().publish(
        (Symbol::new(&env, "vesting_create"), next_id),
        (from, beneficiary, amount, cliff_ledger, end_ledger),
    );

    next_id
}

pub fn claim_vesting(env: Env, id: u32, beneficiary: Address) -> i128 {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    beneficiary.require_auth();

    let mut vesting: VestingSchedule = env
        .storage()
        .persistent()
        .get(&DataKey::Vesting(id))
        .expect("vesting schedule not found");

    if beneficiary != vesting.beneficiary {
        panic!("Unauthorized");
    }
    if vesting.revoked {
        panic!("vesting schedule has been revoked");
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger < vesting.cliff_ledger {
        return 0;
    }

    let effective_ledger = if current_ledger > vesting.end_ledger {
        vesting.end_ledger
    } else {
        current_ledger
    };

    let elapsed = (effective_ledger - vesting.cliff_ledger) as i128;
    let duration = (vesting.end_ledger - vesting.cliff_ledger) as i128;

    let vested = vesting
        .total_amount
        .checked_mul(elapsed)
        .expect("overflow")
        .checked_div(duration)
        .expect("division by zero");

    let claimable = vested.checked_sub(vesting.claimed).expect("underflow");
    if claimable <= 0 {
        return 0;
    }

    // Checks-effects-interactions: commit the claimed amount before the
    // external token transfer.
    vesting.claimed = vesting.claimed.checked_add(claimable).expect("overflow");

    env.storage()
        .persistent()
        .set(&DataKey::Vesting(id), &vesting);
    bump(&env, &DataKey::Vesting(id));
    decrease_locked_balance(&env, &vesting.token, claimable);

    let token_client = get_token_client(&env, &vesting.token);
    token_client.transfer(&env.current_contract_address(), &beneficiary, &claimable);

    env.events().publish(
        (Symbol::new(&env, "vesting_claim"), id),
        (beneficiary, claimable),
    );

    claimable
}

pub fn revoke_vesting(env: Env, id: u32, admin: Address) {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    admin.require_auth();

    let stored_admin = get_admin(&env);
    if admin != stored_admin {
        panic!("Unauthorized");
    }

    let mut vesting: VestingSchedule = env
        .storage()
        .persistent()
        .get(&DataKey::Vesting(id))
        .expect("vesting schedule not found");

    if vesting.revoked {
        panic!("vesting schedule is already revoked");
    }

    let unclaimed = vesting
        .total_amount
        .checked_sub(vesting.claimed)
        .expect("underflow");

    // Checks-effects-interactions: commit the revoked state before the
    // external token transfer.
    vesting.revoked = true;

    env.storage()
        .persistent()
        .set(&DataKey::Vesting(id), &vesting);
    bump(&env, &DataKey::Vesting(id));
    // The unclaimed remainder is no longer owed to anyone, so it leaves the
    // locked pool when it is returned to the funder below.
    decrease_locked_balance(&env, &vesting.token, unclaimed);

    if unclaimed > 0 {
        let token_client = get_token_client(&env, &vesting.token);
        token_client.transfer(&env.current_contract_address(), &vesting.funder, &unclaimed);
    }

    env.events().publish(
        (Symbol::new(&env, "vesting_revoke"), id),
        (vesting.funder, unclaimed),
    );
}

pub fn get_vesting(env: Env, id: u32) -> VestingSchedule {
    let key = DataKey::Vesting(id);
    let vesting: VestingSchedule = env
        .storage()
        .persistent()
        .get(&key)
        .expect("vesting schedule not found");
    bump(&env, &key);
    vesting
}

pub fn get_claimable_vesting(env: Env, id: u32) -> i128 {
    let key = DataKey::Vesting(id);
    let vesting: VestingSchedule = match env.storage().persistent().get(&key) {
        Some(v) => v,
        None => return 0,
    };
    bump(&env, &key);

    if vesting.revoked {
        return 0;
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger < vesting.cliff_ledger {
        return 0;
    }

    let effective_ledger = if current_ledger > vesting.end_ledger {
        vesting.end_ledger
    } else {
        current_ledger
    };

    let elapsed = (effective_ledger - vesting.cliff_ledger) as i128;
    let duration = (vesting.end_ledger - vesting.cliff_ledger) as i128;

    let vested = vesting
        .total_amount
        .checked_mul(elapsed)
        .expect("overflow")
        .checked_div(duration)
        .expect("division by zero");

    let claimable = vested.checked_sub(vesting.claimed).expect("underflow");
    if claimable < 0 {
        0
    } else {
        claimable
    }
}
