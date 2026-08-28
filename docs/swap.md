# Swap — Path Payment Interface

> **Issue #249** — Token swap interface with Stellar path payment support.

## Overview

The swap interface (`/trade`) lets users exchange tokens using Stellar's **path payment** operations. Instead of placing limit orders on the DEX, users specify the amount they want to pay and the token they want to receive. The UI automatically discovers the most efficient multi-hop route via Horizon, including any intermediate assets required to connect the two endpoints.

---

## Path Payment Support

### How it works

Stellar path payments route a payment through up to **6 intermediate assets** (hops). This allows swapping between any two assets as long as there exists a connected liquidity path on the Stellar DEX — even when no direct order book exists between them.

**Example route:**  
`XLM → yXLM → EURT → USDC` (3 hops)

### Horizon Endpoints Used

| Mode | Horizon Endpoint | Description |
|---|---|---|
| Strict-send | `GET /paths/strict-send` | Fix the send amount; maximise what is received |
| Strict-receive | `GET /paths/strict-receive` | Fix the receive amount; minimise what is sent |

The frontend calls **strict-send** by default: the user enters how much they want to pay and Horizon returns all viable paths ranked by the highest destination amount.

### Path Discovery (`frontend/lib/pathFinder.ts`)

```ts
import { findStrictSendPaths, findStrictReceivePaths } from "@/lib/pathFinder";

// Strict-send: given exactly 100 XLM to spend, find best USDC received
const result = await findStrictSendPaths(
  Asset.native(),     // source asset
  "100",              // exact source amount
  usdcAsset,          // destination asset
  publicKey           // optional — improves trustline accuracy
);

console.log(result.bestPath);     // best PaymentPath
console.log(result.routeDisplay); // "XLM → yXLM → USDC"
console.log(result.destinationAmount); // estimated USDC received
```

```ts
// Strict-receive: given exactly 50 USDC to receive, find cheapest XLM path
const result = await findStrictReceivePaths(
  Asset.native(),     // source asset
  usdcAsset,          // destination asset
  "50",               // exact destination amount
  publicKey
);

console.log(result.sourceAmount); // minimum XLM required
```

Results are sorted best-first (highest destination / lowest source amount).

---

## Slippage Configuration

Slippage tolerance controls the **minimum amount** the user is guaranteed to receive. If the on-chain execution price moves beyond the tolerance, the transaction is rejected by the Stellar protocol.

### Preset Options

| Button | Value |
|---|---|
| 0.5% | Tight — suitable for stable pairs |
| 1% | Moderate — recommended for most swaps |
| 3% | Loose — useful for illiquid pairs |

### Custom Slippage

Users can type any value between **0% and 50%** in the custom input. Values outside that range are rejected with an inline validation message before the swap button is enabled.

### How it affects the transaction

```ts
import { applySlippage } from "@/lib/pathFinder";

// Expected to receive: 12.34 USDC, slippage 1%
const minReceived = applySlippage("12.34", 1);
// → "12.2166000" (minimum that must be credited)
```

The `buildPathPaymentTransaction` call uses `minReceived` as `destAmount` (the `sendMax` / `destAmount` pair in `pathPaymentStrictReceive`). If the DEX can only fill at a worse rate the transaction fails safely on-chain.

---

## Route Visualization

The swap UI displays a visual route after each successful path lookup:

```
Route:  [XLM]  →  [yXLM]  →  [USDC]
```

Each asset code is shown in a pill badge. The route is updated in real time as the user changes the pay amount (with a 600 ms debounce to avoid flooding Horizon).

### Rendering the route

```ts
import { buildRouteDisplay } from "@/lib/pathFinder";

const label = buildRouteDisplay(bestPath, sourceAsset, destAsset);
// "XLM → yXLM → USDC"
```

---

## Confirmation Flow

Before any transaction is signed, a **confirmation modal** presents the full swap summary:

| Field | Description |
|---|---|
| Input asset & amount | Token being sold |
| Output asset & amount | Token being bought (estimated) |
| Route | Full hop-by-hop path |
| Exchange rate | 1 `payToken` ≈ N `receiveToken` |
| Slippage tolerance | User's selected tolerance |
| Minimum received | Floor on what will be credited (`destAmount`) |
| Price impact | Deviation from mid-market rate |
| Estimated network fee | Stellar base fee in XLM |

The user must explicitly click **Confirm Swap** to proceed. Clicking **Cancel** dismisses the modal without building or submitting any transaction.

No Freighter signing call is made until the user confirms.

---

## Price Impact

Price impact is the percentage deviation between the expected rate and the actual swap rate. A warning is shown when impact exceeds **3%**:

```
⚠ High price impact — 4.50% price impact detected.
  You may receive significantly less than expected.
```

The warning appears both in the main form and inside the confirmation modal.

### Calculation

```ts
import { calculatePriceImpact } from "@/lib/pathFinder";

const impact = calculatePriceImpact(
  "100",       // source amount sent
  "12.3",      // destination amount received
  0.13         // reference market rate (optional)
);
// Returns percentage, e.g. 2.5
```

---

## Public UI Behaviour

1. **Enter pay amount** — user types how much of `payToken` they want to spend.
2. **Path lookup** — after a 600 ms debounce, the UI queries Horizon strict-send. A spinner is shown while fetching.
3. **Route displayed** — the best path is rendered visually. The estimated receive amount is populated.
4. **Adjust slippage** — user picks a preset or types a custom tolerance.
5. **Review swap** — the "Review Swap" button becomes active once a valid path is found.
6. **Confirmation modal** — full breakdown is shown. No signing until the user confirms.
7. **Transaction submitted** — Freighter signs the `pathPaymentStrictReceive` operation; the signed XDR is submitted to Horizon.
8. **Success / failure** — a toast notification is shown and the form is reset on success.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/lib/pathFinder.ts` | **Created** — strict-send / strict-receive helpers, slippage, route display |
| `frontend/components/TradeForm.tsx` | **Redesigned** — full swap UI with all Issue #249 features |
| `frontend/__tests__/TradeForm.test.tsx` | **Replaced** — comprehensive test suite (7 path-payment tests) |
| `docs/swap.md` | **Created** — this document |

---

## On-Chain Contract Swap (Issue #9 / #479)

TradeForm also offers a **"Swap Via" toggle** — *Horizon Swap* (default, described above) vs. *Contract Swap*, which settles through `FinchippayContract` instead of a Horizon path payment.

### Contract functions

| Function | Purpose |
|---|---|
| `swap_exact_tokens_for_tokens(caller, token_in, token_out, amount_in, min_amount_out, path)` | Swap an exact input for at least `min_amount_out`, enforcing slippage protection |
| `swap_tokens_for_exact_tokens(caller, token_in, token_out, amount_out, max_amount_in, path)` | Swap up to `max_amount_in` for an exact output |
| `set_fee_collector(admin, collector)` / `get_fee_collector()` | Admin-configurable protocol fee recipient (defaults to admin) |
| `set_swap_fee(admin, new_fee_bps)` / `get_swap_fee()` | Admin-configurable protocol fee, 0–1000 bps (default 30 bps = 0.3%) |

A protocol fee (default 0.3%) is computed from the amount that actually reaches the contract. This matters for fee-on-transfer inputs: if a token burns or withholds part of the requested transfer, the swap output and protocol fee are based on the measured balance delta, not the caller's requested amount. The post-fee remainder is settled against the contract's token reserves.

### ⚠️ Pricing-model limitation

Soroban contracts have no host function to invoke the classic Stellar DEX's `path_payment_strict_send`/`strict_receive` operations, and building a full on-chain AMM was explicitly **out of scope** for issue #9/#479. As a result, `swap_exact_tokens_for_tokens` / `swap_tokens_for_exact_tokens` settle the post-fee amount **1:1** against the contract's own pre-funded `token_out` reserves — they do not (yet) source live prices from an AMM or DEX order book. `path` is validated for shape (must start with `token_in`, end with `token_out`, length ≥ 2) but intermediate hops are not separately transferred, since the contract holds no inventory of intermediate tokens.

Paths are also hardened before execution: malformed endpoints are rejected, repeated tokens are treated as stale, and every non-input hop must have contract-side reserves so dead routes cannot be used silently.

This makes the contract path a legitimate fee-collecting, slippage-protected settlement primitive today, but **not yet a priced router**. Real price discovery (via an AMM pool or a wrapped external router contract) is tracked as follow-up work; the Horizon path-payment flow remains the source of real market pricing until then, and the "Contract Swap" mode reuses the Horizon-derived preview for its quote while settling on-chain.

### Frontend integration

`frontend/hooks/useContractSwap.ts` builds, signs (via Freighter), and submits a `swap_exact_tokens_for_tokens` transaction using the contract bindings in `frontend/lib/contract-bindings/index.ts`. `TradeForm.tsx` exposes the toggle and calls this hook instead of `buildPathPaymentTransaction` when "Contract Swap" is selected.

| File | Change |
|---|---|
| `contracts/finchippay-contract/src/lib.rs` | **Hardened**: measured fee-on-transfer inputs, stale-path checks, swap events, and 19 hardening tests |
| `frontend/hooks/useContractSwap.ts` | **Created** — drives the on-chain swap transaction |
| `frontend/components/TradeForm.tsx` | **Updated** — Horizon/Contract swap toggle |
| `frontend/lib/contract-bindings/index.ts` | **Updated** — swap + fee-admin client methods |
| `scripts/gen-contract-bindings.sh` | **Updated** — documents the new swap methods in its example output |
