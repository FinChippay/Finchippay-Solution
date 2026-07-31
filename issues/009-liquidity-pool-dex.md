# Issue #9 — Liquidity Pool Integration via Stellar DEX

**Labels:** `contract` `feature` `soroban` `dex`

## Summary
Add on-chain swap and liquidity pool management to FinchippayContract, enabling users to trade tokens directly through the Stellar DEX via Soroban contract calls.

## Background
The frontend already has a `TradeForm` component (`frontend/components/TradeForm.tsx`) that uses Stellar path payments via Horizon. The `pathFinder.ts` library discovers swap routes. However, there's no on-chain contract integration — swaps happen through Horizon path payments, not through the contract.

## Problem Statement
Users want to swap tokens within the Finchippay ecosystem without leaving the app. The current TradeForm works but doesn't leverage the contract for liquidity management, fee collection, or aggregated routing.

## Objectives
1. Add `swap_exact_tokens_for_tokens` and `swap_tokens_for_exact_tokens` functions to the contract.
2. Implement fee collection (e.g., 0.3% fee to contract admin).
3. Integrate with the existing TradeForm through contract bindings.
4. Write tests for swap logic.

## Scope
- **In scope:** on-chain swap functions, fee mechanism, contract integration with TradeForm.
- **Out of scope:** AMM pool creation, liquidity provider incentives.

## Detailed Implementation Requirements

1. **Implement `swap_exact_tokens_for_tokens(env, caller, token_in, token_out, amount_in, min_amount_out, path)`:**
   - Validate: amount_in > 0, min_amount_out ≥ 0, path has 2+ addresses.
   - Compute fee (30 bp = 30/10000): `fee = amount_in * 30 / 10000; amount_to_swap = amount_in - fee`.
   - Transfer fee to admin's designated fee collector address.
   - Transfer `amount_to_swap` of token_in from caller to contract.
   - For each hop in path, execute token transfer from previous output to next input.
   - Verify output amount ≥ min_amount_out.
   - Transfer output tokens back to caller.
   - Emit `("swap", caller, token_in, token_out, amount_in, amount_out, fee)`.

2. **Implement `swap_tokens_for_exact_tokens(env, caller, token_in, token_out, amount_out, max_amount_in, path)`:**
   - Compute required input including fees.
   - Validate max_amount_in constraint.
   - Execute the swap to get exact output amount.

3. **Fee collector:** Add `DataKey::FeeCollector` and `set_fee_collector(env, admin, collector)` admin function. Default fee is 30 basis points, adjustable by admin via `set_swap_fee(env, admin, new_fee_bps)` with bounds [0, 1000].

4. **Contract bindings:** Update `scripts/gen-contract-bindings.sh` to generate TypeScript bindings for the new swap functions.

5. **Frontend integration:** Create a `useContractSwap` hook that uses the new contract functions as an alternative to the Horizon path payment in `TradeForm.tsx`. Add a toggle between "Horizon Swap" and "Contract Swap".

6. **Tests:** Swap XLM→USDC, USDC→XLM, insufficient amount (should fail), fee calculation, admin fee update, 5-hop path.

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  + swap_exact_tokens_for_tokens(), swap_tokens_for_exact_tokens()
  + set_fee_collector(), set_swap_fee()
  + DataKey::FeeCollector, DataKey::SwapFee
  + get_swap_fee(), get_fee_collector()
  + 6+ new tests

frontend/
  + hooks/useContractSwap.ts (NEW)
  ~ components/TradeForm.tsx (add contract swap path)
  ~ lib/contract-bindings/ (regenerated)
```

## Acceptance Criteria
- [ ] `cargo test` passes with ≥6 new swap tests.
- [ ] Swap functions correctly transfer tokens and collect fees.
- [ ] Slippage protection (`min_amount_out`) enforced.
- [ ] Fee collector receives protocol fees.
- [ ] Admin can update fee percentage within bounds.
- [ ] TradeForm has a working toggle between Horizon and contract swap.
- [ ] All existing tests pass.
