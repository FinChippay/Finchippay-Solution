# finchippay-contract

Soroban smart contract for the **Finchippay-Solution** platform on Stellar.

## Overview

`FinchippayContract` is a production-grade Soroban contract written in Rust that provides the on-chain payment primitives for the Finchippay-Solution platform.

### Features

| Feature | Functions |
|---|---|
| **Tips** | `send_tip`, `get_tip_total`, `get_tip_count`, `get_tip_record` |
| **Receipts** | `mint_receipt`, `get_receipt`, `get_receipt_count` |
| **Escrow** | `create_escrow`, `claim_escrow`, `claim_escrow_partial`, `cancel_escrow`, `get_escrow`, `get_user_escrows` |
| **Streaming** | `open_stream`, `claim_stream`, `top_up_stream`, `close_stream`, `reject_stream`, `transfer_stream`, `get_stream`, `get_claimable` |
| **Multi-sig** | `create_multisig`, `approve_multisig`, `cancel_multisig`, `timeout_multisig`, `get_multisig` |
| **Batch** | `batch_send` |
| **Admin** | `initialize`, `transfer_admin`, `get_admin`, `pause`, `unpause`, `is_paused`, `set_pauser`, `get_pauser`, `upgrade`, `get_version`, `rescue_tokens` |
| **Diagnostics** | `get_contract_stats`, `get_escrow_count`, `get_stream_count`, `get_multisig_count` |

## Streaming Payments

A stream releases tokens continuously per ledger. At ledger `L`:

```
elapsed   = L - start_ledger
streamed  = rate_per_ledger × elapsed   (capped at deposited)
claimable = min(streamed, deposited) - claimed
```

Recipients can call `claim_stream` at any time to drain accrued tokens. Payers can `top_up_stream` to extend the stream or `close_stream` to end it early (accrued tokens go to the recipient; remainder is refunded).

## Multi-Sig Payments

`create_multisig` locks funds and stores a list of allowed `signers` plus a `threshold` N. Each call to `approve_multisig` by a distinct signer appends to the approval list. When `approvals.len() >= threshold` the payment executes automatically in the same transaction — no separate execution call required.

## Security

- Every mutating entry-point calls `require_auth()` on the authorising address.
- All arithmetic uses `checked_add` / `checked_sub` / `checked_mul`; overflows panic rather than silently wrap.
- Storage TTLs are bumped on every read and write to prevent ledger expiry.
- `EscrowStatus`, `MultiSigStatus`, and `closed` fields prevent double-claim and double-cancel attacks.
- **RBAC**: A separate `pauser` role can freeze/unfreeze operations without admin upgrade rights via `set_pauser`.
- **Upgradability**: admin can call `upgrade(new_wasm_hash)` to deploy security patches without migrating state. Version is tracked and incremented on each upgrade.
- **Bounded inputs**:
  - Escrow release ledgers are capped at `MAX_ESCROW_LEDGERS` (~30 days).
  - Stream deposits are capped at `MAX_STREAM_DEPOSIT` with cumulative top-up enforcement.
  - Stream rates are capped at `MAX_STREAM_RATE` to prevent overflow.
  - Multi-sig proposals are capped at `MAX_MULTISIG_AMOUNT` and `MAX_MULTISIG_SIGNERS` (20).
- Escrow amounts are capped at `MAX_ESCROW_AMOUNT` and have a minimum of `MIN_ESCROW_AMOUNT` to prevent dust attacks.
- Multi-sig proposals have a minimum of `MIN_MULTISIG_AMOUNT` and can include an `expiration_ledger` to auto-expire abandoned proposals.
- Multi-sig signer lists are checked for duplicates at creation time.
- Self-transfers (from == to) are rejected for tips, escrows, streams, and multi-sig.
- Batch sends are limited to `MAX_BATCH_SIZE` (50) recipients and amounts are pre-validated for atomicity.
- All operational entry points require the contract to be initialized via `initialize()`.

## Build

```bash
# Requires Rust + wasm32v1-none target (soroban-sdk v27.0.0+)
rustup target add wasm32v1-none

cargo test
cargo build --release --target wasm32v1-none
```

The compiled WASM lands at:
```
target/wasm32v1-none/release/finchippay_contract.wasm
```

## Deploy to Stellar Testnet

```bash
bash ../../scripts/deploy-contract.sh
```

## Events emitted

| Topic | Data | Emitted by |
|---|---|---|
| `(init,)` | `admin: Address` | `initialize` |
| `(admin_transfer,)` | `new_admin: Address` | `transfer_admin` |
| `(tip, from, to)` | `amount: i128` | `send_tip` |
| `(receipt, from)` | `index: u32` | `mint_receipt` |
| `(escrow_create, id)` | `(from, to, amount, release_ledger)` | `create_escrow` |
| `(escrow_claim, id)` | `(to, amount)` | `claim_escrow` |
| `(escrow_cancel, id)` | `(from, amount)` | `cancel_escrow` |
| `(stream_open, id)` | `(payer, recipient, rate, deposit)` | `open_stream` |
| `(stream_claim, id)` | `(recipient, amount)` | `claim_stream` |
| `(stream_topup, id)` | `(payer, amount)` | `top_up_stream` |
| `(stream_close, id)` | `(payer, refund)` | `close_stream` |
| `(multisig_create, id)` | `(proposer, recipient, amount, threshold)` | `create_multisig` |
| `(multisig_approve, id)` | `(signer, current_approvals, threshold)` | `approve_multisig` |
| `(multisig_executed, id)` | `(recipient, amount)` | `approve_multisig` (auto) |
| `(multisig_cancel, id)` | `(proposer, amount)` | `cancel_multisig` |
| `(multisig_timeout, id)` | `(proposer, amount)` | `timeout_multisig` |
| `(stream_reject, id)` | `(recipient, refund)` | `reject_stream` |
| `(stream_transfer, id)` | `(old_recipient, new_recipient)` | `transfer_stream` |
| `(escrow_claim_partial, id)` | `(to, claim_amount, remaining)` | `claim_escrow_partial` |
| `(rescue_tokens,)` | `(token, amount, to)` | `rescue_tokens` |
| `(pauser_set,)` | `pauser: Address` | `set_pauser` |
| `(batch_send, from)` | `count: u32` | `batch_send` |
| `(paused,)` | `()` | `pause` |
| `(unpaused,)` | `()` | `unpause` |
| `(upgraded,)` | `(version: u32, wasm_hash: BytesN<32>)` | `upgrade` |

## License

MIT
