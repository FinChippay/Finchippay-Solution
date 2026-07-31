# Issue #1 — Gas Profiling & Optimisation for FinchippayContract

**Labels:** `contract` `optimization` `soroban` `good-first-issue`

## Summary
Profile every Soroban contract entry-point for CPU instruction cost and storage footprint, then apply targeted optimisations to reduce gas consumption by at least 15%.

## Background
The `FinchippayContract` (`contracts/finchippay-contract/src/lib.rs`) currently has ~1,200 lines of Rust compiled to WASM. Functions like `batch_send` (which loops over recipients, updates tip totals, and bumps TTL on every iteration) and `create_escrow` (which writes to multiple storage slots and maintains a recipient index) are suspected gas hogs. There is no formal gas profiling in the CI pipeline today, making it impossible to track regressions.

## Problem Statement
High gas costs make the contract expensive for end users on Stellar mainnet. Without profiling, contributors cannot make informed decisions about where to focus optimisation effort, and regressions can slip through unnoticed.

## Objectives
1. Add a reproducible gas-profiling harness using Soroban's `budget` and cost inspection APIs.
2. Benchmark all 20+ entry-points across typical, worst-case, and edge-case inputs.
3. Report per-function costs in a CI-friendly format (JSON or Markdown table).
4. Apply at least 3 concrete optimisations that measurably reduce gas.

## Scope
- **In scope:** gas profiling harness, CI integration, optimization of `batch_send`, `create_escrow`, and `open_stream`.
- **Out of scope:** algorithmic rewrites, changing Soroban SDK version, modifying the public API surface.

## Detailed Implementation Requirements

1. **Create profiling harness:** Create `contracts/finchippay-contract/tests/gas_profile.rs` that uses `soroban_sdk::Env` with `budget()` metering. For each profiled function, test at min, typical, and max input sizes (e.g., `batch_send` with 1, 25, and 50 recipients).
2. **Metrics capture:** For each call, record CPU instructions, ledger reads, ledger writes, and read/write bytes. Print a formatted table to stdout.
3. **CI integration:** Add a CI step in `.github/workflows/ci.yml` that runs `cargo test --test gas_profile -- --nocapture` and stores the output as a CI artifact (`gas-report.json`).
4. **Optimise `batch_send`:** Batch the TTL bumps and tip-total updates at the end of the loop rather than inside each iteration. Change the inner loop to collect all storage keys that need bumping and bump them once.
5. **Optimise `create_escrow`:** The function currently writes to `DataKey::EscrowCount`, `DataKey::EscrowRecipient(id)`, `DataKey::Escrow(id)`, and `DataKey::EscrowByRecipient(to)`. Investigate combining `EscrowRecipient` and `Escrow` into a single struct to halve the write operations.
6. **Optimise `open_stream`:** The `require_transfer_succeeded` helper reads the recipient balance twice (before and after). Investigate replacing the double-read pattern with a single balance read plus a `safe_transfer` that trusts the token client, guarded only by the locked-balance tracking.
7. **Regression guard:** Add a `compare_gas` utility that fails CI if a PR introduces a >5% gas increase on any function without explicit acknowledgement.

## Expected Architecture

```
contracts/finchippay-contract/
├── src/lib.rs              (optimizations — no public API changes)
└── tests/
    └── gas_profile.rs       (NEW: profiling harness)
```

## Acceptance Criteria
- [ ] `cargo test --test gas_profile` produces a gas report for all 20+ value-transferring functions.
- [ ] Gas report is generated as a CI artifact in `.github/workflows/ci.yml`.
- [ ] At least 3 functions show measurable gas improvement (≥10%) without changing behaviour.
- [ ] All existing unit tests (`cargo test`) continue to pass.
- [ ] `batch_send` with 50 recipients consumes ≤20% more gas than 50 individual `send_tip` calls.
- [ ] A `compare_gas` CI check is implemented to catch regressions.
