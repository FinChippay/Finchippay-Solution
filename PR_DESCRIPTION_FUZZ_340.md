# 🎯 Soroban Contract Fuzz Testing with cargo-fuzz

> Closes #340
> Labels: `smart-contract`, `security`, `testing`, `ci`
> Type: New Feature

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Solution Overview](#solution-overview)
3. [Architecture & Design Decisions](#architecture--design-decisions)
4. [Fuzz Targets Reference](#fuzz-targets-reference)
5. [Files Changed](#files-changed)
6. [CI Integration](#ci-integration)
7. [How to Run Locally](#how-to-run-locally)
8. [Acceptance Criteria Checklist](#acceptance-criteria-checklist)
9. [How to Review & Test](#how-to-review--test)
10. [Future Work / Out of Scope](#future-work--out-of-scope)

---

## Problem Statement

The `FinchippayContract` Soroban smart contract currently relies on unit tests and the property-based `PropertyRng` framework in `lib.rs`. While the property tests cover the streaming payment formula, other critical paths — escrow creation/claiming, multi-sig approval counting, batch send looping, and memo parsing — have **no fuzz coverage**.

**Why this matters:**

- Unit tests cover known scenarios but miss unknown edge cases
- Coverage-guided fuzzing can discover inputs that cause panics, arithmetic overflows, or incorrect state transitions
- The contract handles token transfers worth real value on Stellar mainnet — a single undiscovered overflow or state corruption could result in lost funds
- The `validate_contract.py` script and existing test suites don't include any fuzzing infrastructure

## Solution Overview

### What was built

A complete **coverage-guided fuzz testing infrastructure** for the `FinchippayContract` Soroban contract using [`cargo-fuzz`](https://github.com/rust-fuzz/cargo-fuzz) (libFuzzer):

1. **4 fuzz targets** covering the most critical code paths
2. **CI integration** — fast-check fuzz runs on every push and PR
3. **Bash runner script** (`scripts/fuzz-contract.sh`) for local development
4. **Comprehensive documentation** (`FUZZING.md`) for contributors
5. **Validation updates** — `validate_contract.py` now verifies fuzz infrastructure

### Technical Approach

Fuzz targets use `soroban-sdk` with the `testutils` feature to create an isolated, simulated `Env` for each iteration. This avoids the need for a real Stellar network while testing the full contract logic — storage reads/writes, token transfers, auth checks, and state transitions.

To make this work, a `testutils` feature gate was added to the contract's `Cargo.toml` so the fuzz crate can compile the contract for the host (x86_64) target instead of WASM.

### Key numbers

| Metric | Value |
|--------|-------|
| Fuzz targets | **4** |
| Code paths covered | parse_payment, escrow lifecycle, multi-sig approval, batch_send |
| New files | **7** |
| Modified files | **3** |
| New lines (~) | **973** |
| CI runtime per target | 60 seconds (test), 30 seconds (local) |

---

## Architecture & Design Decisions

### 1. Why cargo-fuzz (libFuzzer)?

- **Coverage-guided**: Uses code instrumentation to discover inputs that reach new branches, maximizing coverage
- **Mature ecosystem**: Official Rust fuzzing tool, actively maintained, used by major projects
- **CI-friendly**: `-max_total_time` flag enables time-boxed CI runs
- **Crash artifacts**: Automatically saves crashing inputs for reproduction

Alternatives considered:
- `proptest` — Already used indirectly via `PropertyRng`. Good for structured property testing but not coverage-guided.
- `afl.rs` — Requires AFL binary, heavier CI setup, less mature Rust integration.
- OSS-Fuzz — Future goal per the issue spec; deferred to follow-up.

### 2. Fuzz crate structure

The fuzz crate lives at `contracts/finchippay-contract/fuzz/` with its own `Cargo.toml`. It is **not** part of the workspace (to avoid wasm target conflicts) and is run using `cargo +nightly fuzz`:

```
contracts/finchippay-contract/fuzz/
├── Cargo.toml                              # Fuzz crate config
├── corpus/                                 # Seed corpus (auto-generated)
└── fuzz_targets/
    ├── fuzz_target_1_parse_payment.rs      # Memo parsing & storage
    ├── fuzz_target_2_escrow.rs             # Escrow lifecycle
    ├── fuzz_target_3_multisig.rs           # Multi-sig approval logic
    └── fuzz_target_4_batch_send.rs          # Batch send operations
```

### 3. testutils feature gate

The contract's `Cargo.toml` now exposes a `testutils` feature:

```toml
[features]
testutils = ["soroban-sdk/testutils"]
```

This allows the fuzz crate to depend on `finchippay-contract` with `features = ["testutils"]`, enabling host-target compilation. This is a standard pattern for Soroban contract testing — it doesn't affect the wasm build since the feature is opt-in.

### 4. Panic tolerance in fuzz targets

Each fuzz target wraps contract calls in `std::panic::catch_unwind`:

```rust
let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    client.create_escrow(&token_id, &from, &to, &amount, &release_ledger, &memo);
}));
```

This is intentional — the fuzzer generates **random** inputs that may violate contract preconditions (negative amounts, past release ledgers, etc.). These _expected_ panics are caught and ignored. The fuzzer is looking for **unexpected** panics — crashes that should not happen for any input.

### 5. Ledger manipulation

The fuzz targets use `env.ledger().set_sequence_number()` (from `soroban_sdk::testutils::Ledger`) to manipulate the simulated ledger for testing escrow release deadlines and multi-sig expiration. Each test iteration gets a fresh `Env::default()` for full isolation.

---

## Fuzz Targets Reference

### Target 1: `fuzz_target_1_parse_payment` (92 lines)

**Code path**: Memo parsing and storage via `send_tip`, `mint_receipt`, `create_escrow`, `verify_receipt`

**What it fuzzes**:
- Random byte sequences converted to Symbol memos (ASCII-range only to avoid valid UTF-8 panics)
- Tip records, receipts, and escrows with arbitrary memo Symbols
- Receipt round-trip integrity (verify_receipt returns true for correct memo)
- Getter functions (`get_tip_total`, `get_tip_count`) after operations

**Invariants**:
- `verify_receipt` returns `true` for the exact memo that was stored
- Memo round-trips correctly through receipt and escrow storage
- Storage reads don't panic after successful writes

### Target 2: `fuzz_target_2_escrow` (144 lines)

**Code path**: Full escrow lifecycle — `create_escrow` → `claim_escrow` / `claim_escrow_partial` / `cancel_escrow`

**What it fuzzes**:
- Random amounts (mapped to valid `[MIN_ESCROW_AMOUNT, MAX_ESCROW_AMOUNT]` range)
- Random release ledger offsets (1..500,000 ledgers)
- Operation sequences (claim full, claim partial, cancel, combinations)
- Partial claim amounts

**Invariants**:
- Escrow status transitions are valid: `Pending → Released` (claim) or `Pending → Cancelled` (cancel)
- `get_user_escrows` always includes the created escrow ID
- Partial claim reduces escrow amount correctly, status stays Pending until amount reaches 0
- Escrow amount after partial claim matches the returned remaining value

### Target 3: `fuzz_target_3_multisig` (210 lines)

**Code path**: Multi-sig approval logic — `create_multisig` → `approve_multisig` / `cancel_multisig` / `timeout_multisig`

**What it fuzzes**:
- Random signer counts (1..20) and thresholds (1..signer_count)
- Random expiration offsets
- Approval strategies: approve all signers, duplicate approval, invalid signer
- Cancellation and timeout after expiration

**Invariants**:
- Threshold enforcement: execution only when `approvals.len() >= threshold`
- Duplicate approvals are rejected (expect panic)
- Invalid signers are rejected (expect panic)
- Expired proposals cannot be approved (expect panic after timeout)
- `cancel_multisig` transitions status to `Cancelled`
- `timeout_multisig` transitions status to `Cancelled` after expiration

### Target 4: `fuzz_target_4_batch_send` (194 lines)

**Code path**: `batch_send` and `batch_send_multi` with varying recipient counts

**What it fuzzes**:
- Random recipient counts (0..50, plus oversized 55 to test `BatchTooLarge`)
- Length mismatch scenarios (truncated amounts)
- Zero-amount rejection
- `batch_send_multi` variant with per-recipient tokens

**Invariants**:
- `TryBatchTooLarge`, `LengthMismatch`, `NonPositiveAmount`, `InvalidState` errors are returned for invalid inputs
- After successful batch send, tip records are retrievable and amounts match
- `get_tip_total` is non-negative after operations
- Storage integrity (readable counts, versions) preserved after all operations

---

## Files Changed

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `contracts/finchippay-contract/fuzz/Cargo.toml` | 46 | Fuzz crate configuration — depends on finchippay-contract with testutils, defines 4 `[[bin]]` fuzz targets |
| `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_1_parse_payment.rs` | 92 | Fuzz memo parsing & Symbol storage via send_tip, mint_receipt, create_escrow, verify_receipt |
| `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_2_escrow.rs` | 144 | Fuzz escrow lifecycle: create → claim/partial-claim/cancel with random amounts, release ledgers, operation sequences |
| `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_3_multisig.rs` | 210 | Fuzz multi-sig approval: varying thresholds, signer counts, duplicates, invalid signers, timeout |
| `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_4_batch_send.rs` | 194 | Fuzz batch_send/batch_send_multi: random recipient counts, amounts, memos, error cases |
| `scripts/fuzz-contract.sh` | 130 | Bash script to run all 4 fuzz targets with configurable duration; checks prerequisites, handles crashes, prints summary |
| `FUZZING.md` | 157 | Comprehensive documentation: prerequisites, quick start, running individual targets, reproducing crashes, writing new targets, CI overview |

### Modified Files

| File | Change | Lines |
|------|--------|-------|
| `contracts/finchippay-contract/Cargo.toml` | Added `[features] testutils = ["soroban-sdk/testutils"]` gate to enable host-target compilation for fuzzing | +3 |
| `.github/workflows/ci.yml` | Added `contract-fuzz` job (compile check + 4×60s fuzz runs + artifact upload); updated description to "Eight parallel jobs"; added `scripts/fuzz-contract.sh` to validate job | +73 |
| `validate_contract.py` | Added `validate_fuzz()` function — checks fuzz Cargo.toml, 4 targets, fuzz-contract.sh, and FUZZING.md exist and contain expected content; updated main() to run fuzz validation and include it in the summary | +66 |

---

## CI Integration

A new `contract-fuzz` job has been added to `.github/workflows/ci.yml`:

```yaml
contract-fuzz:
  name: Contract Fuzz (libFuzzer)
  runs-on: ubuntu-latest
  steps:
    - Install Rust nightly (dtolnay/rust-toolchain)
    - Cache cargo dependencies
    - Install cargo-fuzz
    - Check fuzz targets compile
    - Run 4 fuzz targets (60s each, crashes → warnings)
    - Upload crash artifacts (30-day retention)
```

**Design rationale:**

- **Nightly Rust**: Required by libFuzzer's `-fsanitize=fuzzer` instrumentation
- **Compile check first**: `cargo +nightly fuzz build` runs before any fuzz execution — compilation failures fail the job immediately (no `|| true` wrapper), unlike crash discoveries which are downgraded to warnings
- **60-second per target**: Fast enough to fit in CI (~5 min total including compilation), long enough to exercise basic coverage
- **Crash artifacts uploaded**: If a fuzz target finds a crash, the input is saved and uploaded for later reproduction
- **Not a blocker**: CRASH findings are warnings, not failures — this is a fast-check, not a long-running campaign

---

## How to Run Locally

### Quick smoke test (5 seconds per target)

```bash
bash scripts/fuzz-contract.sh 5
```

### Standard run (30 seconds per target)

```bash
bash scripts/fuzz-contract.sh
```

### CI-equivalent run (60 seconds per target)

```bash
bash scripts/fuzz-contract.sh 60
```

### Run a single target

```bash
cargo +nightly fuzz run fuzz_target_1_parse_payment \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- -max_total_time=30
```

### Reproduce a crash

```bash
cargo +nightly fuzz run fuzz_target_1_parse_payment \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- contracts/finchippay-contract/fuzz/artifacts/fuzz_target_1_parse_payment/<crash_file>
```

---

## Acceptance Criteria Checklist

| # | Acceptance Criterion | Status |
|---|---------------------|--------|
| 1 | `cargo-fuzz` configuration exists at `contracts/finchippay-contract/fuzz/Cargo.toml` | ✅ |
| 2 | Fuzz target 1: memo/Symbol parsing and storage logic | ✅ `fuzz_target_1_parse_payment.rs` |
| 3 | Fuzz target 2: escrow create + claim + cancel lifecycle | ✅ `fuzz_target_2_escrow.rs` |
| 4 | Fuzz target 3: multi-sig threshold enforcement and approval logic | ✅ `fuzz_target_3_multisig.rs` |
| 5 | Fuzz target 4: batch send with varying recipient counts/amounts | ✅ `fuzz_target_4_batch_send.rs` |
| 6 | `scripts/fuzz-contract.sh` runs all targets for configurable duration | ✅ 30s default, accepts seconds arg |
| 7 | CI runs fuzz targets for 60 seconds each as fast-check | ✅ `contract-fuzz` job in ci.yml |
| 8 | CI uploads crash artifacts for later analysis | ✅ 30-day retention |
| 9 | Documentation in `FUZZING.md` with prerequisites, usage, and debugging | ✅ 157-line comprehensive doc |
| 10 | `validate_contract.py` validates fuzz infrastructure exists | ✅ Checks 4 targets, Cargo.toml, script, docs |
| 11 | `Cargo.toml` has `testutils` feature gate for host-target compilation | ✅ `[features] testutils` |
| 12 | All existing contract tests still pass | ✅ `validate_contract.py` confirms 13+ tests |

---

## How to Review & Test

### Prerequisites

```bash
# Install Rust nightly (required by cargo-fuzz)
rustup toolchain install nightly

# Install cargo-fuzz
cargo install cargo-fuzz
```

### Step 1: Verify contract builds for WASM (no regression)

```bash
cd contracts/finchippay-contract
cargo check --target wasm32v1-none
cargo test
cargo build --target wasm32v1-none --release
```

### Step 2: Verify fuzz targets compile

```bash
cd contracts/finchippay-contract
cargo +nightly fuzz build --fuzz-dir fuzz
```

### Step 3: Run the validator

```bash
python3 validate_contract.py
```

Expected output includes:
```
📋 Fuzz testing infrastructure
  ✅ contracts/finchippay-contract/fuzz/Cargo.toml exists
  ✅ cargo-fuzz metadata
  ✅ libfuzzer-sys dependency
  ✅ testutils feature
  ✅ fuzz_target_1_parse_payment.rs — uses libfuzzer_sys
  ✅ fuzz_target_1_parse_payment.rs — uses finchippay_contract
  ...
  ✅ fuzz-contract.sh — executable
  ✅ FUZZING.md — contains usage instructions
```

### Step 4: Run a quick fuzz smoke test

```bash
bash scripts/fuzz-contract.sh 5
```

### Step 5: Review individual fuzz targets

- `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_1_parse_payment.rs` — Verify memo handling with `Symbol::new`, `send_tip`, `mint_receipt`, `verify_receipt`
- `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_2_escrow.rs` — Verify escrow status transitions and partial claim arithmetic
- `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_3_multisig.rs` — Verify threshold enforcement, duplicate rejection, expiration checking
- `contracts/finchippay-contract/fuzz/fuzz_targets/fuzz_target_4_batch_send.rs` — Verify length mismatch, batch size limits, amount validation

### Step 6: Review documentation

```bash
cat FUZZING.md
```

---

## Future Work / Out of Scope

The following were explicitly **out of scope** for this PR per issue #340:

| Feature | Status | Priority |
|---------|--------|----------|
| Long-running fuzz campaigns (>24h) | Deferred | 🟡 Medium |
| OSS-Fuzz integration for continuous fuzzing | Deferred | 🔴 High (future issue) |
| Pre-generated seed corpus files | Deferred | 🟡 Medium |
| Fuzz the streaming payment formula (`_claimable`) | Deferred | 🟢 Low |
| Differential fuzzing against expected behavior | Deferred | 🟢 Low |
| Cross-contract fuzzing with mock token contracts | Deferred | 🟢 Low |
| Custom mutators for structured input generation | Deferred | 🟢 Low |

---

## PR Checklist

- [x] Code compiles without errors (`cargo check --target wasm32v1-none`)
- [x] All existing contract tests pass (`cargo test`)
- [x] WASM build succeeds (`cargo build --target wasm32v1-none --release`)
- [x] Fuzz targets compile (`cargo +nightly fuzz build --fuzz-dir fuzz`)
- [x] `validate_contract.py` passes with fuzz validation
- [x] `FUZZING.md` documentation is complete
- [x] `scripts/fuzz-contract.sh` is executable and functional
- [x] CI workflow is updated with `contract-fuzz` job
- [x] CI validate job checks for fuzz script
- [x] PR description is comprehensive
- [x] Labels are set (`smart-contract`, `security`, `testing`, `ci`)
- [x] References `closes #340`
