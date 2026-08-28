# Circuit-Breaker (Pause) Completeness Audit

**Issue:** [#623 — Circuit-Breaker (Pause) Completeness Audit Across All Entrypoints](https://github.com/FinChippay/Finchippay-Solution/issues/623)

This document is the authoritative audit matrix for the emergency pause
(`pause` / `unpause` / `require_not_paused`) across **every** entry point of
`contracts/finchippay-contract`.

## Semantics

- **Mutating** — the entry point writes persistent storage.
- **Value-transferring** — the entry point can move tokens (in or out of the
  contract) via `token.transfer` / `require_transfer_succeeded` /
  `contract_transfer_out`.
- **Pause-guarded** — the entry point calls `require_not_paused` before any
  funds move. The guard panics with `Contract is paused` (the "equivalent
  panic" for `ContractError::ContractPaused`).
- **View** — a read-only entry point that never writes storage. Views must
  remain callable while paused.

**Invariant (the whole point of the audit):** *While the contract is paused,
no value-transferring entry point can move funds.* Read-only views keep working.

The integration suite `contracts/finchippay-contract/tests/pause_completeness.rs`
asserts this matrix programmatically: every value-transferring entry point is
blocked while paused, and every view still works.

## Entry-point matrix

`✅` = guarded / value-transferring / mutating. `—` = not applicable.

| # | Entry point | Module | Mutating | Value-transferring | Pause-guarded | Notes |
|---|-------------|--------|:--------:|:------------------:|:-------------:|------|
| 1 | `initialize` | lib.rs | ✅ | — | — | One-time init; contract cannot be paused before init |
| 2 | `transfer_admin` | lib.rs | ✅ | — | — | Governance; no token movement |
| 3 | `get_admin` | lib.rs | — | — | — | View |
| 4 | `get_admin_signers` | lib.rs | — | — | — | View |
| 5 | `get_admin_signers_threshold` | lib.rs | — | — | — | View |
| 6 | `is_paused` | lib.rs | — | — | — | View |
| 7 | `pause` | lib.rs | ✅ | — | — | Emergency brake; must work while paused |
| 8 | `unpause` | lib.rs | ✅ | — | — | Must work while paused |
| 9 | `propose_admin_action` | lib.rs | ✅ | ⚠️¹ | — | Must stay open so `unpause` can be proposed; no dispatched action moves funds (see ¹) |
| 10 | `approve_admin_action` | lib.rs | ✅ | ⚠️¹ | — | Same as above |
| 11 | `get_admin_action_proposal` | lib.rs | — | — | — | View |
| 12 | `get_pauser` | lib.rs | — | — | — | View |
| 13 | `get_version` | lib.rs | — | — | — | View |
| 14 | `get_storage_layout_version` | lib.rs | — | — | — | View |
| 15 | `validate_storage_compatibility` | lib.rs | — | — | — | View |
| 16 | `upgrade` | lib.rs | ✅ | — | — | Governance; no token movement |
| 17 | `bump_all_ttls` | lib.rs | ✅ | — | — | Admin TTL maintenance; no token movement |
| 18 | `get_min_ttl` | lib.rs | — | — | — | View |
| 19 | `estimate_send_tip` | lib.rs | — | — | — | Pure |
| 20 | `estimate_create_escrow` | lib.rs | — | — | — | Pure |
| 21 | `estimate_open_stream` | lib.rs | — | — | — | Pure |
| 22 | `estimate_batch_send` | lib.rs | — | — | — | Pure |
| 23 | `estimate_create_multisig` | lib.rs | — | — | — | Pure |
| 24 | ~~`rescue_tokens`~~ | lib.rs | — | — | — | **Removed** — legacy single-admin rescue deleted (#678); use `initiate_emergency_withdrawal` → `approve_emergency_withdrawal` → `execute_emergency_withdrawal` |
| 25 | `initiate_emergency_withdrawal` | lib.rs | ✅ | ⚠️² | ✅ | Guarded |
| 26 | `approve_emergency_withdrawal` | lib.rs | ✅ | ✅ | ✅ | Guarded; auto-executes transfer |
| 27 | `execute_emergency_withdrawal` | lib.rs | ✅ | ✅ | ✅ | Guarded |
| 28 | `cancel_emergency_withdrawal` | lib.rs | ✅ | — | ✅ | Guarded (no transfer) |
| 29 | `get_emergency_withdrawal` | lib.rs | — | — | — | View |
| 30 | `get_emergency_withdrawal_count` | lib.rs | — | — | — | View |
| 31 | `check_invariants` | lib.rs | — | — | — | Admin read-only check |
| 32 | `send_tip` | lib.rs | ✅ | ✅ | ✅ | Guarded |
| 33 | `get_tip_total` | lib.rs | — | — | — | View |
| 34 | `tip_total` | lib.rs | — | — | — | View |
| 35 | `get_tip_count` | lib.rs | — | — | — | View |
| 36 | `tip_count` | lib.rs | — | — | — | View |
| 37 | `get_tip_record` | lib.rs | — | — | — | View |
| 38 | `mint_receipt` | lib.rs | ✅ | — | ✅ | Guarded (metadata only; no transfer) |
| 39 | `get_receipt_count` | lib.rs | — | — | — | View |
| 40 | `get_receipt` | lib.rs | — | — | — | View |
| 41 | `total_receipt_count` | lib.rs | — | — | — | View |
| 42 | `get_receipt_by_index` | lib.rs | — | — | — | View |
| 43 | `generate_receipt_proof` | lib.rs | — | — | — | View |
| 44 | `verify_receipt` | lib.rs | — | — | — | View |
| 45 | `create_escrow` | escrow.rs | ✅ | ✅ | ✅ | Guarded |
| 46 | `claim_escrow_partial` | escrow.rs | ✅ | ✅ | ✅ | Guarded |
| 47 | `get_user_escrows` | escrow.rs | — | — | — | View |
| 48 | `claim_escrow` | escrow.rs | ✅ | ✅ | ✅ | Guarded |
| 49 | `cancel_escrow` | escrow.rs | ✅ | ✅ | ✅ | Guarded |
| 50 | `get_escrow` | escrow.rs | — | — | — | View |
| 51 | `get_escrow_count` | escrow.rs | — | — | — | View |
| 52 | `escrow_count` | escrow.rs | — | — | — | View |
| 53 | `add_arbitrator` | escrow.rs | ✅ | — | — | Admin governance; no token movement |
| 54 | `remove_arbitrator` | escrow.rs | ✅ | — | — | Admin governance; no token movement |
| 55 | `create_disputable_escrow` | escrow.rs | ✅ | ✅ | ✅ | Guarded |
| 56 | `raise_dispute` | escrow.rs | ✅ | — | — | Flags state only; moves no funds |
| 57 | `resolve_dispute` | escrow.rs | ✅ | ✅ | ✅ | **Fixed** — arbitrator resolution was moving funds while paused |
| 58 | `get_arbitrators` | escrow.rs | — | — | — | View |
| 59 | `open_stream` | streams.rs | ✅ | ✅ | ✅ | Guarded |
| 60 | `claim_stream` | streams.rs | ✅ | ✅ | ✅ | Guarded |
| 61 | `top_up_stream` | streams.rs | ✅ | ✅ | ✅ | Guarded |
| 62 | `close_stream` | streams.rs | ✅ | ✅ | ✅ | Guarded |
| 63 | `reject_stream` | streams.rs | ✅ | ✅ | ✅ | Guarded |
| 64 | `transfer_stream` | streams.rs | ✅ | ✅ | ✅ | Guarded |
| 65 | `get_stream` | streams.rs | — | — | — | View |
| 66 | `get_claimable` | streams.rs | — | — | — | View |
| 67 | `get_stream_count` | streams.rs | — | — | — | View |
| 68 | `stream_count` | streams.rs | — | — | — | View |
| 69 | `list_streams_by_payer` | streams.rs | — | — | — | View |
| 70 | `list_escrows_by_recipient` | streams.rs | — | — | — | View |
| 71 | `create_multisig` | multi_sig.rs | ✅ | ✅ | ✅ | Guarded |
| 72 | `approve_multisig` | multi_sig.rs | ✅ | ✅ | ✅ | Guarded |
| 73 | `timeout_multisig` | multi_sig.rs | ✅ | ✅ | ✅ | Guarded |
| 74 | `cancel_multisig` | multi_sig.rs | ✅ | ✅ | ✅ | Guarded |
| 75 | `get_multisig` | multi_sig.rs | — | — | — | View |
| 76 | `get_multisig_count` | multi_sig.rs | — | — | — | View |
| 77 | `multisig_count` | multi_sig.rs | — | — | — | View |
| 78 | `get_contract_stats` | multi_sig.rs | — | — | — | View |
| 79 | `batch_send` | batch_send.rs | ✅ | ✅ | ✅ | Guarded |
| 80 | `batch_send_multi` | batch_send.rs | ✅ | ✅ | ✅ | Guarded |
| 81 | `estimate_batch_swap_totals` | batch_send.rs | — | — | — | Pure |
| 82 | `create_vesting` | batch_send.rs | ✅ | ✅ | ✅ | Guarded |
| 83 | `claim_vesting` | batch_send.rs | ✅ | ✅ | ✅ | Guarded |
| 84 | `revoke_vesting` | batch_send.rs | ✅ | ✅ | ✅ | Guarded |
| 85 | `get_vesting` | batch_send.rs | — | — | — | View |
| 86 | `get_claimable_vesting` | batch_send.rs | — | — | — | View |
| 87 | `set_fee_collector` | lib.rs | ✅ | — | — | Admin governance; no token movement |
| 88 | `get_fee_collector` | lib.rs | — | — | — | View |
| 89 | `set_swap_fee` | lib.rs | ✅ | — | — | Admin governance; no token movement |
| 90 | `get_swap_fee` | lib.rs | — | — | — | View |
| 91 | `swap_exact_tokens_for_tokens` | lib.rs | ✅ | ✅ | ✅ | Guarded |
| 92 | `swap_tokens_for_exact_tokens` | lib.rs | ✅ | ✅ | ✅ | Guarded |

¹ `propose_admin_action` / `approve_admin_action` are the multi-sig governance
path. They **must** remain callable while paused so the `unpause` action can be
proposed and approved. No dispatched admin action moves funds (the legacy
`rescue_tokens` branch was removed in #678); funds rescue now goes exclusively
through the time-delayed, pause-guarded `initiate_emergency_withdrawal` →
`approve_emergency_withdrawal` → `execute_emergency_withdrawal` flow.

² `initiate_emergency_withdrawal` only records parameters (no transfer), but it
is guarded anyway, consistent with the existing design that no funds move while
paused — even via the emergency path.

## Internal module functions (not exposed as entry points)

The following `pub fn` live in modules that are **not** wired into the
`#[contractimpl]` (no client bindings exist yet), but they are value-transferring
and are guarded for defense-in-depth so they are safe the moment they are
exposed.

| Function | Module | Value-transferring | Pause-guarded |
|----------|--------|:------------------:|:-------------:|
| `create_airdrop` | airdrop.rs | ✅ | ✅ **Fixed** |
| `claim_airdrop` | airdrop.rs | ✅ | ✅ **Fixed** |
| `cancel_airdrop` | airdrop.rs | ✅ | ✅ **Fixed** |
| `create_yield_escrow` | yield_escrow.rs | ✅ | ✅ **Fixed** |
| `claim_yield_escrow` | yield_escrow.rs | ✅ | ✅ **Fixed** |
| `cancel_yield_escrow` | yield_escrow.rs | ✅ | ✅ **Fixed** |
| `verify_merkle_proof` | airdrop.rs | — | — (pure) |
| `get_yield_escrow` | yield_escrow.rs | — | — (view) |

## What this change fixed

Eight fund-moving code paths were missing the pause guard:

1. `rescue_tokens` (legacy admin rescue) — lib.rs
2. `execute_admin_action` → `rescue_tokens` branch (admin multi-sig rescue) — lib.rs
3. `resolve_dispute` (arbitrator resolution pays out funds) — escrow.rs
4. `create_airdrop` — airdrop.rs
5. `claim_airdrop` — airdrop.rs
6. `cancel_airdrop` — airdrop.rs
7. `create_yield_escrow` — yield_escrow.rs
8. `claim_yield_escrow` — yield_escrow.rs
9. `cancel_yield_escrow` — yield_escrow.rs

> **Update (#678):** items 1 and 2 above (`rescue_tokens` and the
> `execute_admin_action` → `rescue_tokens` branch) have since been **removed
> entirely**. Funds rescue now goes exclusively through the time-delayed,
> multi-sig-gated `initiate_emergency_withdrawal` → `approve_emergency_withdrawal`
> → `execute_emergency_withdrawal` flow, which is pause-guarded.

No pause **semantics** were changed (the pauser/legacy-admin distinction is
untouched); only coverage gaps were closed. All new guards reuse the existing
`require_not_paused` helper, so the panic string `Contract is paused` and
`ContractError::ContractPaused` remain the single source of truth.
