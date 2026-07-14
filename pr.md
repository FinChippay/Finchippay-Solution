# PR: Multi-issue improvements — E2E tests, ESLint, Horizon reliability, payment confirmation

## Summary

- closes #223 — E2E tests for wallet connect flow (Playwright)
- closes #228 — ESLint `no-console` rule for frontend
- closes #235 — Timeout + retry logic for `stellarService.js` Horizon calls
- closes #238 — Confirmation dialog improvements before sending payment

---

## Changes

### `frontend/e2e/wallet-connect.spec.ts` (new file) — closes #223

Added a dedicated Playwright spec that covers the three acceptance criteria:

1. **No extension** — unauthenticated dashboard shows "Connect your wallet to get started" and the "Connect Freighter Wallet" button; same check on `/transactions`.
2. **After mock connect** — clicking the button with the fixture-injected Freighter stub results in the wallet address label and XLM balance being visible on the dashboard.
3. **Transactions page post-connect** — navigating to `/transactions` after connecting renders the transaction list view (not the wallet-gate screen).

Uses the existing `fixtures.ts` for the authenticated scenarios (mocked Freighter, Horizon, and backend auth endpoints).

---

### `frontend/.eslintrc.json` — closes #228

Added the `no-console` rule at `warn` level, allowing `console.warn` and `console.error` to pass through:

```json
"no-console": ["warn", { "allow": ["warn", "error"] }]
```

This surfaces direct `console.log` calls during `next lint` / CI so developers are reminded to use the project's logging abstraction, without breaking any existing `console.warn` / `console.error` calls.

---

### `backend/src/services/stellarService.js` — closes #235

Introduced a `withTimeoutAndRetry(fn, timeoutMs)` helper that:

- Races each Horizon call against a **10-second `AbortController` timer**.
- **Retries up to 3 times** on transient errors (`5xx`, `ECONNRESET`, `ETIMEDOUT`, `AbortError`) using **exponential back-off** (100 ms × 2ⁿ).
- Does **not** retry `404` responses (account not found is definitive).

Applied to all three Horizon call sites:
- `server.loadAccount(publicKey)` inside `getAccount`
- `query.call()` inside `getPayments`
- `op.transaction()` (memo fetch) inside `getPayments`

---

### `frontend/components/SendPaymentForm.tsx` — closes #238

Updated `SendConfirmationModal` to fully satisfy the acceptance criteria:

- **Destination** now shows both the **shortened form** (`GABCD…WXYZ`) and the **full address** in monospace below it — users can spot accidental paste errors at a glance.
- Renamed the primary CTA from `Confirm & Send` → **`Confirm & Sign`** to match the acceptance criteria and reflect that Freighter signing occurs on confirmation.
- Added `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` for accessibility.

---

## Test plan

- [ ] Run `npm run test:e2e` in `frontend/` — `wallet-connect.spec.ts` passes in Chromium.
- [ ] Run `npm run lint` in `frontend/` — `no-console` warnings appear for any `console.log` calls.
- [ ] Restart the backend and send a payment with a slow/unreachable Horizon URL — the server returns a timeout error after ~10 s instead of hanging indefinitely.
- [ ] On the dashboard, fill in a destination and amount, click **Send** — the confirmation modal shows shortened + full address, fee, optional memo, and a **Confirm & Sign** button. Clicking Cancel returns to the form.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
