# Fixed Issues Report

This document summarizes the implementation of three issues resolved in this branch.

---

## Issue #338 — Contract Invariant Monitoring with On-Chain Assertions

**Labels:** `contract`, `security`, `monitoring`, `soroban`

### Changes Made

**File modified:** `contracts/finchippay-contract/src/lib.rs`

#### 1. Added `assert_invariants(env, domain: Symbol)` helper function

This internal helper verifies critical on-chain invariants after every state-modifying operation. It panics with a descriptive message on violation, preventing invalid state transitions.

**Invariants checked:**

| Category | Invariant |
|----------|-----------|
| **Tips** | For each creator, `sum(TipRecord.amount)` for all indices equals `TipTotal(creator)` |
| **Escrows** | `EscrowCount` matches actual stored escrow count. All escrows have `recipient != Address::zero()` |
| **Streams** | `StreamCount` matches stored streams. For each active stream, `claimed <= deposited`. `rate > 0` implies `start_ledger > 0` |
| **Multi-sig** | `MultiSigCount` matches stored proposals. For executed proposals, all signers are unique. |
| **Global** | `locked_balance` per token <= token balance of contract |

#### 2. Added `check_invariants(env, domain: Symbol) -> Symbol` public view function

An admin-callable view function that returns `Symbol::new("ok")` or the first violation description. Non-admin users are not authorized to call it.

#### 3. Integrated into state-modifying functions

`assert_invariants(env, Symbol::new("all"))` is called at the end of these functions:
- `send_tip`
- `mint_receipt`
- `create_escrow`, `claim_escrow_partial`, `claim_escrow`, `cancel_escrow`
- `open_stream`, `claim_stream`, `top_up_stream`, `close_stream`, `reject_stream`
- `propose_multisig` → `create_multisig`, `approve_multisig`, `cancel_multisig`
- `batch_send`, `batch_send_multi`
- `initiate_emergency_withdrawal`, `approve_emergency_withdrawal`, `execute_emergency_withdrawal`, `cancel_emergency_withdrawal`

#### 4. Added tests

Three new tests validate the invariant system:
- `test_check_invariants_returns_ok_for_valid_state` — verifies clean state reports "ok"
- `test_assert_invariants_detects_corrupted_tip_total` — verifies that a corrupted TipTotal triggers a panic
- `test_assert_invariants_detects_corrupted_escrow_count` — verifies that a corrupted EscrowCount triggers a panic

---

## Issue #353 — Request Body Size Limits and Streaming Upload Support

**Labels:** `backend`, `security`, `performance`, `upload`

### Changes Made

#### 1. Updated `backend/src/middleware/bodyParsing.js`

- Added `BODY_LIMIT_JSON` env var (default `1mb`) and `BODY_LIMIT_URLENCODED` env var (default `100kb`)
- Exported a new `bodyParsing` function that applies `express.json()` and `express.urlencoded()` with configurable limits

#### 2. Updated `backend/src/server.js`

- Improved the 413 error handler to return `{ error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the X limit.' }`
- Added `express.urlencoded({ extended: true, limit: ... })` from env config
- JSON body size limits now configurable via `BODY_LIMIT_JSON` env var (default: `1mb`)

#### 3. Created `backend/src/middleware/csvUpload.js` (NEW)

- Uses `multer` for streaming file uploads
- Configurable file size limit via `CSV_UPLOAD_MAX_SIZE` env var (default: 10MB)
- Stores file in memory buffer for processing with papaparse

#### 4. Updated `backend/src/config/validateEnv.js`

- Added validation for `BODY_LIMIT_JSON`, `BODY_LIMIT_URLENCODED`, and `CSV_UPLOAD_MAX_SIZE` env vars

#### 5. Updated `frontend/components/CSVUpload.tsx`

- Added upload progress indicator bar
- Shows estimated time remaining during large uploads
- Improved drag-and-drop zone with visual feedback
- Files sent with proper `Content-Type: multipart/form-data`

#### 6. Updated `backend/__tests__/bodyLimits.test.js`

- Added tests for URL-encoded body size limits
- Added test for streaming CSV upload processing
- Added test verifying normal-sized requests still succeed

---

## Issue #376 — Drag-and-Drop Payment Builder Interface

**Labels:** `frontend`, `ux`, `payments`, `drag-and-drop`, `feature`

### Changes Made

#### 1. Created `frontend/components/PaymentBuilder.tsx` (NEW)

- Full drag-and-drop recipient list using `framer-motion` for animations
- Drag handles on each recipient row for reordering
- Each row: address input, token selector, amount input, remove button
- "Add Recipient" button with staggered animation
- Undo/redo support via `useReducer` history stack
- Keyboard shortcuts: `Ctrl+Z` / `Ctrl+Shift+Z` for undo/redo
- Keyboard accessibility: `Space` to pick up, arrow keys to move, `Space` to drop
- Screen reader announcements for reorder operations

#### 2. Created `frontend/components/QuickAddPanel.tsx` (NEW)

- Shows available tokens with their balances
- Drag a token to a recipient row to set the asset type
- Drag preset amounts ("10 XLM", "100 USDC") to set the amount
- Visual feedback on drag (scale, opacity changes)
- Draggable cards with grab cursor

#### 3. Created `frontend/components/BatchSummary.tsx` (NEW)

- Shows total amounts grouped by token
- Visual bar chart of token allocation
- Shows recipient count vs max
- Estimated total fee display
- Animated counters using framer-motion

#### 4. Updated `frontend/components/BatchPaymentForm.tsx`

- Added "Builder" mode toggle button alongside the existing form view
- Integrated the `PaymentBuilder`, `QuickAddPanel`, and `BatchSummary` components
- Builder mode uses the same processing logic as the form mode
- Users can switch between form and builder views

### Dependencies Added

The following were already installed:
- `framer-motion` — animations and drag-and-drop
- `@heroicons/react` — icons

---

## CI Validation

- **Contract:** `cargo test` and `cargo build --release --target wasm32v1-none` pass
- **Backend:** `npm test` passes (backend tests including body limits)
- **Frontend:** Type-check, lint, and build pass
