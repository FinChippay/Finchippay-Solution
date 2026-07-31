# Issue #2 — Property-Based Fuzz Testing for Streaming Payment Arithmetic

**Labels:** `contract` `testing` `security` `soroban`

## Summary
Extend the existing deterministic property test framework in the contract with a proper `proptest` harness that generates millions of random input combinations for the streaming payment maths.

## Background
The contract contains a `PropertyRng` struct in `contracts/finchippay-contract/src/lib.rs` (the `#[cfg(test)] mod tests` block) and a `stream_for_property` helper. However, it only runs 10,000 iterations with a simple LCG. The streaming payment formula (`elapsed × rate`, capped at deposited, minus claimed) is safety-critical — an overflow or underflow could drain funds.

## Problem Statement
The streaming payment arithmetic (`claimable_at()` and `_claimable` functions) must be formally verified against edge cases including overflow, zero-rate streams, near-max deposits, and ledger sequence wrap-around scenarios. The current 10,000-iteration test is insufficient for production confidence.

## Objectives
1. Replace the ad-hoc `PropertyRng` with the `proptest` crate.
2. Write property tests that assert invariants for `claimable_at`, `claim_stream`, `close_stream`, and `top_up_stream`.
3. Test at least 100,000 random combinations per function.
4. Document the invariants being tested.

## Scope
- **In scope:** property tests for streaming payment lifecycle, CI integration, documentation.
- **Out of scope:** property tests for escrow, multi-sig, or tips (future issues).

## Detailed Implementation Requirements

1. **Add dependency:** Add `proptest` to `contracts/finchippay-contract/Cargo.toml` as a `[dev-dependency]` with features `"default"`.
2. **Create test file:** Create `contracts/finchippay-contract/tests/property_streaming.rs` with the following invariants:
   - **Invariant 1 (Bounds):** `claimable_at(stream, L) ≤ deposited - claimed` for any ledger `L ≥ start_ledger`. The claimable amount must never exceed the remaining deposit.
   - **Invariant 2 (Balance):** After `claim_stream`, the recipient's token balance increases by exactly the claimed amount, and `stream.claimed` increments by that amount.
   - **Invariant 3 (Refund):** After `close_stream`, `refund = deposited - total_claimed`. The payer receives exactly that refund, and the stream is marked closed.
   - **Invariant 4 (Max claim):** For any stream with `rate > 0` and `deposited > 0`, after advancing the ledger by `deposited / rate + 1`, `claimable_at = deposited - claimed` (the entire deposit is claimable).
   - **Invariant 5 (Idempotency):** `claimable_at` is idempotent — calling it twice without advancing the ledger lens returns the same value.
   - **Invariant 6 (Zero rate):** A stream with `rate = 0` should always return `claimable = 0` regardless of elapsed ledgers.
   - **Invariant 7 (Top-up):** After `top_up_stream`, `deposited` increases by the top-up amount, and `claimable_at` does not decrease.
3. **Strategy design:** Use `proptest::strategy::Strategy` to generate rate, deposit, start_ledger, and advance amounts within the bounds defined by `MAX_STREAM_DEPOSIT` and `MAX_STREAM_RATE`. Generate edge cases explicitly (zero, one, MAX, MAX-1).
4. **CI integration:** Ensure the test runs as part of `cargo test` and completes in under 30 seconds in CI. Use `#[cfg_attr(not(feature = "slow-tests"), ignore)]` pattern to allow skipping during regular development.
5. **Documentation:** Add doc comments to each invariant explaining the mathematical property being tested and the security implication of violation.

## Expected Architecture

```
contracts/finchippay-contract/
├── Cargo.toml              (+ proptest dev-dependency)
└── tests/
    └── property_streaming.rs  (NEW)
```

## Acceptance Criteria
- [ ] `cargo test --test property_streaming` passes with ≥100,000 cases per invariant.
- [ ] All 7 invariants are documented with clear doc comments explaining the security rationale.
- [ ] Test run time <30 s in CI (use `cargo test --release --test property_streaming`).
- [ ] Existing contract tests continue to pass.
- [ ] At least one edge case (zero-rate, max-deposit, rapid ledger advance) is covered as a concrete deterministic test alongside the fuzz harness.
