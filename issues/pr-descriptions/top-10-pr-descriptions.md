# Top 10 PR Descriptions for GrantFox OSS Issues

> Each PR description is designed for contributors submitting their implementation of a GrantFox issue. Copy the relevant section into the PR body when opening a pull request.

---

## #9 — Migrate In-Memory Storage to SQLite/PostgreSQL (P0, Grant: 5)

### PR Title
`feat(backend): migrate in-memory storage to SQLite with PostgreSQL support`

### Description
Closes #N (Issue #9 — Migrate In-Memory Storage to SQLite)

### Summary
Replaced all in-memory `Map`-based data stores across the backend with a Knex-powered database abstraction layer supporting both SQLite (dev/test) and PostgreSQL (production).

### Changes
- **New:** `backend/src/db/connection.js` — Knex instance configured from `DATABASE_URL` env var
- **New:** `backend/src/db/migrations/` — migration files for tips, usernames, webhooks, turrets_deployments, turrets_history, analytics_cache
- **New:** `DB_PROVIDER` env var (`sqlite` default, `postgres` for production) in `backend/src/config/validateEnv.js`
- **Refactored:** `backend/src/services/tipsService.js` — Map.set/get → Knex queries
- **Refactored:** `backend/src/services/usernameService.js` — Map → usernames table
- **Refactored:** `backend/src/services/webhookService.js` — array → webhooks table
- **Refactored:** `backend/src/services/turretsService.js` — Map → turrets_deployments + turrets_history tables
- **Refactored:** `backend/src/services/analyticsService.js` — in-memory cache preserved, underlying data persisted
- **New:** `npm run migrate` script to run migrations
- **New:** Integration test `backend/__tests__/integration-db-persistence.test.js` verifying data survives restart

### Testing
- [x] All existing API tests pass (`npm test` in backend)
- [x] New integration test verifies data persistence after server restart
- [x] Tested with `DB_PROVIDER=sqlite` (default)
- [x] Tested with `DB_PROVIDER=postgres` against a local PostgreSQL instance
- [x] Backward compatible — all API response shapes unchanged

### Screenshots / Evidence
- (Attach screenshot of `npm run migrate` output showing all tables created)
- (Attach screenshot of API response before/after restart showing same data)

### Checklist
- [ ] `npm run migrate` creates all tables without errors
- [ ] Data persists across `npm run dev` restarts
- [ ] `DB_PROVIDER=postgres` works with a valid connection string
- [ ] No breaking changes to API responses
- [ ] All new code has test coverage

---

## #47 — Error Standardisation with Error Codes (P0, Grant: 5)

### PR Title
`feat: standardize error responses with unified error codes across backend and frontend`

### Description
Closes #N (Issue #47 — Error Standardisation with Error Codes)

### Summary
Introduced a canonical error code registry (`shared/errorCodes.js`) used by both the backend API and frontend, replacing inconsistent ad-hoc error messages with structured, machine-readable error responses.

### Changes
- **New:** `shared/errorCodes.js` — canonical error code registry with codes, HTTP statuses, and messages organized by domain (AUTH_*, VAL_*, RES_*, RATE_*, CONTRACT_*, SRV_*)
- **New:** `backend/src/middleware/errorHandler.js` — global Express error handler that formats all errors as `{ error: { code, message, details? } }`
- **Refactored:** All `backend/src/controllers/*.js` — throw/return standardized error codes instead of raw strings
- **Refactored:** `backend/src/middleware/auth.js` — returns `AUTH_EXPIRED_TOKEN` / `AUTH_INVALID_TOKEN` / `AUTH_MISSING_TOKEN`
- **Refactored:** `backend/src/middleware/rateLimit.js` — returns `RATE_LIMITED_GLOBAL` / `RATE_LIMITED_USER`
- **New:** `frontend/lib/errorHandler.ts` — `parseApiError()` and `getContractErrorMessage()` helpers
- **New:** `frontend/components/ErrorDisplay.tsx` — consistent error component with retry support
- **Updated:** `docs/api.md` — error codes reference section added
- **New:** Unit tests verifying each error code maps correctly

### Testing
- [x] All existing tests pass with updated error response format
- [x] New tests cover error code generation for all 30+ error codes
- [x] Frontend `ErrorDisplay` tested with each error code variant
- [x] Contract error codes (1–17) mapped to user-friendly messages

### Screenshots / Evidence
- (Attach screenshot of a 401 response showing `{ error: { code: "AUTH_EXPIRED_TOKEN", ... } }`)
- (Attach screenshot of ErrorDisplay component rendering a contract error)

### Checklist
- [ ] All API errors follow `{ error: { code, message, details? } }` shape
- [ ] Frontend `ErrorDisplay` renders consistent errors for all codes
- [ ] No raw error strings exposed to users
- [ ] Error codes documented in `docs/api.md`

---

## #21 — Soroban RPC Client Abstraction Layer (P0, Grant: 5)

### PR Title
`feat(frontend): create unified Soroban RPC client with typed contract methods`

### Description
Closes #N (Issue #21 — Soroban RPC Client Abstraction Layer)

### Summary
Created `frontend/lib/soroban.ts` — a typed, singleton Soroban RPC client that wraps all `FinchippayContract` entry-points with consistent error handling, automatic retry, and ABI versioning. All existing components refactored to use the new client.

### Changes
- **New:** `frontend/lib/soroban.ts` — `FinchippayClient` class with typed methods for all 20+ contract functions
- **New:** Contract error code → human-readable message mapping (all 17 `ContractError` variants)
- **New:** Exponential backoff retry for RPC failures (3 retries: 1s, 5s, 25s)
- **New:** Lazy singleton `getClient()` reading `NEXT_PUBLIC_CONTRACT_ID` and `NEXT_PUBLIC_SOROBAN_RPC_URL`
- **Refactored:** `frontend/components/StreamingPayments.tsx` — uses `FinchippayClient` instead of inline Soroban calls
- **Refactored:** `frontend/pages/escrow.tsx` — all escrow operations through the client
- **Refactored:** `frontend/pages/multi-sig-sign.tsx` — multi-sig approvals through the client
- **New:** `frontend/__tests__/sorobanClient.test.ts` — mock-based tests for all client methods
- **New:** `frontend/__tests__/sorobanClient.test.ts` — mock-based tests for all client methods

### Testing
- [x] Unit tests cover all 20+ client methods with mocked Soroban RPC
- [x] Contract error mapping tested for all 17 error codes
- [x] Retry logic tested with simulated network failures
- [x] All existing component tests pass after refactor

### Checklist
- [ ] All contract interactions go through `FinchippayClient`
- [ ] Contract errors display user-friendly messages
- [ ] RPC failures retry with exponential backoff
- [ ] Components no longer contain inline Soroban RPC calls

---

## #3 — Contract Event Indexer Service (P0, Grant: 5)

### PR Title
`feat(backend): add Soroban event indexer with PostgreSQL storage and API endpoints`

### Description
Closes #N (Issue #3 — Contract Event Indexer Service)

### Summary
Built a polling-based Soroban event indexer that captures all `FinchippayContract` events, stores them in PostgreSQL, and exposes queryable API endpoints for the frontend dashboard.

### Changes
- **New:** `backend/src/services/eventIndexer.js` — polls Soroban RPC every 30s with cursor-based pagination
- **New:** `backend/migrations/001_contract_events.sql` — events table with JSONB payload and GIN index
- **New:** `backend/src/routes/events.js` — `GET /api/events/:publicKey` and `GET /api/events/:publicKey/stats`
- **New:** `backend/src/controllers/eventController.js` — event querying and aggregation logic
- **Updated:** `backend/src/server.js` — registers event routes and starts indexer on boot
- **Updated:** `frontend/pages/dashboard.tsx` — displays contract event count alongside Horizon payments
- **New:** `backend/__tests__/integration-eventIndexer.test.js` — verifies polling loop and cursor resume

### Testing
- [x] Integration test verifies indexer inserts events from testnet Soroban RPC
- [x] Cursor resumes from last processed ledger after restart
- [x] `GET /api/events/:pk` returns events filtered by participant address
- [x] `GET /api/events/:pk/stats` returns correct aggregate counts
- [x] Indexer handles Soroban RPC timeouts with exponential backoff

### Checklist
- [ ] Indexer starts automatically with the backend server
- [ ] Events visible on dashboard for contract-interacting users
- [ ] No duplicate events on restart
- [ ] Graceful handling of Soroban RPC unavailability

---

## #10 — Refresh Token Rotation for SEP-0010 Sessions (P0, Grant: 5)

### PR Title
`feat(backend,auth): implement refresh token rotation with reuse detection for SEP-0010`

### Description
Closes #N (Issue #10 — Refresh Token Rotation for SEP-0010 Sessions)

### Summary
Replaced the single long-lived JWT model with short-lived access tokens (15 min) and rotating refresh tokens (7 days). Implemented automatic reuse detection that invalidates the entire token family if a stolen refresh token is detected.

### Changes
- **New:** `backend/src/services/tokenService.js` — `issueTokens()`, `rotateRefreshToken()`, `revokeTokenFamily()`
- **New:** `POST /api/auth/refresh` — accepts refresh token, returns new pair (rotates old token)
- **New:** `POST /api/auth/logout` — revokes the entire token family
- **New:** `backend/migrations/NNN_refresh_tokens.sql` — `refresh_tokens` table with family tracking
- **Updated:** `backend/src/middleware/auth.js` — access tokens expire in 15 min; returns `TOKEN_EXPIRED` code
- **Updated:** `frontend/lib/auth.ts` — stores both tokens; auto-refreshes on 401 with request queuing
- **Updated:** `frontend/lib/wallet.ts` — `performSEP0010Auth()` stores both tokens; `disconnectWallet()` calls logout
- **New:** Reuse detection — if a consumed refresh token is presented, the entire family is invalidated
- **Updated:** `backend/__tests__/accountsAuth.test.js` — covers refresh, expiry, reuse detection, and logout

### Testing
- [x] Access tokens expire and return 401 with `TOKEN_EXPIRED` code
- [x] Valid refresh tokens return new access + refresh pair
- [x] Replayed refresh tokens invalidate the family (subsequent refresh returns 401)
- [x] Logout revokes all tokens
- [x] Frontend auto-refreshes on 401 and queues parallel requests

### Checklist
- [ ] Access token TTL is 15 minutes (configurable via `ACCESS_TOKEN_TTL_MINUTES`)
- [ ] Refresh token TTL is 7 days (configurable via `REFRESH_TOKEN_TTL_DAYS`)
- [ ] Reuse detection invalidates token family
- [ ] No breaking changes to existing SEP-0010 challenge/verify flow

---

## #23 — Accessibility (a11y) Audit & Remediation (P1, Grant: 5)

### PR Title
`fix(frontend,a11y): comprehensive accessibility remediation achieving WCAG 2.1 AA compliance`

### Description
Closes #N (Issue #23 — Accessibility Audit & Remediation)

### Summary
Conducted a full accessibility audit of all pages and components, remediated all WCAG 2.1 AA violations, and added automated a11y testing to the CI pipeline using `jest-axe`.

### Changes
- **New:** `frontend/__tests__/a11y.test.tsx` — renders every page and runs `axe()` with 0 violation threshold
- **Updated:** All modal components — added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trapping, Esc-to-close
- **Updated:** All form inputs — associated `<label>` elements with `htmlFor` attributes
- **Updated:** All icon-only buttons — added `aria-label` attributes
- **Updated:** `frontend/components/MultiSigFlow.tsx` — step indicator uses `aria-current="step"`, keyboard navigation between steps
- **Updated:** `frontend/components/Navbar.tsx` — skip-to-content link as first focusable element
- **Updated:** Status badges — added icons alongside color indicators (not color-alone)
- **Updated:** `frontend/styles/globals.css` — visible focus rings on all interactive elements
- **Updated:** `frontend/components/Toast.tsx` — `aria-live="polite"` for dynamic announcements
- **New:** `ACCESSIBILITY.md` — documented accessibility features and testing process

### Testing
- [x] All 12 pages pass `jest-axe` with 0 violations
- [x] Manual keyboard navigation tested on all pages (Tab, Enter, Space, Esc)
- [x] Screen reader (VoiceOver/NVDA) tested on critical flows: send payment, escrow, multi-sig
- [x] Focus trap verified in all modal dialogs
- [x] Skip-to-content link functional on all pages
- [x] Color contrast ratios verified with axe DevTools (all ≥ 4.5:1)

### Screenshots / Evidence
- (Attach axe DevTools report showing 0 violations)
- (Attach screenshot of visible focus ring on a button)
- (Attach screenshot of skip-to-content link)

### Checklist
- [ ] 0 `jest-axe` violations across all pages
- [ ] All interactive elements keyboard accessible
- [ ] All form inputs have associated labels
- [ ] Modals trap focus and close on Esc
- [ ] Focus indicators visible on all interactive elements

---

## #24 — Offline Transaction Queue with Background Sync (P1, Grant: 5)

### PR Title
`feat(frontend,pwa): implement offline transaction queue with Background Sync API`

### Description
Closes #N (Issue #24 — Offline Transaction Queue with Background Sync)

### Summary
Added an offline transaction queue using IndexedDB that stores user-signed transactions when the network is unavailable and submits them automatically when connectivity returns, using the Background Sync API for submissions even when the tab is closed.

### Changes
- **New:** `frontend/lib/offlineQueue.ts` — queue management with IndexedDB persistence via `idb`
- **New:** Queue status types: `queued` → `submitting` → `submitted` | `failed`
- **Updated:** `frontend/public/sw.js` — `sync` event handler for `"submit-payments"` tag
- **Updated:** `frontend/lib/wallet.ts` — auto-queues signed XDRs when `navigator.onLine === false`
- **Updated:** `frontend/lib/stellar.ts` — `submitTransaction()` queues on network failure
- **Updated:** `frontend/components/OfflineBanner.tsx` — shows queue count, "Retry All" button, per-item status
- **Updated:** `frontend/components/Navbar.tsx` — queue badge showing pending count
- **New:** Online/offline event listeners that trigger `processQueue()` on connectivity restore
- **New:** `frontend/__tests__/offlineQueue.test.ts` — mocked IndexedDB and Background Sync tests
- **New:** `frontend/stories/OfflineBanner.stories.tsx` — with queue items story variant

### Testing
- [x] Unit tests verify queue, persistence, and auto-submit behavior
- [x] Manual testing: disconnect network → send payment → reconnect → payment submitted
- [x] Background Sync triggers submission even with the tab closed
- [x] Failed submissions are retried on the next connectivity event
- [x] Queue badge reflects accurate pending count

### Checklist
- [ ] Offline transactions stored in IndexedDB with status "queued"
- [ ] Auto-submission on connectivity restore (both tab-open and background sync)
- [ ] Queue badge in Navbar shows pending count
- [ ] OfflineBanner shows retry controls
- [ ] Failed transactions display error with retry option

---

## #29 — Transaction Simulation Before Signing (P1, Grant: 5)

### PR Title
`feat(frontend,soroban): add transaction simulation preview before signing contract interactions`

### Description
Closes #N (Issue #29 — Transaction Simulation Before Signing)

### Summary
Added a transaction simulation step using Soroban RPC's `simulateTransaction` that previews balance changes, resource fees, and potential errors before the user signs any contract interaction.

### Changes
- **New:** `simulateTransaction(xdr)` method in `frontend/lib/soroban.ts` returning typed `SimulationResult`
- **New:** `frontend/components/TransactionPreview.tsx` — modal displaying simulation results
  - Balance changes section with before/after green-red coloring
  - Resource fee section in XLM
  - Error section with human-readable messages from `ContractError` codes
  - "Looks good — sign transaction" and "Cancel" buttons
- **Updated:** `frontend/pages/escrow.tsx` — preview before `create_escrow`, `claim_escrow`, `cancel_escrow`
- **Updated:** `frontend/components/StreamingPayments.tsx` — preview before `claim_stream`, `close_stream`
- **Updated:** `frontend/components/MultiSigFlow.tsx` — preview before `approve_multisig`
- **New:** Loading skeleton while simulation is in progress
- **New:** Graceful degradation — if simulation fails, warning shown but signing still allowed
- **New:** `frontend/__tests__/TransactionPreview.test.tsx`
- **New:** `frontend/stories/TransactionPreview.stories.tsx`

### Testing
- [x] Simulation preview shows correct balance changes for escrow operations
- [x] Contract errors surfaced before signing (tested: claiming before release ledger)
- [x] Resource fees displayed accurately
- [x] Simulation failure gracefully degrades with warning
- [x] Integration with all contract interaction flows verified

### Checklist
- [ ] Preview modal appears before every Soroban transaction signing
- [ ] Balance changes displayed with before/after amounts
- [ ] Errors surfaced before user commits to signing
- [ ] Graceful fallback when simulation is unavailable
- [ ] All contract interaction flows updated

---

## #32 — Push Notification Webhooks via Web Push API (P1, Grant: 5)

### PR Title
`feat: implement browser push notifications for payments, schedules, and multi-sig`

### Description
Closes #N (Issue #32 — Push Notification Webhooks via Web Push API)

### Summary
Completed the Push API implementation with VAPID key management, subscription handling, and server-side push delivery for payment received, scheduled payment due, and multi-sig approval needed events.

### Changes
- **New:** `backend/src/services/pushService.js` — `sendPushNotification()`, `notifyPaymentReceived()`, `notifyScheduledDue()`, `notifyMultiSigNeeded()`
- **New:** `backend/src/routes/push.js` — `POST /api/push/subscribe`, `DELETE /api/push/unsubscribe`
- **New:** `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env vars in `backend/src/config/validateEnv.js`
- **Updated:** `frontend/public/sw.js` — `push` handler with `showNotification()` and `notificationclick` handler with page navigation
- **New:** `frontend/lib/notifications.ts` — `requestNotificationPermission()`, `subscribeToPush()`, `saveSubscription()`
- **Updated:** `frontend/pages/settings.tsx` — notification preferences section with toggles per event type
- **Wired:** Payment received → webhook → push notification
- **Wired:** Scheduled payment due → cron → push notification
- **Wired:** Multi-sig approval needed → proposal creation → push notification to signers

### Testing
- [x] Push notification received when payment arrives (tested with web-push testing tools)
- [x] Scheduled payment reminder fires at the correct time
- [x] Multi-sig approval request notification navigates to signing page on click
- [x] Settings toggles correctly enable/disable notification types
- [x] Notifications work with browser in background

### Checklist
- [ ] VAPID keys generated and stored securely (not hardcoded)
- [ ] Push subscription flow works end-to-end
- [ ] Payment received → notification within 5 seconds
- [ ] Notification click navigates to correct page
- [ ] Unsubscribe removes subscription from backend

---

## #30 — Ledger Hardware Wallet Support (P1, Grant: 5)

### PR Title
`feat(frontend,wallet): implement Ledger hardware wallet support via WebUSB`

### Description
Closes #N (Issue #30 — Ledger Hardware Wallet Support)

### Summary
Implemented Ledger Nano S/X hardware wallet support using `@ledgerhq/hw-transport-webusb` and `@ledgerhq/hw-app-str`, replacing the existing placeholder functions with fully functional Ledger integration for transaction signing and SEP-0010 auth.

### Changes
- **Implemented:** `frontend/lib/wallet.ts` — `connectLedger()`, `signTransactionWithLedger()`, `getLedgerPublicKey()`
- **New:** `frontend/components/WalletSelector.tsx` — modal with Freighter and Ledger options
- **Updated:** `frontend/components/WalletConnect.tsx` — shows wallet selector on connect
- **Updated:** `frontend/lib/useWallet.tsx` — tracks wallet type (`"freighter" | "ledger"`)
- **Updated:** `frontend/lib/wallet.ts` — `signTransactionWithWallet()` dispatches to active wallet type
- **New:** Ledger-specific error handling: device not connected, Stellar app not open, user rejected, device locked
- **New:** Step-by-step instructions in wallet selector for Ledger users
- **New:** `frontend/__tests__/wallet-ledger.test.ts` — mocked Ledger transport tests
- **Updated:** SEP-0010 auth flow works with Ledger signing

### Testing
- [x] Unit tests with mocked Ledger transport cover connection, signing, error handling
- [x] Manual testing with Ledger Nano S on Stellar testnet:
  - [x] Connect and retrieve public key
  - [x] Sign payment transaction
  - [x] Sign SEP-0010 challenge
  - [x] Sign Soroban contract invocation
- [x] Error messages displayed for: device not connected, app not open, user rejection, device locked

### Checklist
- [ ] Wallet selector offers Freighter and Ledger options
- [ ] Ledger connects via WebUSB on Chrome/Edge/Brave
- [ ] Transaction signing works for payments, escrow, streaming, multi-sig
- [ ] SEP-0010 auth works with Ledger
- [ ] Clear error messages for all common failure modes
- [ ] Switching wallets does not lose account data

---

## Contributing a PR

1. Pick an issue from the [GrantFox OSS Issues](https://github.com/FinChippay/Finchippay-Solution/issues?q=label%3A%22GrantFox+OSS%22)
2. Comment on the issue to signal your intent to work on it
3. Fork the repo and create a branch: `feature/issue-N-short-description`
4. Implement the changes following the issue's Detailed Implementation Requirements
5. Use the relevant PR description template above (add/remove sections as needed)
6. Ensure all tests pass: `npm test` (frontend + backend) and `cargo test` (contract)
7. Open a PR referencing the issue number
