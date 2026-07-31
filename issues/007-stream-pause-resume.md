# Issue #7 — Stream Pause/Resume Functionality

**Labels:** `contract` `feature` `soroban` `streaming`

## Summary
Add pause/resume functionality to the streaming payment system, allowing payers to temporarily halt a stream and resume it later without losing progress.

## Background
The current `Stream` struct (`lib.rs` lines ~220-245) has fields `id`, `payer`, `recipient`, `token`, `rate_per_ledger`, `deposited`, `claimed`, `start_ledger`, `closed`. There is no mechanism to pause a stream — the only options are `close_stream` (permanent with refund) or letting it run. The `Stream` struct has no `paused_at` field.

## Problem Statement
Payers need the ability to temporarily pause a stream (e.g., if a service provider is not delivering) without losing the accrued streamed amount or incurring the cost of closing and reopening.

## Objectives
1. Add `paused_at_ledger` and `total_paused_duration` fields to the `Stream` struct.
2. Implement `pause_stream(env, stream_id, payer)` and `resume_stream(env, stream_id, payer)`.
3. Update `claimable_at()` to account for paused periods.
4. Write comprehensive tests.

## Scope
- **In scope:** Stream pause/resume, updated claimable calculation, tests.
- **Out of scope:** automatic pause on insufficient balance, recipient-triggered pause.

## Detailed Implementation Requirements

1. **Extend `Stream` struct:** Add `paused_at_ledger: u32` (0 = not paused), `total_paused_duration: u32` (total ledgers spent in paused state since stream creation). Increment `STORAGE_LAYOUT_VERSION` since the struct layout changes.

2. **Implement `pause_stream(env, stream_id, payer)`:**
   - Call `payer.require_auth()`. Verify payer matches.
   - Validate stream exists, not closed, not already paused.
   - Set `paused_at_ledger = current_ledger`.
   - Emit `("stream_paused", stream_id, (payer, current_ledger))`.

3. **Implement `resume_stream(env, stream_id, payer)`:**
   - Call `payer.require_auth()`. Verify payer matches.
   - Validate stream exists, not closed, currently paused.
   - Compute `paused_duration = current_ledger - paused_at_ledger`.
   - Update `total_paused_duration += paused_duration`.
   - Set `paused_at_ledger = 0`.
   - Emit `("stream_resumed", stream_id, (payer, current_ledger, paused_duration))`.

4. **Update `claimable_at()`:** When stream is paused, `effective_ledger = paused_at_ledger - total_previous_paused_duration`. The elapsed calculation becomes `effective_elapsed = current_ledger - start_ledger - total_paused_duration - (paused ? (current_ledger - paused_at_ledger) : 0)`.

5. **Update `close_stream()`:** When closing a paused stream, set `paused_at_ledger = 0` first, then compute refund as usual.

6. **Add `is_stream_paused(env, stream_id) -> bool` view function.**

7. **Tests:**
   - Pause a stream, verify claimable stops increasing.
   - Resume a stream, verify claimable resumes from correct point.
   - Pause/resume multiple times, verify accumulated durations.
   - Close a paused stream, verify correct refund.
   - Non-payer cannot pause.
   - Cannot pause an already paused stream.
   - Cannot resume a non-paused stream.

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  ~ Stream struct: +paused_at_ledger, +total_paused_duration
  ~ claimable_at(): account for paused periods
  + pause_stream(), resume_stream(), is_stream_paused()
  ~ close_stream(): handle paused state before closing
  ~ STORAGE_LAYOUT_VERSION: increment to 2
  + 7+ new tests
```

## Acceptance Criteria
- [ ] `cargo test` passes with ≥7 new stream pause/resume tests.
- [ ] After pausing, `claimable_at` does not increase for any subsequent ledger.
- [ ] After resuming, `claimable_at` correctly accounts for the paused gap.
- [ ] Multiple pause/resume cycles accumulate correctly.
- [ ] `close_stream` works correctly on paused streams.
- [ ] Only the stream payer can pause/resume.
- [ ] `STORAGE_LAYOUT_VERSION` is incremented and `validate_storage_compatibility` works with the new layout.
