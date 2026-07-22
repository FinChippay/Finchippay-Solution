# Architecture — Finchippay-Solution

## Overview

Finchippay-Solution is a three-tier Web3 application built on the Stellar network.

```
┌────────────────────────────────────────────────────────────────────┐
│                            User's Browser                          │
│                                                                    │
│   ┌──────────────────────────┐    ┌──────────────────────────┐    │
│   │   Next.js Frontend       │    │   Freighter Extension    │    │
│   │   (React + Tailwind CSS) │◄──►│   (Stellar Wallet)       │    │
│   └──────────┬───────────────┘    └──────────────────────────┘    │
└──────────────┼─────────────────────────────────────────────────────┘
               │ HTTP/REST
               ▼
┌──────────────────────────────────┐
│   Node.js Backend API            │
│   (Express + Pino + Swagger)     │
│                                  │
│  /api/accounts   /api/payments   │
│  /api/analytics  /api/tips       │
│  /api/auth       /api/webhooks   │
│  /federation     /api/turrets    │
└─────────────┬────────────────────┘
              │ Stellar SDK
              ▼
┌─────────────────────────────────────┐    ┌──────────────────────────┐
│   Stellar Horizon API               │    │   Soroban RPC            │
│   (horizon-testnet.stellar.org)     │    │   (rpc-testnet.stellar..) │
└─────────────────────────────────────┘    └────────────┬─────────────┘
              │                                         │
              ▼                                         ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Stellar Blockchain                           │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │   FinchippayContract (Soroban WASM)                       │    │
│   │   Tips · Receipts · Escrow · Streams · Multi-sig · Batch │    │
│   └──────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

## Layer Details

### Smart Contract (`contracts/finchippay-contract/`)

A Rust/Soroban contract compiled to WASM. All state is stored in Stellar's persistent
ledger storage with TTL bumps on every read/write.

Key design decisions:
- **Auth first**: every mutating function calls `require_auth()` before touching state.
- **Checked arithmetic**: all additions, subtractions, and multiplications use `checked_*` methods.
- **Event emission**: every state change emits a structured Soroban event for off-chain indexers.
- **Storage TTL**: persistent entries are bumped to 500,000 ledgers (~1 year) to prevent expiry.
- **Emergency pause**: admin can call `pause()` to freeze all value-transferring operations (circuit breaker). Read-only queries remain accessible during pause.
- **Upgradability**: admin can call `upgrade(new_wasm_hash)` to deploy security patches without state migration. Version counter is incremented on each upgrade.
- **Bounded inputs**: escrow timelocks, stream deposits/rates, and multi-sig amounts are capped to prevent griefing, overflow, and permanent fund lock-up.

#### Event Catalogue

Every state-changing entry point emits a structured Soroban event so off-chain
indexers can reconstruct contract history without replaying every ledger from
genesis or reading storage directly. Topics follow the pattern
`(Symbol::new(&env, "event_name"), ..filter_fields)`; the event's `data` tuple
carries the remaining fields needed to reconstruct state.

| Event | Topics | Data | Emitted by |
|---|---|---|---|
| `init` | `(init,)` | `admin` | `initialize` |
| `admin_transfer` | `(admin_transfer,)` | `new_admin` | `transfer_admin` |
| `paused` | `(paused,)` | `()` | `pause` |
| `unpaused` | `(unpaused,)` | `()` | `unpause` |
| `pauser_set` | `(pauser_set,)` | `pauser` | `set_pauser` |
| `upgraded` | `(upgraded,)` | `(new_version, new_wasm_hash)` | `upgrade` |
| `rescue_tokens` | `(rescue_tokens,)` | `(token_address, amount, to)` | `rescue_tokens` |
| `tip` | `(tip, from, to)` | `amount` | `send_tip` |
| `receipt` | `(receipt, from)` | `index` | `mint_receipt` |
| `escrow_create` | `(escrow_create, id)` | `(from, to, amount, release_ledger)` | `create_escrow` |
| `escrow_claim_partial` | `(escrow_claim_partial, id)` | `(to, claim_amount, remaining)` | `claim_escrow_partial` |
| `escrow_claim` | `(escrow_claim, id)` | `(to, amount)` | `claim_escrow` |
| `escrow_cancelled` | `(escrow_cancelled,)` | `(id, from, amount)` | `cancel_escrow` |
| `stream_open` | `(stream_open, id)` | `(payer, recipient, rate_per_ledger, deposit)` | `open_stream` |
| `stream_claim` | `(stream_claim, id)` | `(recipient, claimable)` | `claim_stream` |
| `stream_topped_up` | `(stream_topped_up,)` | `(id, payer, added, new_deposit)` | `top_up_stream` |
| `stream_close` | `(stream_close, id)` | `(payer, refund)` | `close_stream` |
| `stream_reject` | `(stream_reject, id)` | `(recipient, refund)` | `reject_stream` |
| `stream_transfer` | `(stream_transfer, id)` | `(current_recipient, new_recipient)` | `transfer_stream` |
| `multisig_create` | `(multisig_create, id)` | `(proposer, recipient, amount, threshold)` | `create_multisig` |
| `multisig_approve` | `(multisig_approve, id)` | `(signer, approvals_count, threshold)` | `approve_multisig` |
| `multisig_executed` | `(multisig_executed, id)` | `(recipient, amount)` | `approve_multisig` (auto-execute) |
| `multisig_timeout` | `(multisig_timeout, id)` | `(proposer, amount)` | `timeout_multisig` |
| `multisig_cancelled` | `(multisig_cancelled,)` | `(id, proposer, amount)` | `cancel_multisig` |
| `batch_sent` | `(batch_sent,)` | `(from, count, total_amount)` | `batch_send` |

### Backend (`backend/`)

An Express.js API that proxies Horizon data and adds auth, federation, analytics,
tips metadata, and webhook delivery.

Key components:
- `config/validateEnv.js` — validates all env vars at startup; exits with a clear error if any are missing.
- `services/stellarService.js` — LRU-cached Horizon requests with timeout + exponential-backoff retry.
- `middleware/auth.js` — SEP-0010 JWT verification.
- `middleware/rateLimit.js` — 100 req/15 min globally; 20 req/min on sensitive routes.
- `middleware/sanitization.js` — strips HTML/script injection from all user inputs.
- `utils/logger.js` — Pino structured JSON logger; Stellar secret keys are redacted before any output.
- `swagger.js` — OpenAPI 3.0 spec auto-generated from JSDoc annotations.

### Frontend (`frontend/`)

A Next.js 14 application. All Stellar operations are non-custodial — private keys
never leave the browser; they stay inside the Freighter extension.

Key components:
- `lib/wallet.ts` — Freighter API wrapper; signs XDR transaction envelopes.
- `lib/stellar.ts` — Stellar SDK helpers: build, submit, and parse transactions.
- `lib/stellarConfig.ts` — network config (testnet / mainnet) persisted in localStorage.
- `pages/dashboard.tsx` — main dashboard with balance, charts, quick send.
- `pages/transactions.tsx` — paginated transaction history with filters.
- `pages/escrow.tsx` — create / claim / cancel time-locked escrows.
- `components/MultiSigFlow.tsx` — multi-sig proposal creation and signing UI.
- `components/SendPaymentForm.tsx` — send XLM or any Stellar asset.
- `components/BatchPaymentForm.tsx` — fan-out payments to multiple recipients.

## Data Flow: Sending a Payment

```
1. User fills in SendPaymentForm (amount, destination, asset).
2. Frontend calls stellar.buildPaymentTx() to create an unsigned XDR envelope.
3. Freighter signs the XDR (private key never leaves the extension).
4. Frontend submits the signed envelope directly to Stellar Horizon.
5. Horizon returns the transaction hash.
6. Frontend polls /api/accounts/:key to refresh the balance display.
7. Backend (optional) delivers a webhook if the destination has registered one.
```

## Data Flow: Claiming a Stream

```
1. User opens the streaming payments page and selects a stream.
2. Frontend calls soroban RPC → FinchippayContract::get_claimable(stream_id).
3. If claimable > 0, frontend builds a Soroban invocation XDR.
4. Freighter signs the XDR.
5. Frontend submits to Soroban RPC.
6. Contract transfers claimable tokens to the recipient and updates stream.claimed.
```

## Security Properties

| Property | Implementation |
|---|---|
| Non-custodial | Private keys remain in Freighter; server never sees them |
| Input validation | Zod/manual validation in frontend; sanitization middleware in backend |
| Secret redaction | Regex replaces Stellar secret keys in all log lines and Sentry events |
| Rate limiting | express-rate-limit at 100 req/15 min globally |
| CORS | Allowlist-based; configured via ALLOWED_ORIGINS env var |
| CSP | Helmet enforces strict Content-Security-Policy on all API responses |
| Auth | SEP-0010 JWT — signed by Freighter, verified by backend middleware |
| Contract auth | Every mutating entry-point calls `require_auth()` |
| Emergency pause | Admin `pause()`/`unpause()` freezes value-transferring operations |
| Upgradability | Admin `upgrade()` replaces contract WASM; version tracked on-chain |
| Bounded inputs | Deposit caps, rate limits, timelock maximums prevent griefing |
| Top-up enforcement | Cumulative stream deposit checked against `MAX_STREAM_DEPOSIT` |
| Token balance verification | `require_transfer_succeeded()` checks recipient balance before & after every token transfer; panics with `TransferFailed` (error code 17) if the balance did not increase by at least the expected amount — guards against malicious/fake token contracts (phantom deposit attack) |
| Overflow safety | Checked arithmetic throughout the Soroban contract |
