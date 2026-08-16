//! # Finchippay Contract — Typed Events
//!
//! Structured, schema-enforced events emitted by the contract. Every event is
//! a `#[contractevent]` struct: the struct's snake-case name becomes the first
//! topic, and every field becomes a named entry in the event data (a Soroban
//! `Map`). Indexers and generated SDK clients can deserialize these directly
//! instead of relying on ad-hoc `(Symbol, ...)` tuple layouts.
//!
//! ## Event Catalog
//!
//! | Struct (topic) | Fields | Description |
//! |---|---|---|
//! | `Init` (`init`) | admin | Contract initialised |
//! | `AdminTransfer` (`admin_transfer`) | new_admin | Legacy admin pointer transferred |
//! | `AdminSignersSet` (`admin_signers_set`) | threshold, signer_count | Admin signer set updated |
//! | `Paused` (`paused`) | — | Circuit breaker activated |
//! | `Unpaused` (`unpaused`) | — | Circuit breaker deactivated |
//! | `PauserSet` (`pauser_set`) | pauser | Pauser role assigned |
//! | `Upgraded` (`upgraded`) | new_version, wasm_hash, layout_version | Contract upgraded |
//! | `TtlBumped` (`ttl_bumped`) | keys_bumped, class_index, key_index | TTL sweep progress |
//! | `TipSent` (`tip_sent`) | from, to, amount, ledger, memo | Tip recorded |
//! | `ReceiptMinted` (`receipt_minted`) | payer, receipt_index | Payment receipt minted |
//! | `EscrowCreated` (`escrow_created`) | escrow_id, from, to, amount, release_ledger | Escrow opened |
//! | `EscrowClaimPartial` (`escrow_claim_partial`) | escrow_id, to, claim_amount, remaining | Partial escrow claim |
//! | `EscrowClaimed` (`escrow_claimed`) | escrow_id, recipient, amount | Escrow claimed |
//! | `EscrowCancelled` (`escrow_cancelled`) | escrow_id, from, amount | Escrow cancelled by sender |
//! | `DisputableEscrowCreated` (`disputable_escrow_created`) | escrow_id, arbitrator | Disputable escrow opened |
//! | `DisputeRaised` (`dispute_raised`) | escrow_id, raised_by | Dispute flag set |
//! | `DisputeResolved` (`dispute_resolved`) | escrow_id, resolution, to, amount | Dispute resolved by arbitrator |
//! | `ArbitratorAdded` (`arbitrator_added`) | arbitrator | Arbitrator registered |
//! | `ArbitratorRemoved` (`arbitrator_removed`) | arbitrator | Arbitrator deregistered |
//! | `StreamOpened` (`stream_opened`) | stream_id, payer, recipient, rate, deposit | Stream started |
//! | `StreamClaimed` (`stream_claimed`) | stream_id, recipient, amount | Stream funds withdrawn |
//! | `StreamToppedUp` (`stream_topped_up`) | stream_id, payer, amount, deposited | Stream balance increased |
//! | `StreamClose` (`stream_close`) | stream_id, payer, refund | Stream closed by payer |
//! | `StreamClosed` (`stream_closed`) | stream_id, refund, claimable | Final close settlement |
//! | `StreamReject` (`stream_reject`) | stream_id, recipient, refund | Stream rejected by recipient |
//! | `StreamTransfer` (`stream_transfer`) | stream_id, from, to | Stream recipient transferred |
//! | `MultisigCreated` (`multisig_created`) | proposal_id, proposer, recipient, amount, threshold, signers_count, expiration_ledger | Multi-sig proposal created |
//! | `MultisigApproved` (`multisig_approved`) | proposal_id, approver, count, threshold | Proposal approved |
//! | `MultisigExecuted` (`multisig_executed`) | proposal_id, recipient, amount | Payment executed |
//! | `MultisigTimeout` (`multisig_timeout`) | proposal_id, proposer, amount | Expired proposal refunded |
//! | `MultisigCancelled` (`multisig_cancelled`) | proposal_id, proposer, amount | Proposal cancelled |
//! | `BatchSent` (`batch_sent`) | sender, recipient_count, total_amount | Batch payment completed |
//! | `BatchSentMulti` (`batch_sent_multi`) | sender, recipient_count, total_amount | Multi-token batch completed |
//! | `VestingCreate` (`vesting_create`) | vesting_id, from, beneficiary, amount, cliff_ledger, end_ledger | Vesting schedule created |
//! | `VestingClaim` (`vesting_claim`) | vesting_id, beneficiary, amount | Vesting funds withdrawn |
//! | `VestingRevoke` (`vesting_revoke`) | vesting_id, funder, amount | Vesting revoked |
//! | `AirdropCreated` (`airdrop_created`) | airdrop_id, funder, token, total_amount | Airdrop funded |
//! | `AirdropClaimed` (`airdrop_claimed`) | airdrop_id, recipient, amount | Airdrop claimed |
//! | `AirdropCancelled` (`airdrop_cancelled`) | airdrop_id, funder, amount | Airdrop cancelled |
//! | `YieldEscrowCreate` (`yield_escrow_create`) | escrow_id, from, to, token, amount, shares | Yield escrow opened |
//! | `YieldEscrowClaim` (`yield_escrow_claim`) | escrow_id, to, amount | Yield escrow claimed |
//! | `YieldEscrowCancelled` (`yield_escrow_cancelled`) | escrow_id, from, amount | Yield escrow cancelled |
//! | `EmergencyWithdrawalInitiated` (`emergency_withdrawal_initiated`) | withdrawal_id, initiator, token, amount, activation_ledger | Emergency withdrawal requested |
//! | `EmergencyWithdrawalApproved` (`emergency_withdrawal_approved`) | withdrawal_id, signer, count, threshold | Emergency withdrawal approved |
//! | `EmergencyWithdrawalExecuted` (`emergency_withdrawal_executed`) | withdrawal_id, to, amount | Funds rescued |
//! | `EmergencyWithdrawalCancelled` (`emergency_withdrawal_cancelled`) | withdrawal_id, admin, amount | Emergency withdrawal cancelled |
//! | `AdminActionProposed` (`admin_action_proposed`) | proposal_id, action_type, proposer | Gov proposal created |
//! | `AdminActionApproved` (`admin_action_approved`) | proposal_id, approver, count, threshold | Gov action approved |
//! | `RescueTokens` (`rescue_tokens`) | token, amount, to | Legacy token rescue |
//! | `FeeCollectorSet` (`fee_collector_set`) | collector | Swap fee collector assigned |
//! | `SwapFeeSet` (`swap_fee_set`) | fee_bps | Swap fee updated |
//! | `Swap` (`swap`) | caller, token_in, token_out, amount_in, amount_out, fee | Token swap settled |

use soroban_sdk::{contractevent, Address, BytesN, Symbol};

// ─── Admin / config ──────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct Init {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminTransfer {
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Paused {}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Unpaused {}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PauserSet {
    pub pauser: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminSignersSet {
    pub threshold: u32,
    pub signer_count: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Upgraded {
    pub new_version: u32,
    pub wasm_hash: BytesN<32>,
    pub layout_version: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct TtlBumped {
    pub keys_bumped: u32,
    pub class_index: u32,
    pub key_index: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminActionProposed {
    pub proposal_id: u64,
    pub action_type: Symbol,
    pub proposer: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminActionApproved {
    pub proposal_id: u64,
    pub approver: Address,
    pub count: u32,
    pub threshold: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RescueTokens {
    pub token: Address,
    pub amount: i128,
    pub to: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeCollectorSet {
    pub collector: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SwapFeeSet {
    pub fee_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Swap {
    pub caller: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub fee: i128,
}

// ─── Tips / receipts ─────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct TipSent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
    pub memo: Symbol,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ReceiptMinted {
    pub payer: Address,
    pub receipt_index: u32,
}

// ─── Escrow / disputes ───────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowCreated {
    pub escrow_id: u32,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub release_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowClaimPartial {
    pub escrow_id: u32,
    pub to: Address,
    pub claim_amount: i128,
    pub remaining: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowClaimed {
    pub escrow_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowCancelled {
    pub escrow_id: u32,
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputableEscrowCreated {
    pub escrow_id: u32,
    pub arbitrator: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputeRaised {
    pub escrow_id: u32,
    pub raised_by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputeResolved {
    pub escrow_id: u32,
    pub resolution: Symbol,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ArbitratorAdded {
    pub arbitrator: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ArbitratorRemoved {
    pub arbitrator: Address,
}

// ─── Streaming payments ──────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamOpened {
    pub stream_id: u32,
    pub payer: Address,
    pub recipient: Address,
    pub rate: i128,
    pub deposit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamClaimed {
    pub stream_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamToppedUp {
    pub stream_id: u32,
    pub payer: Address,
    pub amount: i128,
    pub deposited: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamClose {
    pub stream_id: u32,
    pub payer: Address,
    pub refund: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamClosed {
    pub stream_id: u32,
    pub refund: i128,
    pub claimable: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamReject {
    pub stream_id: u32,
    pub recipient: Address,
    pub refund: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StreamTransfer {
    pub stream_id: u32,
    pub from: Address,
    pub to: Address,
}

// ─── Yield escrow (AMM/DeFi pool integration) ────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct YieldEscrowCreate {
    pub escrow_id: u64,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct YieldEscrowClaim {
    pub escrow_id: u64,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct YieldEscrowCancelled {
    pub escrow_id: u64,
    pub from: Address,
    pub amount: i128,
}

// ─── Batch send / vesting ────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct BatchSent {
    pub sender: Address,
    pub recipient_count: u32,
    pub total_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct BatchSentMulti {
    pub sender: Address,
    pub recipient_count: u32,
    pub total_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct VestingCreate {
    pub vesting_id: u32,
    pub from: Address,
    pub beneficiary: Address,
    pub amount: i128,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct VestingClaim {
    pub vesting_id: u32,
    pub beneficiary: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct VestingRevoke {
    pub vesting_id: u32,
    pub funder: Address,
    pub amount: i128,
}

// ─── Airdrop ─────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct AirdropCreated {
    pub airdrop_id: u32,
    pub funder: Address,
    pub token: Address,
    pub total_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AirdropClaimed {
    pub airdrop_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AirdropCancelled {
    pub airdrop_id: u32,
    pub funder: Address,
    pub amount: i128,
}

// ─── Multi-sig payments ──────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigCreated {
    pub proposal_id: u32,
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub threshold: u32,
    pub signers_count: u32,
    pub expiration_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigApproved {
    pub proposal_id: u32,
    pub approver: Address,
    pub count: u32,
    pub threshold: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigExecuted {
    pub proposal_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigTimeout {
    pub proposal_id: u32,
    pub proposer: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigCancelled {
    pub proposal_id: u32,
    pub proposer: Address,
    pub amount: i128,
}

// ─── Emergency withdrawal ────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawalInitiated {
    pub withdrawal_id: u32,
    pub initiator: Address,
    pub token: Address,
    pub amount: i128,
    pub activation_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawalApproved {
    pub withdrawal_id: u32,
    pub signer: Address,
    pub count: u32,
    pub threshold: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawalExecuted {
    pub withdrawal_id: u32,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawalCancelled {
    pub withdrawal_id: u32,
    pub admin: Address,
    pub amount: i128,
}
