//! # Multi-Sig Payments
//!
//! N-of-M threshold approval payment proposals with auto-execution,
//! expiration, and cancellation. Extracted from the main FinchippayContract impl.

use soroban_sdk::{Address, Env, Vec};

use crate::{
    contract_transfer_out, decrease_locked_balance, get_token_client, increase_locked_balance,
    require_initialized, require_not_paused, require_transfer_succeeded, ContractError, DataKey,
    MultiSigProposal, MultiSigStatus, MAX_MULTISIG_AMOUNT, MAX_MULTISIG_SIGNERS, MAX_MULTISIG_TTL,
    MIN_MULTISIG_AMOUNT,
};

use crate::events::*;
use crate::storage::*;
// ─── Multi-sig payments ───────────────────────────────────────────────────

/// Create an N-of-M payment proposal. The proposer deposits `amount` tokens
/// into the contract. The payment executes automatically once `threshold`
/// distinct signers from `signers` have approved.
///
/// Returns the proposal ID.
pub fn create_multisig(
    env: Env,
    token_address: Address,
    proposer: Address,
    recipient: Address,
    amount: i128,
    threshold: u32,
    signers: Vec<Address>,
    expiration_ledger: u32,
) -> u32 {
    require_initialized(&env);
    require_not_paused(&env);
    proposer.require_auth();
    if proposer == recipient {
        panic!("cannot create multisig to yourself");
    }
    if amount <= 0 {
        panic!("amount must be positive");
    }
    if amount > MAX_MULTISIG_AMOUNT {
        panic!("amount exceeds maximum multi-sig size");
    }
    if amount < MIN_MULTISIG_AMOUNT {
        panic!("amount below minimum multi-sig size");
    }
    if expiration_ledger <= env.ledger().sequence() {
        panic!("expiration_ledger must be in the future");
    }
    if expiration_ledger > env.ledger().sequence() + MAX_MULTISIG_TTL {
        panic!("expiration_ledger exceeds maximum multi-sig TTL");
    }
    if threshold == 0 || threshold > signers.len() {
        panic!("threshold must be between 1 and signers.len()");
    }
    if signers.len() == 0 {
        panic!("signers list must not be empty");
    }
    if signers.len() > MAX_MULTISIG_SIGNERS {
        panic!("too many signers");
    }

    // Prevent duplicate signers that could spoof the true threshold.
    for i in 0..signers.len() {
        for j in (i + 1)..signers.len() {
            if signers.get(i).unwrap() == signers.get(j).unwrap() {
                panic!("duplicate signer in signers list");
            }
        }
    }

    // Lock funds.
    let token = get_token_client(&env, &token_address);
    let contract_address = env.current_contract_address();
    require_transfer_succeeded(&env, &token, &proposer, &contract_address, &amount);

    let id: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::MultiSigCount)
        .unwrap_or(0);

    let proposal = MultiSigProposal {
        id,
        proposer: proposer.clone(),
        recipient: recipient.clone(),
        token: token_address,
        amount,
        threshold,
        signers,
        approvals: Vec::new(&env),
        status: MultiSigStatus::Pending,
        expiration_ledger,
    };
    increase_locked_balance(&env, &proposal.token, amount);
    env.storage()
        .persistent()
        .set(&DataKey::MultiSig(id), &proposal);
    bump_to_floor(&env, &DataKey::MultiSig(id));
    env.storage()
        .persistent()
        .set(&DataKey::MultiSigCount, &(id + 1));
    bump(&env, &DataKey::MultiSigCount);

    env.events().publish_event(&MultisigCreated {
        proposal_id: id,
        proposer,
        recipient,
        amount,
        threshold,
        signers_count: proposal.signers.len(),
        expiration_ledger,
    });
    id
}

/// A signer approves proposal `id`. If the approval count reaches `threshold`
/// the payment is executed immediately within this call.
pub fn approve_multisig(env: Env, proposal_id: u32, signer: Address) {
    require_not_paused(&env);
    signer.require_auth();

    let mut proposal: MultiSigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultiSig(proposal_id))
        .expect("proposal not found");

    if proposal.status != MultiSigStatus::Pending {
        panic!("proposal is not pending");
    }

    // Check if the proposal has expired. Every proposal is required to
    // carry a positive, bounded expiration (see `create_multisig`), so
    // there is no "no expiration" bypass here.
    if env.ledger().sequence() > proposal.expiration_ledger {
        panic!("proposal has expired");
    }

    // Verify signer is in the allowed list using iterator.
    let allowed = proposal.signers.iter().any(|s| s == signer);
    if !allowed {
        panic!("signer not authorised for this proposal");
    }

    // Prevent duplicate approvals using iterator.
    if proposal.approvals.iter().any(|a| a == signer) {
        panic!("already approved");
    }

    proposal.approvals.push_back(signer.clone());

    env.events().publish_event(&MultisigApproved {
        proposal_id,
        approver: signer.clone(),
        count: proposal.approvals.len(),
        threshold: proposal.threshold,
    });

    // Auto-execute if threshold is reached.
    if proposal.approvals.len() >= proposal.threshold {
        let token = get_token_client(&env, &proposal.token);
        contract_transfer_out(&env, &token, &proposal.recipient, &proposal.amount);
        decrease_locked_balance(&env, &proposal.token, proposal.amount);
        proposal.status = MultiSigStatus::Executed;
        env.events().publish_event(&MultisigExecuted {
            proposal_id,
            recipient: proposal.recipient.clone(),
            amount: proposal.amount,
        });
    }

    env.storage()
        .persistent()
        .set(&DataKey::MultiSig(proposal_id), &proposal);
    bump(&env, &DataKey::MultiSig(proposal_id));
}

/// Anyone can call this to close an expired multi-sig proposal and refund
/// the proposer. This prevents funds from being locked forever if signers
/// abandon a proposal.
pub fn timeout_multisig(env: Env, proposal_id: u32) {
    require_not_paused(&env);
    let mut proposal: MultiSigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultiSig(proposal_id))
        .expect("proposal not found");

    if proposal.status != MultiSigStatus::Pending {
        panic!("proposal is not pending");
    }
    if proposal.expiration_ledger == 0 {
        panic!("proposal has no expiration");
    }
    if env.ledger().sequence() <= proposal.expiration_ledger {
        panic!("proposal has not yet expired");
    }

    let token = get_token_client(&env, &proposal.token);
    contract_transfer_out(&env, &token, &proposal.proposer, &proposal.amount);

    proposal.status = MultiSigStatus::Cancelled;
    decrease_locked_balance(&env, &proposal.token, proposal.amount);
    env.storage()
        .persistent()
        .set(&DataKey::MultiSig(proposal_id), &proposal);
    bump(&env, &DataKey::MultiSig(proposal_id));

    env.events().publish_event(&MultisigTimeout {
        proposal_id,
        proposer: proposal.proposer.clone(),
        amount: proposal.amount,
    });
}

/// The proposer cancels the proposal before execution; funds are refunded.
pub fn cancel_multisig(env: Env, proposal_id: u32, proposer: Address) {
    require_not_paused(&env);
    proposer.require_auth();

    let mut proposal: MultiSigProposal = env
        .storage()
        .persistent()
        .get(&DataKey::MultiSig(proposal_id))
        .expect("proposal not found");

    if proposal.proposer != proposer {
        panic!("only the proposer may cancel");
    }
    if proposal.status != MultiSigStatus::Pending {
        panic!("proposal is not pending");
    }

    let token = get_token_client(&env, &proposal.token);
    contract_transfer_out(&env, &token, &proposer, &proposal.amount);
    decrease_locked_balance(&env, &proposal.token, proposal.amount);

    proposal.status = MultiSigStatus::Cancelled;
    env.storage()
        .persistent()
        .set(&DataKey::MultiSig(proposal_id), &proposal);
    bump(&env, &DataKey::MultiSig(proposal_id));

    env.events().publish_event(&MultisigCancelled {
        proposal_id,
        proposer,
        amount: proposal.amount,
    });
}

/// Return the multi-sig proposal for `proposal_id`.
pub fn get_multisig(env: Env, proposal_id: u32) -> Result<MultiSigProposal, ContractError> {
    let key = DataKey::MultiSig(proposal_id);
    match env.storage().persistent().get(&key) {
        Some(proposal) => {
            bump(&env, &key);
            Ok(proposal)
        }
        None => Err(ContractError::NotFound),
    }
}

/// Return total number of multi-sig proposals ever created.
pub fn get_multisig_count(env: Env) -> u32 {
    let key = DataKey::MultiSigCount;
    let count = env.storage().persistent().get(&key).unwrap_or(0);
    bump_if_present(&env, &key);
    count
}

/// Stable alias for `get_multisig_count`. Provides a consistent SDK
/// binding for dashboard and analytics consumers.
pub fn multisig_count(env: Env) -> u32 {
    {
        let key = DataKey::MultiSigCount;
        let c = env.storage().persistent().get(&key).unwrap_or(0);
        bump_if_present(&env, &key);
        c
    }
}

// ─── Diagnostic helpers ───────────────────────────────────────────────────

/// Return aggregate counts of all active contract state for off-chain
/// monitoring and dashboards. Returns (escrow_count, stream_count,
/// multisig_count).
pub fn get_contract_stats(env: Env) -> (u32, u32, u32) {
    (
        {
            let key = DataKey::EscrowCount;
            let c = env.storage().persistent().get(&key).unwrap_or(0);
            bump_if_present(&env, &key);
            c
        },
        {
            let key = DataKey::StreamCount;
            let c = env.storage().persistent().get(&key).unwrap_or(0);
            bump_if_present(&env, &key);
            c
        },
        {
            let key = DataKey::MultiSigCount;
            let c = env.storage().persistent().get(&key).unwrap_or(0);
            bump_if_present(&env, &key);
            c
        },
    )
}
