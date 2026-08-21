//! # Streaming Payments
//!
//! Continuous per-ledger token streams with claim, top-up, close, reject,
//! and transfer operations. Extracted from the main FinchippayContract impl.

use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::{
    claimable_at, contract_transfer_out, decrease_locked_balance, get_token_client,
    increase_locked_balance, require_initialized, require_not_paused, require_transfer_succeeded,
    ContractError, DataKey, Escrow, Stream, MAX_PAGE_SIZE, MAX_STREAM_DEPOSIT, MAX_STREAM_RATE,
    MAX_USER_STREAMS,
};

use crate::storage::*;
// ─── Streaming payments ───────────────────────────────────────────────────

/// Open a new payment stream. `payer` deposits `deposit` tokens that will
/// drip to `recipient` at `rate_per_ledger` tokens per ledger.
///
/// Returns the stream ID.
pub fn open_stream(
    env: Env,
    token_address: Address,
    payer: Address,
    recipient: Address,
    rate_per_ledger: i128,
    deposit: i128,
) -> u32 {
    let _guard = ReentrancyGuard::acquire(&env);
    require_initialized(&env);
    require_not_paused(&env);
    payer.require_auth();
    if payer == recipient {
        panic!("cannot open stream to yourself");
    }
    if rate_per_ledger <= 0 {
        panic!("rate_per_ledger must be positive");
    }
    if rate_per_ledger > MAX_STREAM_RATE {
        panic!("rate_per_ledger exceeds maximum");
    }
    if deposit <= 0 {
        panic!("deposit must be positive");
    }
    if deposit > MAX_STREAM_DEPOSIT {
        panic!("deposit exceeds maximum stream size");
    }

    // Lock deposit in the contract.
    let token = get_token_client(&env, &token_address);
    let contract_address = env.current_contract_address();
    require_transfer_succeeded(&env, &token, &payer, &contract_address, &deposit);

    let id: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::StreamCount)
        .unwrap_or(0);

    let stream = Stream {
        id,
        payer: payer.clone(),
        recipient: recipient.clone(),
        token: token_address,
        rate_per_ledger,
        deposited: deposit,
        claimed: 0,
        start_ledger: env.ledger().sequence(),
        closed: false,
        paused_at_ledger: 0,
        total_paused_duration: 0,
    };
    increase_locked_balance(&env, &stream.token, deposit);
    env.storage()
        .persistent()
        .set(&DataKey::Stream(id), &stream);
    bump_to_floor(&env, &DataKey::Stream(id));
    env.storage()
        .persistent()
        .set(&DataKey::StreamCount, &(id + 1));
    bump(&env, &DataKey::StreamCount);

    let s_key = DataKey::StreamByPayer(payer.clone());
    let mut p_streams: Vec<u32> = env
        .storage()
        .persistent()
        .get(&s_key)
        .unwrap_or(Vec::new(&env));
    if p_streams.len() < MAX_USER_STREAMS {
        p_streams.push_back(id);
        env.storage().persistent().set(&s_key, &p_streams);
        bump_to_floor(&env, &s_key);
    }

    env.events().publish(
        (Symbol::new(&env, "stream_open"), id),
        (payer, recipient, rate_per_ledger, deposit),
    );
    id
}

/// Recipient claims all currently claimable tokens from stream `id`.
///
/// Returns the amount claimed. Can be called multiple times as the stream
/// progresses; the running `claimed` counter prevents double-claiming.
pub fn claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    recipient.require_auth();

    let mut stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .expect("stream not found");

    if stream.recipient != recipient {
        panic!("only the recipient may claim");
    }

    let claimable = claimable_at(&stream, env.ledger().sequence());
    if claimable == 0 {
        return 0;
    }

    stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream);
    bump(&env, &DataKey::Stream(stream_id));

    // Checks-effects-interactions: release the locked balance before the
    // external token transfer.
    decrease_locked_balance(&env, &stream.token, claimable);

    let token = get_token_client(&env, &stream.token);
    contract_transfer_out(&env, &token, &recipient, &claimable);

    env.events().publish(
        (Symbol::new(&env, "stream_claim"), stream_id),
        (recipient, claimable),
    );
    claimable
}

/// Payer adds `amount` more tokens to an existing open stream.
pub fn top_up_stream(env: Env, stream_id: u32, payer: Address, amount: i128) {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    payer.require_auth();
    if amount <= 0 {
        panic!("top-up amount must be positive");
    }

    let mut stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .expect("stream not found");

    if stream.payer != payer {
        panic!("only the payer may top up");
    }
    if stream.closed {
        panic!("stream is closed");
    }

    let token = get_token_client(&env, &stream.token);
    let contract_address = env.current_contract_address();
    require_transfer_succeeded(&env, &token, &payer, &contract_address, &amount);
    increase_locked_balance(&env, &stream.token, amount);

    stream.deposited = stream.deposited.checked_add(amount).expect("overflow");
    if stream.deposited > MAX_STREAM_DEPOSIT {
        panic!("deposit exceeds maximum after top-up");
    }
    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream);
    bump(&env, &DataKey::Stream(stream_id));

    env.events().publish(
        (Symbol::new(&env, "stream_topped_up"),),
        (stream_id, payer, amount, stream.deposited),
    );
}

/// Payer closes the stream early. Any unclaimed streamed tokens are sent to
/// the recipient first; the remainder is refunded to the payer.
///
/// Returns the refund amount sent back to the payer.
pub fn close_stream(env: Env, stream_id: u32, payer: Address) -> i128 {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    payer.require_auth();

    let mut stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .expect("stream not found");

    if stream.payer != payer {
        panic!("only the payer may close the stream");
    }
    if stream.closed {
        panic!("stream is already closed");
    }

    let token = get_token_client(&env, &stream.token);

    // Checks-effects-interactions: compute the settlement and commit all state
    // changes *before* any external token transfer.
    let claimable = claimable_at(&stream, env.ledger().sequence());
    if claimable > 0 {
        stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
    }
    let refund = stream
        .deposited
        .checked_sub(stream.claimed)
        .expect("underflow");
    stream.closed = true;

    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream);
    bump(&env, &DataKey::Stream(stream_id));

    if claimable > 0 {
        decrease_locked_balance(&env, &stream.token, claimable);
    }
    decrease_locked_balance(&env, &stream.token, refund);

    let s_key = DataKey::StreamByPayer(payer.clone());
    let p_streams: Vec<u32> = env
        .storage()
        .persistent()
        .get(&s_key)
        .unwrap_or(Vec::new(&env));
    let mut new_streams = Vec::new(&env);
    for s_id in p_streams.iter() {
        if s_id != stream_id {
            new_streams.push_back(s_id);
        }
    }
    env.storage().persistent().set(&s_key, &new_streams);
    bump(&env, &s_key);

    // Interactions: transfer out last.
    if claimable > 0 {
        contract_transfer_out(&env, &token, &stream.recipient, &claimable);
    }
    if refund > 0 {
        contract_transfer_out(&env, &token, &payer, &refund);
    }

    env.events().publish(
        (Symbol::new(&env, "stream_close"), stream_id),
        (payer, refund),
    );

    // Emit final close event for indexing/UI.
    env.events().publish(
        (Symbol::new(&env, "stream_closed"), stream_id),
        (refund, claimable),
    );
    refund
}

/// Recipient rejects an open stream. Any accrued-but-unclaimed tokens are
/// sent to the recipient first; the remainder is refunded to the payer.
/// This allows a recipient to opt out of a stream for compliance or personal
/// reasons.
///
/// Returns the refund amount sent back to the payer.
pub fn reject_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    recipient.require_auth();

    let mut stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .expect("stream not found");

    if stream.recipient != recipient {
        panic!("only the recipient may reject the stream");
    }
    if stream.closed {
        panic!("stream is already closed");
    }

    let token = get_token_client(&env, &stream.token);

    // Checks-effects-interactions: compute the settlement and commit all state
    // changes *before* any external token transfer.
    let claimable = claimable_at(&stream, env.ledger().sequence());
    if claimable > 0 {
        stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
    }
    let refund = stream
        .deposited
        .checked_sub(stream.claimed)
        .expect("underflow");
    stream.closed = true;

    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream);
    bump(&env, &DataKey::Stream(stream_id));

    if claimable > 0 {
        decrease_locked_balance(&env, &stream.token, claimable);
    }
    decrease_locked_balance(&env, &stream.token, refund);

    // Interactions: transfer out last.
    if claimable > 0 {
        contract_transfer_out(&env, &token, &recipient, &claimable);
    }
    if refund > 0 {
        contract_transfer_out(&env, &token, &stream.payer, &refund);
    }

    env.events().publish(
        (Symbol::new(&env, "stream_reject"), stream_id),
        (recipient, refund),
    );
    refund
}

/// Allow a stream recipient to transfer their incoming stream to a new
/// recipient address. The original recipient must authorise this call.
/// The stream's accrued tokens at the time of transfer are automatically
/// claimed by the old recipient before the transfer takes effect.
pub fn transfer_stream(
    env: Env,
    stream_id: u32,
    current_recipient: Address,
    new_recipient: Address,
) {
    let _guard = ReentrancyGuard::acquire(&env);
    require_not_paused(&env);
    current_recipient.require_auth();
    if current_recipient == new_recipient {
        panic!("new recipient must be different");
    }

    let mut stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .expect("stream not found");

    if stream.recipient != current_recipient {
        panic!("only the current recipient may transfer");
    }
    if stream.closed {
        panic!("stream is closed");
    }

    // Checks-effects-interactions: record the accrued claim and the new
    // recipient before the external transfer of the accrued tokens.
    let claimable = claimable_at(&stream, env.ledger().sequence());
    if claimable > 0 {
        stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
    }

    stream.recipient = new_recipient.clone();
    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream);
    bump(&env, &DataKey::Stream(stream_id));

    if claimable > 0 {
        let token = get_token_client(&env, &stream.token);
        token.transfer(
            &env.current_contract_address(),
            &current_recipient,
            &claimable,
        );
    }

    env.events().publish(
        (Symbol::new(&env, "stream_transfer"), stream_id),
        (current_recipient, new_recipient),
    );
}

/// Return the stream record for `stream_id`.
pub fn get_stream(env: Env, stream_id: u32) -> Result<Stream, ContractError> {
    let key = DataKey::Stream(stream_id);
    match env.storage().persistent().get(&key) {
        Some(stream) => {
            bump(&env, &key);
            Ok(stream)
        }
        None => Err(ContractError::NotFound),
    }
}

/// Calculate how much the recipient could claim right now without mutating state.
pub fn get_claimable(env: Env, stream_id: u32) -> i128 {
    let stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .expect("stream not found");
    bump(&env, &DataKey::Stream(stream_id));
    claimable_at(&stream, env.ledger().sequence())
}

/// Return the total number of streams ever opened.
pub fn get_stream_count(env: Env) -> u32 {
    let key = DataKey::StreamCount;
    let count = env.storage().persistent().get(&key).unwrap_or(0);
    bump_if_present(&env, &key);
    count
}

/// Stable alias for `get_stream_count`. Generates a consistent SDK
/// binding name that will not change across contract upgrades, making
/// dashboard and analytics integrations resilient to internal refactors.
pub fn stream_count(env: Env) -> u32 {
    {
        let key = DataKey::StreamCount;
        let c = env.storage().persistent().get(&key).unwrap_or(0);
        bump_if_present(&env, &key);
        c
    }
}

pub fn list_streams_by_payer(env: Env, payer: Address, offset: u32, limit: u32) -> Vec<Stream> {
    let s_key = DataKey::StreamByPayer(payer);
    let p_streams: Vec<u32> = env
        .storage()
        .persistent()
        .get(&s_key)
        .unwrap_or(Vec::new(&env));
    if env.storage().persistent().has(&s_key) {
        bump(&env, &s_key);
    }
    let total = p_streams.len();
    if offset >= total {
        return Vec::new(&env);
    }
    let max_limit = limit.min(MAX_PAGE_SIZE);
    let mut end = offset.saturating_add(max_limit);
    if end > total {
        end = total;
    }
    let mut result = Vec::new(&env);
    for i in offset..end {
        let id = p_streams.get(i).unwrap();
        let stream_key = DataKey::Stream(id);
        let stream: Stream = env.storage().persistent().get(&stream_key).unwrap();
        bump(&env, &stream_key);
        result.push_back(stream);
    }
    result
}

pub fn list_escrows_by_recipient(
    env: Env,
    recipient: Address,
    offset: u32,
    limit: u32,
) -> Vec<Escrow> {
    let e_key = DataKey::EscrowByRecipient(recipient);
    let r_escrows: Vec<Escrow> = env
        .storage()
        .persistent()
        .get(&e_key)
        .unwrap_or(Vec::new(&env));
    if env.storage().persistent().has(&e_key) {
        bump(&env, &e_key);
    }
    let total = r_escrows.len();
    if offset >= total {
        return Vec::new(&env);
    }
    let max_limit = limit.min(MAX_PAGE_SIZE);
    let mut end = offset.saturating_add(max_limit);
    if end > total {
        end = total;
    }
    let mut result = Vec::new(&env);
    for i in offset..end {
        result.push_back(r_escrows.get(i).unwrap());
    }
    result
}

// Internal: compute claimable amount for a stream at the current ledger.
fn _claimable(env: &Env, stream: &Stream) -> i128 {
    if stream.closed {
        return 0;
    }
    claimable_at(stream, env.ledger().sequence())
}
