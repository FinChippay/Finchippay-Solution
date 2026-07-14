# Stellar MicroPay — Soroban Contract

This directory contains the Soroban smart contract for Stellar MicroPay.

## Overview

The contract is written in Rust and compiled to WebAssembly (WASM) for deployment on the Stellar network via Soroban.

**Current features (v0.1):**
- Contract initialization with admin
- On-chain tip recording with event emission
- Tip total and count queries per recipient
- Receipt metadata minting for payments
- Batch tip/payment recording
- Placeholder stub for escrow payments

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli
```

## Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm`

## Test

```bash
cargo test
```

## Deploy to Testnet

```bash
# Configure your identity
stellar keys generate --global alice --network testnet

# Fund with Friendbot
stellar keys fund alice --network testnet

# Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
  --source alice \
  --network testnet
```

## Invoke

```bash
# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- initialize \
  --admin <YOUR_PUBLIC_KEY>

# Send a tip
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- send_tip \
  --token_address <XLM_SAC_ADDRESS> \
  --from <SENDER_ADDRESS> \
  --to <RECIPIENT_ADDRESS> \
  --amount 1000000

# Check tip total
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_tip_total \
  --recipient <RECIPIENT_ADDRESS>
```

## Function Reference

All amounts are `i128` stroop-denominated values unless a caller explicitly passes a different token contract address. Address parameters use Soroban `Address` values.

### `initialize(env: Env, admin: Address) -> ()`

- **Parameters**:
  - `admin: Address` - account stored as the contract administrator.
- **Return value**: none.
- **Authorization requirements**: none in the current implementation; the first successful caller sets the admin.
- **Events emitted**: `(init)` with the admin address as event data.
- **Error conditions**:
  - Panics with `Contract already initialized` if an admin is already stored.

### `transfer_admin(env: Env, current_admin: Address, new_admin: Address) -> ()`

- **Parameters**:
  - `current_admin: Address` - expected current administrator.
  - `new_admin: Address` - replacement administrator to store.
- **Return value**: none.
- **Authorization requirements**: `current_admin.require_auth()`.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Contract not initialized` if `initialize` has not run.
  - Panics with `Unauthorized` if `current_admin` does not match the stored admin.

### `send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128) -> ()`

- **Parameters**:
  - `token_address: Address` - Soroban token contract used for the transfer.
  - `from: Address` - payer/tipper address.
  - `to: Address` - recipient/creator address.
  - `amount: i128` - amount to transfer and record.
- **Return value**: none.
- **Authorization requirements**: `from.require_auth()`.
- **Events emitted**: `(tip, from, to)` with `amount` as event data.
- **Error conditions**:
  - Panics with `Tip amount must be positive` when `amount <= 0`.
  - Propagates token contract transfer failures, including insufficient balance, missing trustline, or token authorization failures.

### `get_tip_total(env: Env, recipient: Address) -> i128`

- **Parameters**:
  - `recipient: Address` - address whose cumulative received tips should be read.
- **Return value**: total recorded tip amount for `recipient`, or `0` when no tips have been recorded.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**: none in normal operation.

### `get_tip_count(env: Env, recipient: Address) -> u32`

- **Parameters**:
  - `recipient: Address` - address whose recorded tip count should be read.
- **Return value**: number of recorded tips for `recipient`, or `0` when no tips have been recorded.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**: none in normal operation.

### `get_admin(env: Env) -> Address`

- **Parameters**: none.
- **Return value**: stored admin address.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Contract not initialized` if `initialize` has not run.

### `get_tip_record(env: Env, recipient: Address, index: u32) -> TipRecord`

- **Parameters**:
  - `recipient: Address` - recipient whose tip record should be read.
  - `index: u32` - zero-based record index for that recipient.
- **Return value**: `TipRecord { from, to, amount, ledger }`.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Tip record not found` if no record exists for `(recipient, index)`.

### `mint_receipt(env: Env, from: Address, to: Address, amount: i128, memo: Symbol) -> u32`

- **Parameters**:
  - `from: Address` - payer address that owns the receipt record.
  - `to: Address` - payment recipient address.
  - `amount: i128` - amount represented by the receipt.
  - `memo: Symbol` - short receipt memo stored on-chain.
- **Return value**: zero-based receipt index for `from`.
- **Authorization requirements**: `from.require_auth()`.
- **Events emitted**: `(receipt, from)` with the receipt index as event data.
- **Error conditions**:
  - Panics with `Receipt amount must be positive` when `amount <= 0`.

### `get_receipt_count(env: Env, payer: Address) -> u32`

- **Parameters**:
  - `payer: Address` - receipt owner whose count should be read.
- **Return value**: number of receipt records for `payer`, or `0` when none exist.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**: none in normal operation.

### `get_receipt(env: Env, payer: Address, index: u32) -> ReceiptMetadata`

- **Parameters**:
  - `payer: Address` - receipt owner.
  - `index: u32` - zero-based receipt index for that payer.
- **Return value**: `ReceiptMetadata { from, to, amount, timestamp, memo, ledger }`.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Receipt not found` if no receipt exists for `(payer, index)`.

### `create_escrow(env: Env, from: Address, to: Address, amount: i128, release_ledger: u32) -> ()`

- **Parameters**:
  - `from: Address` - intended escrow funder.
  - `to: Address` - intended escrow beneficiary.
  - `amount: i128` - intended escrow amount.
  - `release_ledger: u32` - intended release ledger.
- **Return value**: none.
- **Authorization requirements**: none in the current stub.
- **Events emitted**: none.
- **Error conditions**:
  - Always panics with `Escrow payments coming in v2.1 — see ROADMAP.md`.

### `batch_send(env: Env, token_address: Address, from: Address, recipients: Vec<Address>, amounts: Vec<i128>) -> ()`

- **Parameters**:
  - `token_address: Address` - Soroban token contract used for every transfer.
  - `from: Address` - payer address.
  - `recipients: Vec<Address>` - recipient addresses, ordered to match `amounts`.
  - `amounts: Vec<i128>` - transfer amounts, ordered to match `recipients`.
- **Return value**: none.
- **Authorization requirements**: `from.require_auth()`.
- **Events emitted**: none in the current implementation.
- **Error conditions**:
  - Panics with `arrays must have equal length` if `recipients.len() != amounts.len()`.
  - Panics with `amount must be positive` if any amount is `<= 0`.
  - Propagates token contract transfer failures, including insufficient balance, missing trustline, or token authorization failures.

## Troubleshooting (#153)

The CLI commands above only work if the contract compiles — and as of this
writing `src/lib.rs` carries unresolved merge residue that blocks
`cargo build`:

- ~~Two `DataKey` enums were defined at module scope.~~ Merged into one in
  this PR — both sets of variants are needed by the contract methods.
- `impl MicroPayContract { ... }` should be `impl StellarMicroPay`. The
  `initialize` function lost its signature in the same merge — its body
  starts directly after the section comment. A standalone follow-up issue
  needs to reconstruct the function signatures by walking the original
  PRs (`git log -p src/lib.rs`).
- Several other methods (`send_tip`, `close_stream`, etc.) appear to have
  bodies that reference identifiers from neighboring functions, suggesting
  more than one merge dropped function boundaries.

If `cargo build --target wasm32-unknown-unknown --release` fails with
"unexpected closing delimiter" or "cannot find type", check `git blame`
around the offending line first — most of the breakage looks like
incomplete merge resolutions, not real logic bugs. Until the contract
compiles, `stellar contract deploy` has no `.wasm` artifact to upload, so
every CLI step from "Deploy to Testnet" onward is blocked.

## XLM SAC Address (Testnet)

The Stellar Asset Contract address for native XLM on testnet:
```
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Roadmap

- **v2.1** — Escrow payments with time-lock release
- **v2.0** — Batch micro-payment transactions
- **v1.4** — Creator tip pages

See [ROADMAP.md](../../ROADMAP.md) for full details.
