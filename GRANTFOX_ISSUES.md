# GrantFox — 50 Implementation-Ready GitHub Issues for Finchippay-Solution

> Generated from a thorough analysis of the existing codebase. Each issue references real files, modules, and services. Every issue targets 6–10 hours of engineering work and is detailed enough that an experienced contributor can complete it without clarification.

---

## CONTRACT / SOROBAN (Issues #1–#8)

---

### Issue #1 — Gas Profiling & Optimisation for FinchippayContract

**Labels:** `contract` `optimization` `soroban` `good first issue`

**Summary:** Profile every Soroban contract entry-point for CPU instruction cost and storage footprint, then apply targeted optimisations to reduce gas consumption by at least 15%.

**Background:** The `FinchippayContract` (`contracts/finchippay-contract/src/lib.rs`) currently has ~700 lines of Rust compiled to WASM. Functions like `batch_send` (which loops over recipients, updates tip totals, and bumps TTL on every iteration) and `create_escrow` (which writes to multiple storage slots and maintains a recipient index) are suspected gas hogs. There is no formal gas profiling in the CI pipeline today.

**Problem Statement:** High gas costs make the contract expensive for end users on Stellar mainnet. Without profiling, contributors cannot make informed decisions about where to focus optimisation effort.

**Objectives:**
1. Add a reproducible gas-profiling harness using Soroban's `cost` inspection APIs.
2. Benchmark all 20+ entry-points across typical, worst-case, and edge-case inputs.
3. Report per-function costs in a CI-friendly format (JSON or Markdown table).
4. Apply at least 3 concrete optimisations that measurably reduce gas.

**Scope:**
- **In scope:** gas profiling harness, CI integration, optimization of `batch_send`, `create_escrow`, and `open_stream`.
- **Out of scope:** algorithmic rewrites, changing Soroban SDK version, modifying the public API surface.

**Detailed Implementation Requirements:**
1. Create a new integration test file at `contracts/finchippay-contract/tests/gas_profile.rs` that uses `soroban_sdk::testutils::CostTracker` or the `costs` budget metering API.
2. For each profiled function, test at min, typical, and max input sizes (e.g., `batch_send` with 1, 25, and 50 recipients).
3. Generate a `gas-report.json` artifact during CI.
4. Optimise `batch_send` — consider batching the TTL bumps and tip-total updates at the end of the loop rather than inside each iteration.
5. Optimise `create_escrow` — reduce the number of storage writes by combining related data into fewer slots.
6. Optimise `open_stream` — the `require_transfer_succeeded` helper reads the recipient balance twice (before and after). Investigate if this duplicate read can be eliminated while maintaining the phantom deposit guard.

**Expected Architecture:**

```
contracts/finchippay-contract/
├── src/lib.rs              (no changes to public API)
└── tests/
    └── gas_profile.rs       (NEW: profiling harness)
```

**Acceptance Criteria:**
- [ ] `cargo test --test gas_profile` produces a gas report for all value-transferring functions.
- [ ] Gas report is generated as a CI artifact in `.github/workflows/ci.yml`.
- [ ] At least 3 functions show measurable gas improvement (≥10%) without changing behaviour.
- [ ] All existing unit tests (`cargo test`) continue to pass.
- [ ] `batch_send` with 50 recipients consumes ≤20% more gas than 50 individual `send_tip` calls.

---

### Issue #2 — Property-Based Fuzz Testing for Streaming Payment Arithmetic

**Labels:** `contract` `testing` `security` `soroban`

**Summary:** Extend the existing deterministic property test framework in the contract with a proper `proptest` harness that generates millions of random input combinations for the streaming payment maths.

**Background:** The contract already contains a `PropertyRng` struct in `contracts/finchippay-contract/src/lib.rs` (the `#[cfg(test)] mod tests` block) and a `stream_for_property` helper. However, it only runs 10,000 iterations with a simple LCG. The streaming payment formula (`elapsed × rate`, capped at deposited, minus claimed) is safety-critical — an overflow or underflow could drain funds.

**Problem Statement:** The streaming payment arithmetic (`_claimable` function) must be formally verified against edge cases including overflow, zero-rate streams, near-max deposits, and ledger sequence wrap-around scenarios. The current 10,000-iteration test is insufficient for production confidence.

**Objectives:**
1. Replace the ad-hoc `PropertyRng` with the `proptest` crate.
2. Write property tests that assert invariants for `_claimable`, `claim_stream`, `close_stream`, and `reject_stream`.
3. Test at least 100,000 random combinations per function.
4. Document the invariants being tested.

**Scope:**
- **In scope:** property tests for streaming payment lifecycle, CI integration, documentation.
- **Out of scope:** property tests for escrow, multi-sig, or tips (future issues).

**Detailed Implementation Requirements:**
1. Add `proptest` to `contracts/finchippay-contract/Cargo.toml` as a `[dev-dependency]`.
2. Create `contracts/finchippay-contract/tests/property_streaming.rs` with the following invariants:
   - **Invariant 1:** `claimable ≤ deposited - claimed` (never claim more than the remaining deposit).
   - **Invariant 2:** After `claim_stream`, the recipient's token balance increases by exactly the claimed amount.
   - **Invariant 3:** After `close_stream`, `refund = deposited - total_claimed`, and the payer receives exactly that refund.
   - **Invariant 4:** For any stream with `rate > 0` and `deposited > 0`, after advancing the ledger by `deposited / rate + 1`, `claimable = deposited - claimed`.
   - **Invariant 5:** `get_claimable` is idempotent — calling it twice without advancing the ledger returns the same value.
3. Use `proptest::strategy::Strategy` to generate rate, deposit, start-ledger, and advance amounts within the bounds defined by `MAX_STREAM_DEPOSIT` and `MAX_STREAM_RATE`.
4. Mark the property test as `#[test]` that runs as part of `cargo test`.
5. Ensure the test runs in under 30 seconds in CI.

**Expected Architecture:**

```
contracts/finchippay-contract/
├── Cargo.toml              (+ proptest dev-dependency)
└── tests/
    └── property_streaming.rs  (NEW)
```

**Acceptance Criteria:**
- [ ] `cargo test --test property_streaming` passes with ≥100,000 cases per invariant.
- [ ] All invariants documented with doc comments.
- [ ] Test run time <30 s in CI.
- [ ] Existing contract tests continue to pass.

---

### Issue #3 — Contract Event Indexer Service

**Labels:** `backend` `contract` `indexer` `new-service`

**Summary:** Build a standalone event indexer that listens to Soroban events emitted by `FinchippayContract` and stores them in a queryable PostgreSQL database.

**Background:** The contract emits structured Soroban events for every state change (`"tip"`, `"stream_open"`, `"escrow_create"`, `"multisig_executed"`, etc.) as seen in `contracts/finchippay-contract/src/lib.rs`. Currently, the backend only queries Horizon for basic payment history — it has no visibility into contract-level activity like streaming claims, escrow releases, or multi-sig approvals. The `/api/payments/:publicKey` endpoint in `backend/src/routes/payments.js` returns only Horizon payment operations.

**Problem Statement:** Users interacting with the Soroban contract have no way to view their streaming, escrow, or multi-sig activity in the dashboard because the backend does not index contract events.

**Objectives:**
1. Create a new backend service `backend/src/services/eventIndexer.js` that polls Soroban RPC for new events.
2. Define a PostgreSQL schema for storing indexed events.
3. Expose new API endpoints for querying contract events by user address.
4. Integrate with the dashboard to display contract activity alongside Horizon payments.

**Scope:**
- **In scope:** event indexer service, DB schema, API routes, basic dashboard integration.
- **Out of scope:** real-time WebSocket push, historical backfill beyond the most recent 7 days.

**Detailed Implementation Requirements:**
1. Add PostgreSQL client dependency (`pg` or `knex`) to `backend/package.json`.
2. Create migration: `backend/migrations/001_contract_events.sql` with schema:
   ```sql
   CREATE TABLE contract_events (
     id SERIAL PRIMARY KEY,
     event_type VARCHAR(64) NOT NULL,
     contract_id VARCHAR(64) NOT NULL,
     ledger_sequence INTEGER NOT NULL,
     emitted_at TIMESTAMPTZ NOT NULL,
     payload JSONB NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   CREATE INDEX idx_events_type_ledger ON contract_events(event_type, ledger_sequence);
   CREATE INDEX idx_events_payload ON contract_events USING GIN(payload);
   ```
3. Implement `eventIndexer.js`:
   - Poll Soroban RPC (configured via `SOROBAN_RPC_URL`) every 30 seconds.
   - Use cursor-based pagination (last seen ledger sequence) to avoid re-processing.
   - Parse event topics and data into the `payload` JSONB column.
   - Handle Soroban RPC timeouts with exponential backoff (same pattern as `stellarService.js`).
4. Add new routes in `backend/src/routes/events.js`:
   - `GET /api/events/:publicKey` — list events where the user is a participant (filter on `payload->>'from'` or `payload->>'to'` matching the public key).
   - `GET /api/events/:publicKey/stats` — aggregate counts by event type.
5. Add a new controller `backend/src/controllers/eventController.js`.
6. Expose the contract event count on the dashboard via the existing `frontend/pages/dashboard.tsx`.

**Expected Architecture:**

```
backend/
├── migrations/
│   └── 001_contract_events.sql    (NEW)
├── src/
│   ├── services/
│   │   └── eventIndexer.js        (NEW)
│   ├── routes/
│   │   └── events.js              (NEW)
│   ├── controllers/
│   │   └── eventController.js     (NEW)
│   └── server.js                  (register new routes + start indexer)
```

**Acceptance Criteria:**
- [ ] Indexer polls Soroban RPC and inserts events into PostgreSQL.
- [ ] `GET /api/events/:publicKey` returns events filtered by participant address.
- [ ] Dashboard shows a count of contract events.
- [ ] Indexer resumes from the last processed ledger after restart.
- [ ] Integration test in `backend/__tests__/integration-eventIndexer.test.js` verifies the polling loop.

---

### Issue #4 — Vesting Schedule Contract Extension

**Labels:** `contract` `feature` `soroban` `vesting`

**Summary:** Add a vesting schedule feature to `FinchippayContract` that allows organisations to create token vesting schedules with cliffs, unlockable linearly over time.

**Background:** The contract already has time-locked escrow (`create_escrow`, `claim_escrow`, `cancel_escrow`) and streaming payments. A vesting schedule is a natural extension: it combines a cliff (like escrow) with linear unlocking (like streaming). This is a highly requested feature for DAO treasury distributions and team token allocations.

**Problem Statement:** Organisations wanting to distribute tokens to team members or community contributors with a vesting schedule must use external tools or manual management. The contract should support this natively.

**Objectives:**
1. Design a `VestingSchedule` data type with fields: `beneficiary`, `total_amount`, `cliff_ledger`, `end_ledger`, `claimed`, `revoked`.
2. Implement `create_vesting`, `claim_vesting`, and `revoke_vesting` (admin-only) functions.
3. Add a `get_claimable_vesting(id)` read-only function.
4. Write comprehensive tests including cliff enforcement, linear unlock maths, and partial claims.

**Scope:**
- **In scope:** vesting schedule data type, create/claim/revoke functions, unit tests, event emission.
- **Out of scope:** batch vesting creation, transferable vesting positions.

**Detailed Implementation Requirements:**
1. Add `VestingSchedule` struct and `DataKey::Vesting(u32)` and `DataKey::VestingCount` in `contracts/finchippay-contract/src/lib.rs`.
2. Add bounds constants `MAX_VESTING_AMOUNT` and `MAX_VESTING_DURATION_LEDGERS`.
3. Implement `create_vesting(env, token, from, beneficiary, amount, cliff_ledger, end_ledger)`:
   - Validates: `cliff_ledger < end_ledger`, `amount > 0`, `amount ≤ MAX_VESTING_AMOUNT`.
   - Transfers total amount from `from` to contract.
   - Emits `"vesting_create"` event.
4. Implement `claim_vesting(env, id, beneficiary)`:
   - Returns 0 if `current_ledger < cliff_ledger`.
   - After cliff, claimable = `total * (current_ledger - cliff_ledger) / (end_ledger - cliff_ledger) - claimed`.
   - Transfers claimable amount to beneficiary.
   - Emits `"vesting_claim"` event.
5. Implement `revoke_vesting(env, id, admin)`:
   - Only the contract admin can revoke.
   - Returns unclaimed tokens to the original funder.
   - Emits `"vesting_revoke"` event.
6. Implement `get_vesting(env, id)` and `get_claimable_vesting(env, id)`.
7. Add tests in the existing test module for: full lifecycle, claim before cliff (should return 0), partial claim after cliff, full claim at end, revoke before cliff, revoke after partial claim.

**Expected Architecture:**

```
contracts/finchippay-contract/src/lib.rs
  + VestingSchedule struct
  + DataKey::Vesting(u32), DataKey::VestingCount
  + create_vesting(), claim_vesting(), revoke_vesting()
  + get_vesting(), get_claimable_vesting()
  + 6+ new tests
```

**Acceptance Criteria:**
- [ ] `cargo test` passes with ≥6 new vesting-specific tests.
- [ ] `cargo build --release --target wasm32-unknown-unknown` succeeds.
- [ ] `claim_vesting` before cliff returns 0 without error.
- [ ] After the end ledger, `get_claimable_vesting` returns the full remaining balance.
- [ ] `revoke_vesting` is only callable by the contract admin.
- [ ] All existing contract tests continue to pass.

---

### Issue #5 — Merkle-Tree Airdrop Contract Extension

**Labels:** `contract` `feature` `soroban` `airdrop`

**Summary:** Add a Merkle-tree-based airdrop mechanism to `FinchippayContract` enabling gas-efficient token distributions to thousands of recipients.

**Background:** The current `batch_send` function (`lib.rs` line ~590) is limited to 50 recipients per call and requires the sender to pay gas for every transfer inline. For large-scale airdrops, a Merkle-tree approach is far more efficient: the funder commits a single Merkle root, and each recipient claims their allocation by providing a Merkle proof. This reduces on-chain cost from O(n) to O(log n) per recipient.

**Problem Statement:** Projects wanting to airdrop tokens to thousands of Stellar addresses have no efficient on-chain mechanism in Finchippay.

**Objectives:**
1. Add `MerkleAirdrop` struct and Merkle proof verification logic.
2. Implement `create_airdrop(env, token, funder, merkle_root, total_amount)`.
3. Implement `claim_airdrop(env, airdrop_id, recipient, amount, proof)`.
4. Implement `cancel_airdrop(env, airdrop_id, funder)` for expired airdrops.

**Scope:**
- **In scope:** Merkle proof verification, airdrop create/claim/cancel, unit tests with known Merkle trees.
- **Out of scope:** off-chain Merkle tree generation tooling (future issue), NFT airdrops.

**Detailed Implementation Requirements:**
1. Define `MerkleAirdrop` struct with fields: `id`, `funder`, `token`, `merkle_root: BytesN<32>`, `total_amount`, `claimed_amount`, `expiration_ledger`, `cancelled`.
2. Add `DataKey::Airdrop(u32)`, `DataKey::AirdropCount`, `DataKey::AirdropClaimed(u32, Address)`.
3. Implement a pure `verify_merkle_proof(leaf: BytesN<32>, proof: Vec<BytesN<32>>, root: BytesN<32>, index: u32) -> bool` helper using iterative hashing with SHA-256.
4. Implement `create_airdrop(...)`: transfers total amount from funder to contract, stores the Merkle root, emits `"airdrop_create"`.
5. Implement `claim_airdrop(...)`: verifies Merkle proof for `hash(recipient, amount)`, checks not already claimed, transfers tokens, marks claimed, emits `"airdrop_claim"`.
6. Implement `cancel_airdrop(...)`: only callable by funder after expiration, refunds unclaimed amount.
7. Add tests: single-recipient, 3-recipient Merkle tree, invalid proof, double-claim rejection, cancel after expiration.

**Expected Architecture:**

```
contracts/finchippay-contract/src/lib.rs
  + MerkleAirdrop struct
  + verify_merkle_proof() helper
  + DataKey::Airdrop*, DataKey::AirdropClaimed
  + create_airdrop(), claim_airdrop(), cancel_airdrop()
  + 5+ new tests
```

**Acceptance Criteria:**
- [ ] `cargo test` passes with ≥5 new airdrop-specific tests.
- [ ] Merkle proof verification correctly rejects invalid proofs.
- [ ] Double-claim attempt panics with appropriate error.
- [ ] Cancelled airdrop refunds unclaimed tokens to the funder.
- [ ] Existing contract tests continue to pass.

---

### Issue #6 — Admin Multi-Sig for Contract Governance

**Labels:** `contract` `security` `governance` `soroban`

**Summary:** Upgrade the single-admin model in `FinchippayContract` to support N-of-M multi-signature governance for the `pause`, `unpause`, `upgrade`, `set_pauser`, and `rescue_tokens` admin functions.

**Background:** Currently, the contract has a single `Admin` address (`get_admin()` in `lib.rs` line ~130) and an optional `Pauser`. The `upgrade()` and `pause()` functions require only the single admin's signature. For production deployments, this is a centralisation risk — a single compromised key can pause the contract or deploy a malicious upgrade.

**Problem Statement:** Production deployments require multi-signature governance for admin operations to meet security best practices and pass third-party audits.

**Objectives:**
1. Add `AdminThreshold` and `AdminSigners` storage keys.
2. Modify `initialize` to accept `(admin_signers: Vec<Address>, threshold: u32)` instead of a single admin.
3. Modify all admin-gated functions to accept and verify M-of-N signatures.
4. Add `propose_admin_action` and `approve_admin_action` functions for async governance.
5. Keep backward compatibility for tests.

**Scope:**
- **In scope:** admin multi-sig for pause/unpause/upgrade/set_pauser/rescue_tokens, unit tests.
- **Out of scope:** on-chain voting for non-admin parameters, timelock delays (future issue).

**Detailed Implementation Requirements:**
1. Add `DataKey::AdminSigners`, `DataKey::AdminThreshold` to the `DataKey` enum.
2. Modify `initialize(env, admin_signers: Vec<Address>, threshold: u32)`:
   - Validates `threshold > 0 && threshold <= admin_signers.len()` and `admin_signers.len() <= 20`.
   - Stores signers and threshold.
   - Emits `"admin_init"` event.
3. Replace `require_auth()` checks in admin functions with a helper `require_admin_auth(env, action_hash)` that checks signatures against the stored signer set.
4. Implement a simplified approach: require that the caller is one of the admin signers AND that sufficient other signers have pre-approved the action. Use a two-step process:
   - `propose_admin_action(env, proposer, action_type: Symbol, action_data)` — stores the proposal and emits event.
   - `approve_admin_action(env, proposal_id, approver)` — adds approval; auto-executes at threshold.
5. Update `get_admin()` → `get_admin_signers()` (return the Vec).
6. Update all existing tests that reference a single admin to use the multi-sig pattern. Use `env.mock_all_auths()` for convenience in tests.

**Expected Architecture:**

```
contracts/finchippay-contract/src/lib.rs
  ~ initialize() signature change
  + propose_admin_action(), approve_admin_action()
  + AdminActionProposal struct
  + DataKey::AdminSigners, DataKey::AdminThreshold
  + require_admin_auth() helper
  ~ Updated tests for multi-sig admin
```

**Acceptance Criteria:**
- [ ] `initialize` accepts a signer list and threshold.
- [ ] Admin functions (`pause`, `unpause`, `upgrade`, `rescue_tokens`) require multi-sig approval.
- [ ] Proposals auto-execute when threshold is met.
- [ ] All existing tests updated and passing (`cargo test`).
- [ ] `cargo build --release --target wasm32-unknown-unknown` succeeds.

---

### Issue #7 — Contract Deployment & Verification Automation

**Labels:** `contract` `devops` `automation` `soroban`

**Summary:** Automate the build, deploy, and on-chain verification of `FinchippayContract` WASM to Stellar testnet/mainnet via GitHub Actions.

**Background:** The project has a manual deployment script at `scripts/deploy-contract.sh` but no automated CI/CD pipeline for contract deployment. The `contracts/finchippay-contract/src/lib.rs` contract emits a `CONTRACT_VERSION` constant (currently `3`) that should be used for version tracking.

**Problem Statement:** Manual deployment is error-prone and lacks auditability. Every release should produce a verifiable on-chain record of the deployed WASM hash and contract ID.

**Objectives:**
1. Create a GitHub Actions workflow that builds the contract WASM.
2. Compute the WASM hash and deploy to Stellar testnet on every push to `master`.
3. Output the contract ID and WASM hash as workflow artifacts and in a deployment comment on the PR.
4. Verify the on-chain WASM hash matches the build artifact.

**Scope:**
- **In scope:** CI deployment workflow for testnet, WASM hash verification, PR comments.
- **Out of scope:** mainnet deployment (requires manual approval gate — future issue).

**Detailed Implementation Requirements:**
1. Create `.github/workflows/contract-deploy.yml`:
   - Trigger: `push` to `master` and `workflow_dispatch` (manual trigger).
   - Steps: checkout → install Rust + wasm target → `cargo build --release --target wasm32-unknown-unknown` → compute SHA-256 of WASM → deploy via Stellar CLI (`stellar contract deploy`) → verify WASM hash on-chain → output contract ID.
2. Add a comment on the triggering PR/commit with: Contract ID, WASM hash, network, and link to Stellar Expert explorer.
3. Store the contract ID and WASM hash as GitHub Actions environment variables for downstream workflows.
4. Update `scripts/deploy-contract.sh` to use the same hash verification step.
5. Add a `Makefile` target `make deploy-contract-testnet` that wraps the Stellar CLI commands.

**Expected Architecture:**

```
.github/workflows/
└── contract-deploy.yml    (NEW)
scripts/
└── deploy-contract.sh     (updated with hash verification)
Makefile                   (new deploy target)
```

**Acceptance Criteria:**
- [ ] Push to `master` triggers automatic testnet deployment.
- [ ] Deployment output includes contract ID and WASM hash.
- [ ] On-chain WASM hash matches the build artifact (verified in CI).
- [ ] `make deploy-contract-testnet` works locally.
- [ ] Failed deployments fail the CI check with a descriptive error.

---

### Issue #8 — Contract State Export / Migration Tool

**Labels:** `contract` `tooling` `soroban` `data`

**Summary:** Build a CLI tool that exports all persistent storage state from a deployed `FinchippayContract` instance into a JSON file, suitable for audit, migration, or disaster recovery.

**Background:** The contract stores persistent data across many `DataKey` variants (tips, receipts, escrows, streams, multi-sig proposals, admin config). When upgrading the contract via `upgrade()` (`lib.rs` line ~250), the state is preserved but there is no tool to inspect or export it off-chain.

**Problem Statement:** Auditors, operators, and developers need a way to dump the entire contract state for inspection, migration planning, and disaster recovery. The Soroban RPC provides raw key-value access but no structured export.

**Objectives:**
1. Build a Node.js CLI script `scripts/export-contract-state.js` that connects to Soroban RPC.
2. Iterate all known `DataKey` patterns and fetch their values.
3. Output structured JSON with human-readable field names.
4. Support filtering by storage type (e.g., only escrows, only streams).
5. Include a summary section with counts.

**Scope:**
- **In scope:** CLI script, structured JSON export, filtering, summary counts.
- **Out of scope:** import/restore functionality, cross-contract migration.

**Detailed Implementation Requirements:**
1. Create `scripts/export-contract-state.js` using the `@stellar/stellar-sdk` Soroban client.
2. Accept CLI arguments: `--contract-id`, `--rpc-url`, `--output`, `--filter` (escrows|streams|multisigs|tips|admin|all).
3. For each `DataKey` variant:
   - Admin: fetch `Admin`, `Pauser`, `Paused`, `Version`.
   - Tips: iterate `TipCount(addr)` and fetch each `TipRecord(addr, index)`.
   - Escrows: iterate `EscrowCount` and fetch each `Escrow(id)` plus `EscrowByRecipient` indexes.
   - Streams: iterate `StreamCount` and fetch each `Stream(id)`.
   - Multi-sig: iterate `MultiSigCount` and fetch each `MultiSig(id)`.
4. Format output JSON:
   ```json
   {
     "contractId": "C...",
     "exportedAt": "2026-07-22T...",
     "network": "testnet",
     "summary": { "escrows": 12, "streams": 5, "multisigs": 3, "tips": 150 },
     "admin": { "signers": [...], "threshold": 2, "paused": false, "version": 3 },
     "escrows": [...],
     "streams": [...],
     "multisigs": [...]
   }
   ```
5. Handle Soroban RPC pagination for large datasets (escrows/streams are individually keyed but may be numerous).
6. Add to `scripts/` and document in `README.md`.

**Expected Architecture:**

```
scripts/
└── export-contract-state.js    (NEW)
README.md                       (+ usage docs)
```

**Acceptance Criteria:**
- [ ] `node scripts/export-contract-state.js --contract-id C... --rpc-url https://... --output state.json` produces valid JSON.
- [ ] `--filter escrows` exports only escrow data.
- [ ] Summary section shows correct counts matching on-chain state.
- [ ] Works against a testnet-deployed contract.
- [ ] Documented in `README.md`.

---

## BACKEND (Issues #9–#20)

---

### Issue #9 — Migrate In-Memory Storage to SQLite (with PostgreSQL Option)

**Labels:** `backend` `database` `persistence` `high-priority`

**Summary:** Replace all in-memory data stores in the backend with SQLite (dev/test) and PostgreSQL (production), providing persistent storage for tips, usernames, webhooks, turrets, and analytics cache.

**Background:** The backend currently uses in-memory storage throughout:
- `backend/src/controllers/tipsController.js` — tips stored in an in-memory `Map`
- `backend/src/controllers/accountController.js` — username→publicKey registry in memory
- `backend/src/services/webhookService.js` — webhook registrations in memory
- `backend/src/services/turretsService.js` — deployment registry and execution history in memory
- `backend/src/services/analyticsService.js` — 5-minute cache in memory

All data is lost on server restart. This is listed as "In Progress" on the `ROADMAP.md` v1.3.

**Problem Statement:** Production deployments cannot rely on in-memory storage. Tips, usernames, and webhook registrations must survive restarts. The Turrets service loses all deployment configurations on restart.

**Objectives:**
1. Add `better-sqlite3` (for SQLite) and `pg` (for PostgreSQL) dependencies.
2. Create a database abstraction layer that supports both backends via an environment variable.
3. Create migration files for all entities.
4. Refactor each controller/service to use the database layer instead of in-memory Maps.
5. Seed the database on first run.
6. Keep backward compatibility — all API responses maintain the same shape.

**Scope:**
- **In scope:** tips, usernames, webhooks, turrets deployments, turrets execution history, analytics cache.
- **Out of scope:** contract events (covered in Issue #3), user accounts beyond username registry.

**Detailed Implementation Requirements:**
1. Add dependencies: `better-sqlite3`, `pg`, `knex` (query builder for portability).
2. Create `backend/src/db/` directory:
   - `backend/src/db/connection.js` — exports a Knex instance configured from `DATABASE_URL` env var.
   - `backend/src/db/migrations/` — Knex migration files for all tables.
3. Define schema:
   ```sql
   -- tips
   CREATE TABLE tips (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_pk TEXT, creator_pk TEXT, amount TEXT, asset TEXT, memo TEXT, tx_hash TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
   -- usernames
   CREATE TABLE usernames (username TEXT UNIQUE, public_key TEXT UNIQUE, registered_at TIMESTAMP);
   -- webhooks
   CREATE TABLE webhooks (id TEXT PRIMARY KEY, public_key TEXT, url TEXT, secret TEXT, created_at TIMESTAMP);
   -- turrets
   CREATE TABLE turrets_deployments (id TEXT PRIMARY KEY, owner_pk TEXT, type TEXT, status TEXT, config JSON, deployment_hash TEXT, created_at TIMESTAMP, next_run_at TIMESTAMP, last_executed_at TIMESTAMP, ...);
   CREATE TABLE turrets_history (id TEXT PRIMARY KEY, deployment_id TEXT REFERENCES turrets_deployments(id), status TEXT, message TEXT, result JSON, created_at TIMESTAMP);
   ```
4. Refactor each service:
   - `tipsService.js`: Replace `Map.set/get` with Knex queries.
   - `usernameService.js`: Replace `Map` with `usernames` table.
   - `webhookService.js`: Replace array with `webhooks` table.
   - `turretsService.js`: Replace `Map` with `turrets_deployments` and `turrets_history` tables.
   - `analyticsService.js`: Keep the 5-minute in-memory cache but persist the underlying data.
5. Add `DB_PROVIDER` env var (`sqlite` or `postgres`) to `backend/src/config/validateEnv.js`.
6. Default to SQLite when `DB_PROVIDER` is unset or set to `sqlite`.

**Expected Architecture:**

```
backend/
├── package.json              (+ knex, better-sqlite3, pg)
├── src/
│   ├── db/
│   │   ├── connection.js     (NEW)
│   │   └── migrations/       (NEW: 001_tips, 002_usernames, etc.)
│   ├── config/
│   │   └── validateEnv.js    (+ DB_PROVIDER)
│   └── services/
│       ├── tipsService.js    (refactored)
│       ├── usernameService.js (refactored)
│       ├── webhookService.js (refactored)
│       ├── turretsService.js (refactored)
│       └── analyticsService.js (refactored)
```

**Acceptance Criteria:**
- [ ] `npm run migrate` creates all tables in SQLite.
- [ ] Data persists across backend restarts.
- [ ] All existing API tests pass (`npm test` in `backend/`).
- [ ] New integration test verifies data persistence after restart.
- [ ] `DB_PROVIDER=postgres` works with a PostgreSQL connection string.
- [ ] Backward compatible — no API response shape changes.

---

### Issue #10 — Refresh Token Rotation for SEP-0010 Sessions

**Labels:** `backend` `security` `auth` `sep-0010`

**Summary:** Implement refresh token rotation for SEP-0010 JWT sessions, replacing the current single-token model with short-lived access tokens (15 min) and long-lived refresh tokens (7 days).

**Background:** The current SEP-0010 implementation in `backend/src/middleware/auth.js` issues a single JWT with no expiration or refresh mechanism. The frontend `lib/wallet.ts` stores this token in memory and `lib/auth.ts` uses `localStorage`. This is flagged in `ROADMAP.md` v1.3 as an open hardening task.

**Problem Statement:** Long-lived JWTs without rotation are a security risk. If a token is leaked (e.g., via XSS), the attacker has indefinite access. Industry best practice (RFC 6819, OWASP) mandates short-lived access tokens with refresh rotation.

**Objectives:**
1. Split JWT issuance into `accessToken` (15 min TTL) and `refreshToken` (7 day TTL).
2. Store refresh tokens server-side (in the database from Issue #9) with a family/rotation tracking mechanism.
3. Add `POST /api/auth/refresh` endpoint.
4. Implement automatic reuse detection — if a stolen refresh token is used, invalidate the entire token family.
5. Update the frontend `lib/wallet.ts` and `lib/auth.ts` to handle token refresh transparently.

**Scope:**
- **In scope:** access/refresh token split, refresh endpoint, reuse detection, frontend integration.
- **Out of scope:** OAuth2 flows, third-party IdP integration.

**Detailed Implementation Requirements:**
1. Add `POST /api/auth/refresh` to `backend/src/routes/auth.js`:
   - Accepts `{ refreshToken: string }`.
   - Verifies the refresh token against the database.
   - If the token has already been used (replay attack), invalidate the entire token family.
   - Issues new access + refresh token pair.
   - Rotates the refresh token (old one is consumed, new one is stored).
2. Create `backend/src/services/tokenService.js`:
   - `issueTokens(publicKey) → { accessToken, refreshToken }`
   - `rotateRefreshToken(oldToken) → { accessToken, refreshToken } | null`
   - `revokeTokenFamily(publicKey)` — invalidates all refresh tokens for a user.
3. Update `auth.js` middleware:
   - Access tokens expire in 15 minutes.
   - Middleware returns `401` with error code `TOKEN_EXPIRED` on expiry.
4. Update frontend `lib/auth.ts`:
   - Store both tokens (access in memory, refresh in `httpOnly` cookie or secure storage).
   - Add `withAuth(fetchFn)` wrapper that catches 401, calls `/api/auth/refresh`, retries the original request.
   - On refresh failure, redirect to wallet connect flow.
5. Update `lib/wallet.ts`:
   - `performSEP0010Auth()` now stores both tokens.
   - `disconnectWallet()` revokes the token family via API call.
6. Add a `POST /api/auth/logout` endpoint that revokes the token family.

**Expected Architecture:**

```
backend/src/
├── routes/auth.js            (+ refresh + logout endpoints)
├── services/tokenService.js  (NEW)
├── middleware/auth.js        (updated: short TTL, 401 on expiry)

frontend/lib/
├── auth.ts                   (updated: two-token model, refresh interceptor)
└── wallet.ts                 (updated: store both tokens)
```

**Acceptance Criteria:**
- [ ] Access tokens expire after 15 minutes.
- [ ] `POST /api/auth/refresh` returns new token pair for valid refresh tokens.
- [ ] Reuse of a refresh token invalidates the entire family (subsequent refresh attempts return 401).
- [ ] Frontend automatically refreshes tokens on 401 responses.
- [ ] `POST /api/auth/logout` revokes all tokens.
- [ ] Tests in `backend/__tests__/accountsAuth.test.js` cover token refresh, expiry, and reuse detection.

---

### Issue #11 — Redis Caching Layer for Horizon Queries

**Labels:** `backend` `performance` `caching` `redis`

**Summary:** Add a Redis caching layer in front of Horizon API calls in `stellarService.js` to reduce latency and Horizon rate-limit pressure.

**Background:** `backend/src/services/stellarService.js` currently uses an in-memory LRU cache for Horizon responses with a timeout + exponential backoff retry. However, this cache is per-process — in a multi-instance deployment, each instance independently hits Horizon for the same data. Redis provides a shared cache.

**Problem Statement:** Under load, multiple backend instances may exceed Horizon rate limits. A shared Redis cache reduces redundant Horizon calls and improves response times from ~200ms to <5ms for cached data.

**Objectives:**
1. Add Redis client (`ioredis`) to the backend.
2. Create a `CacheService` abstraction that wraps both the existing LRU (local fallback) and Redis.
3. Cache account balances (30s TTL), payment history (60s TTL), and analytics results (5 min TTL).
4. Add cache invalidation on relevant mutation endpoints.
5. Make Redis optional — gracefully degrade to LRU-only when Redis is unavailable.

**Scope:**
- **In scope:** Redis client, CacheService, caching for account/balance/payment/analytics endpoints.
- **Out of scope:** caching for webhook delivery, Turrets data, or federation lookups.

**Detailed Implementation Requirements:**
1. Add `ioredis` to `backend/package.json`.
2. Create `backend/src/services/cacheService.js`:
   - `get(key)` → checks Redis first, falls back to LRU.
   - `set(key, value, ttlSeconds)` → writes to both Redis and LRU.
   - `del(key)` → removes from both.
   - `delPattern(pattern)` → for bulk invalidation.
   - Graceful degradation: if Redis connection fails, log a warning and use LRU only.
3. Add env vars to `backend/src/config/validateEnv.js`:
   - `REDIS_URL` (optional) — if unset, use LRU only.
   - `REDIS_CACHE_TTL_DEFAULT` (default 60).
4. Integrate cache into `stellarService.js`:
   - Wrap `getAccount()`, `getBalances()`, `getPaymentHistory()` with cache checks.
5. Integrate cache into `analyticsService.js`:
   - Replace the 5-min in-memory cache with CacheService.
6. Add cache invalidation:
   - After `POST /api/tips` → `delPattern('analytics:*')`.
   - After webhook events → `delPattern('account:*:payments')`.
7. Add `GET /api/health` response to include `redis: "connected" | "degraded" | "disabled"`.

**Expected Architecture:**

```
backend/src/
├── services/
│   ├── cacheService.js       (NEW)
│   ├── stellarService.js     (updated: cache integration)
│   └── analyticsService.js   (updated: cache integration)
├── config/
│   └── validateEnv.js        (+ REDIS_URL)
└── server.js                 (Redis connection on startup + health check)
```

**Acceptance Criteria:**
- [ ] With Redis enabled, repeated `/api/accounts/:pk` requests are served from cache with <5ms latency.
- [ ] With Redis disabled/unavailable, the system degrades to LRU-only with no errors.
- [ ] Health endpoint reports Redis connection status.
- [ ] Cache TTLs are configurable via env vars.
- [ ] Tests in `backend/__tests__/stellarService.test.js` cover cache hit/miss scenarios.

---

### Issue #12 — Webhook Retry with Dead Letter Queue

**Labels:** `backend` `webhooks` `reliability` `feature`

**Summary:** Add automatic retry with exponential backoff and a dead letter queue for failed webhook deliveries in `webhookService.js`.

**Background:** `backend/src/services/webhookService.js` delivers payment events to registered webhook URLs with HMAC-SHA256 signatures. Currently, if a delivery fails (network error, 5xx from receiver), the event is silently dropped. The `backend/src/utils/webhookSignature.js` handles signing but there is no retry logic.

**Problem Statement:** Webhook consumers rely on reliable delivery. Dropped events mean missed payment notifications, which is unacceptable for production use cases like e-commerce integrations.

**Objectives:**
1. Add a retry mechanism with exponential backoff (1s, 5s, 25s, 125s — max 5 retries).
2. Persist failed deliveries in the database (from Issue #9) as a dead letter queue.
3. Add `GET /api/webhooks/:publicKey/failures` endpoint to list undelivered events.
4. Add `POST /api/webhooks/:publicKey/retry` to manually retry failed deliveries.

**Scope:**
- **In scope:** retry logic, dead letter queue storage, failure listing, manual retry endpoint.
- **Out of scope:** automatic dead letter replay, webhook event replay for past events.

**Detailed Implementation Requirements:**
1. Add a `webhook_deliveries` table to `backend/src/db/migrations/`:
   ```sql
   CREATE TABLE webhook_deliveries (
     id TEXT PRIMARY KEY,
     webhook_id TEXT REFERENCES webhooks(id),
     event_type TEXT NOT NULL,
     payload JSONB NOT NULL,
     status TEXT DEFAULT 'pending',  -- pending, delivered, failed, dead
     attempts INTEGER DEFAULT 0,
     last_attempt_at TIMESTAMP,
     last_error TEXT,
     next_retry_at TIMESTAMP,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```
2. Refactor `webhookService.js`:
   - `deliver(webhook, event)` → inserts into `webhook_deliveries`, attempts delivery immediately.
   - On failure: increment `attempts`, set `next_retry_at` with exponential backoff.
   - After 5 failures: set `status = 'dead'`.
3. Add a background retry worker that runs every 30 seconds, queries for `status = 'pending' AND next_retry_at <= NOW() AND attempts < 5`, and retries.
4. Add `GET /api/webhooks/:publicKey/failures` — returns dead deliveries for that user's webhooks.
5. Add `POST /api/webhooks/:publicKey/retry` — resets `attempts = 0, status = 'pending'` for dead deliveries.
6. Ensure webhook deliveries are signed using the existing `webhookSignature.js`.

**Expected Architecture:**

```
backend/src/
├── services/
│   └── webhookService.js     (refactored: retry + DLQ)
├── routes/
│   └── webhooks.js           (+ GET failures, POST retry endpoints)
└── db/migrations/
    └── NNN_webhook_deliveries.sql  (NEW)
```

**Acceptance Criteria:**
- [ ] Failed webhook deliveries are retried up to 5 times with exponential backoff.
- [ ] After 5 failures, delivery is marked as `dead`.
- [ ] `GET /api/webhooks/:pk/failures` lists dead deliveries.
- [ ] `POST /api/webhooks/:pk/retry` resets and retries dead deliveries.
- [ ] Delivered webhooks include a valid `X-Webhook-Signature` header.
- [ ] Tests in `backend/__tests__/webhookRoutes.test.js` cover retry and dead letter scenarios.

---

### Issue #13 — Rate Limiting by Authenticated Identity

**Labels:** `backend` `security` `rate-limiting` `enhancement`

**Summary:** Extend the existing IP-based rate limiting in `rateLimit.js` to also rate-limit by authenticated user identity (JWT subject claim).

**Background:** `backend/src/middleware/rateLimit.js` implements two limiters: `strictLimiter` (20 req/min) and `sensitiveLimiter` (10 req/min). Both are keyed by `req.ip` only. An authenticated attacker could rotate IPs (e.g., via a botnet) to bypass rate limits. Rate limiting by JWT subject provides defense in depth.

**Problem Statement:** IP-based rate limiting alone is insufficient against distributed attacks. Authenticated endpoints should enforce per-user rate limits in addition to per-IP limits.

**Objectives:**
1. Add a `userLimiter` that keys off `req.user.sub` (the Stellar public key from the JWT).
2. Apply the user limiter to the most sensitive endpoints (`/api/accounts/:pk`, `/api/payments/*`).
3. Return `429` with a clear error message when user limit is exceeded.
4. Add rate limit headers that distinguish IP vs user limits.

**Scope:**
- **In scope:** per-user rate limiter, integration with existing auth middleware, header distinction.
- **Out of scope:** dynamic rate limits per user tier, rate limit analytics dashboard.

**Detailed Implementation Requirements:**
1. Create `backend/src/middleware/userRateLimit.js`:
   - Uses `express-rate-limit` with a `keyGenerator` function that returns `req.user?.sub || req.ip`.
   - Default: 30 requests per minute per authenticated user.
   - Falls back to IP-based keying when no JWT is present (public endpoints).
2. Update `backend/src/middleware/auth.js`:
   - Ensure `req.user` is populated with `{ sub, iat, exp }` on successful JWT verification.
3. Apply `userLimiter` in addition to `strictLimiter` on:
   - `backend/src/routes/accounts.js`
   - `backend/src/routes/payments.js`
   - `backend/src/routes/analytics.js`
4. Add `X-RateLimit-User-Remaining` header alongside the standard `RateLimit-Remaining`.
5. Update `ENV.md` to document the new `USER_RATE_LIMIT_MAX` and `USER_RATE_LIMIT_WINDOW_MS` env vars.

**Expected Architecture:**

```
backend/src/middleware/
├── rateLimit.js              (unchanged)
├── userRateLimit.js          (NEW)
└── auth.js                   (updated: populate req.user)

backend/src/routes/
├── accounts.js               (+ userLimiter)
├── payments.js               (+ userLimiter)
└── analytics.js              (+ userLimiter)
```

**Acceptance Criteria:**
- [ ] Authenticated user exceeding 30 req/min receives 429 with "Too many requests from this account" message.
- [ ] IP-based limits still apply independently.
- [ ] Unauthenticated requests fall back to IP-based keying.
- [ ] `X-RateLimit-User-Remaining` header is present on rate-limited routes.
- [ ] New tests in `backend/__tests__/` verify user-based rate limiting.

---

### Issue #14 — Database-Backed Turrets with Price Feed Fallbacks

**Labels:** `backend` `turrets` `persistence` `enhancement`

**Summary:** Migrate the Turrets service from in-memory storage to the database (from Issue #9) and add a multi-source price feed with fallback providers.

**Background:** The Turrets service (`backend/src/services/turretsService.js`, `backend/src/turretsServer.js`) stores deployments and execution history in memory. It uses only CoinGecko for price feeds. The `TURRETS.md` docs explicitly note: "In-memory storage: Deployments and history are lost on restart. For production, implement database persistence."

**Problem Statement:** Losing all turrets deployments on restart is unacceptable for production. Additionally, CoinGecko's free API has rate limits — a single source of truth for price data creates a single point of failure for stop-loss functions.

**Objectives:**
1. Migrate deployment and history storage to the database tables created in Issue #9.
2. Add at least one fallback price feed provider (Binance API or CoinCap).
3. Add a price feed health check that reports provider status.
4. Ensure deployments survive server restarts.

**Scope:**
- **In scope:** DB persistence for turrets, price feed fallback, health check.
- **Out of scope:** on-chain oracle integration (future), multi-function bundles.

**Detailed Implementation Requirements:**
1. Ensure the `turrets_deployments` and `turrets_history` tables from Issue #9 are created.
2. Refactor `turretsService.js`:
   - Replace all `Map` operations with Knex queries.
   - Load active deployments from DB on startup.
   - On deployment creation, insert into DB.
   - On execution, insert history record into DB.
3. Refactor `turretsServer.js`:
   - The evaluation loop reads from the DB instead of in-memory Map.
4. Add `backend/src/services/priceFeedService.js`:
   - `getXLMPrice()` — tries CoinGecko first, falls back to Binance, then CoinCap.
   - Cache price for 30 seconds to avoid hitting rate limits.
   - Return `{ price: number, source: string, timestamp }`.
5. Add `PRICE_FEED_COINGECKO_API_KEY` env var to support CoinGecko's pro API.
6. Add health check: `GET /api/turrets/health` returns status including price feed provider status.

**Expected Architecture:**

```
backend/src/
├── services/
│   ├── turretsService.js     (refactored: DB persistence)
│   └── priceFeedService.js   (NEW)
├── turretsServer.js          (updated: reads from DB)
└── routes/turrets.js         (+ GET /api/turrets/health)
```

**Acceptance Criteria:**
- [ ] Turrets deployments persist across server restarts.
- [ ] Execution history is stored in the database and queryable.
- [ ] Price feed falls back to alternative provider when CoinGecko fails.
- [ ] Health endpoint returns price feed provider status.
- [ ] Tests cover DB persistence and price feed fallback.

---

### Issue #15 — Stellar Anchor Integration (SEP-24)

**Labels:** `backend` `sep-24` `anchor` `fiat` `feature`

**Summary:** Add SEP-24 (Interactive Hosted Deposit & Withdrawal) integration to connect Finchippay with Stellar anchors for fiat on/off-ramp.

**Background:** `ROADMAP.md` v2.0 lists "Fiat on-ramp integration (MoneyGram, Stellar Anchor)" as a planned feature. The backend already has SEP-0002 federation and SEP-0010 auth. SEP-24 is the standard protocol for interactive deposit/withdrawal flows between wallets and anchors.

**Problem Statement:** Users cannot deposit fiat currency into Finchippay or withdraw XLM to their bank account. Integrating SEP-24 enables KYC-compliant fiat rails via established Stellar anchors.

**Objectives:**
1. Implement the SEP-24 interactive flow server-side.
2. Add `POST /api/sep24/deposit` and `POST /api/sep24/withdraw` endpoints.
3. Proxy anchor interactive URLs to the frontend.
4. Handle SEP-24 callbacks for transaction status updates.
5. Support at least one anchor (e.g., AnchorUSD testnet for development).

**Scope:**
- **In scope:** SEP-24 deposit/withdraw initiation, interactive URL proxy, callback handling, single anchor integration.
- **Out of scope:** SEP-6 (programmatic deposits), SEP-31 (cross-border payments), multi-anchor routing.

**Detailed Implementation Requirements:**
1. Create `backend/src/services/sep24Service.js`:
   - `initiateDeposit(publicKey, asset, amount, anchorConfig)` — calls the anchor's `/sep24/transactions/deposit/interactive` endpoint per the SEP-24 spec.
   - `initiateWithdraw(publicKey, asset, amount, dest, anchorConfig)` — similar for withdrawals.
   - `pollTransaction(txId, anchorConfig)` — polls `/transaction?id=` for status updates.
2. Create `backend/src/routes/sep24.js`:
   - `POST /api/sep24/deposit` — body: `{ assetCode, assetIssuer, amount, anchorName }`. Returns `{ interactiveUrl, txId }`.
   - `POST /api/sep24/withdraw` — body: `{ assetCode, assetIssuer, amount, destAccount, anchorName }`. Returns `{ interactiveUrl, txId }`.
   - `GET /api/sep24/transactions/:txId` — returns current transaction status.
   - `POST /api/sep24/callback` — webhook endpoint for anchor to POST status updates.
3. Create `backend/src/config/anchors.js`:
   - Map of anchor names to their SEP-24 service URLs, API keys, and supported assets.
   - Configurable via `ANCHORS_CONFIG` env var (JSON string).
4. Add the anchor config to `backend/src/config/validateEnv.js`.
5. Create a frontend component `frontend/components/FiatOnRamp.tsx` that displays the interactive URL in an iframe or opens it in a new tab, then polls for completion.

**Expected Architecture:**

```
backend/src/
├── services/
│   └── sep24Service.js       (NEW)
├── routes/
│   └── sep24.js              (NEW)
├── config/
│   ├── anchors.js            (NEW)
│   └── validateEnv.js        (+ ANCHORS_CONFIG)
└── server.js                 (register sep24 routes)

frontend/
└── components/
    └── FiatOnRamp.tsx        (NEW)
```

**Acceptance Criteria:**
- [ ] `POST /api/sep24/deposit` returns an interactive URL from the configured anchor.
- [ ] `GET /api/sep24/transactions/:txId` polls and returns transaction status.
- [ ] Callback endpoint updates transaction status on anchor notification.
- [ ] Frontend component displays the anchor's interactive flow.
- [ ] Integration test with a Stellar testnet anchor (e.g., `testanchor.stellar.org`).
- [ ] Documented in `docs/api.md`.

---

### Issue #16 — KYC Integration via SEP-12

**Labels:** `backend` `sep-12` `kyc` `compliance`

**Summary:** Implement SEP-12 (KYC API) integration so users can submit and manage KYC information required by Stellar anchors for fiat deposits/withdrawals.

**Background:** SEP-12 defines a standard way for wallets to collect and submit KYC information to anchors. This is a prerequisite for Issue #15's SEP-24 integration — anchors require KYC before allowing deposits/withdrawals.

**Problem Statement:** Without SEP-12, the SEP-24 deposit/withdrawal flow cannot complete because anchors will reject transactions from users without verified KYC profiles.

**Objectives:**
1. Implement SEP-12 `PUT /customer` and `GET /customer` endpoints as a proxy to the anchor.
2. Support all SEP-12 field types: `string`, `binary`, `date`, `number`.
3. Provide a simple KYC form in the frontend settings page.
4. Handle KYC status callbacks.

**Scope:**
- **In scope:** SEP-12 proxy endpoints, frontend KYC form, status tracking.
- **Out of scope:** direct KYC processing (we proxy to anchor), document upload/storage.

**Detailed Implementation Requirements:**
1. Create `backend/src/services/sep12Service.js`:
   - `putCustomer(publicKey, anchorConfig, fields)` — submits KYC fields per SEP-12 `PUT /customer`.
   - `getCustomer(publicKey, anchorConfig)` — fetches current KYC status per SEP-12 `GET /customer`.
   - `getCustomerStatus(publicKey, anchorConfig)` — returns simplified status: `NONE`, `NEEDS_INFO`, `PROCESSING`, `ACCEPTED`, `REJECTED`.
2. Create `backend/src/routes/sep12.js`:
   - `POST /api/sep12/customer` — body: `{ anchorName, fields: { first_name, last_name, email, ... } }`. Proxies to anchor.
   - `GET /api/sep12/customer?anchorName=X` — returns current KYC data and status.
   - `GET /api/sep12/customer/status?anchorName=X` — returns simplified status.
3. Add a `KyCForm` component to `frontend/components/KyCForm.tsx`:
   - Fields: first name, last name, email, date of birth, address, country.
   - Submit to `POST /api/sep12/customer`.
   - Show KYC status badge.
4. Add a KYC section to `frontend/pages/settings.tsx`.
5. Keep the SEP-12 requests authenticated via the existing JWT middleware.

**Expected Architecture:**

```
backend/src/
├── services/
│   └── sep12Service.js       (NEW)
├── routes/
│   └── sep12.js              (NEW)
└── server.js                 (register sep12 routes)

frontend/
├── components/
│   └── KyCForm.tsx           (NEW)
└── pages/
    └── settings.tsx          (updated: KYC section)
```

**Acceptance Criteria:**
- [ ] `POST /api/sep12/customer` submits KYC fields to the configured anchor and returns the anchor's response.
- [ ] `GET /api/sep12/customer` returns current KYC data.
- [ ] Frontend KYC form collects standard SEP-12 fields.
- [ ] Status badge shows `ACCEPTED`/`PROCESSING`/`NEEDS_INFO`/`REJECTED`.
- [ ] Authenticated users can only manage their own KYC data.
- [ ] Tests cover SEP-12 proxy with a mock anchor.

---

### Issue #17 — GraphQL API Layer

**Labels:** `backend` `graphql` `api` `enhancement`

**Summary:** Add a GraphQL API layer alongside the existing REST API, providing flexible querying for the frontend dashboard.

**Background:** The backend currently exposes 27 REST endpoints (`docs/api.md`). The frontend dashboard (`frontend/pages/dashboard.tsx`) makes multiple sequential API calls to fetch account data, payments, analytics, tips, and contract events. A GraphQL layer would allow the frontend to fetch all needed data in a single request.

**Problem Statement:** The dashboard's waterfall of REST calls creates unnecessary latency and complexity. GraphQL enables exact-fetching — only the fields the UI needs.

**Objectives:**
1. Add Apollo Server (or `express-graphql`) to the Express backend.
2. Create GraphQL types mirroring the existing REST data models.
3. Implement resolvers that delegate to existing controllers.
4. Expose at `/api/graphql`.
5. Add a simple GraphQL playground for development.

**Scope:**
- **In scope:** GraphQL schema for accounts, payments, analytics, tips, and turrets. Queries only (no mutations — payments remain REST/contract-initiated).
- **Out of scope:** GraphQL subscriptions, mutations, federation.

**Detailed Implementation Requirements:**
1. Add `graphql`, `apollo-server-express` (or `@apollo/server` v4) to `backend/package.json`.
2. Create `backend/src/graphql/` directory:
   - `backend/src/graphql/schema.js` — GraphQL type definitions (Account, Payment, Analytics, Tip, TurretDeployment, Event).
   - `backend/src/graphql/resolvers.js` — resolver functions delegating to existing services/controllers.
3. Define types:
   ```graphql
   type Account {
     publicKey: String!
     balances: [Balance!]!
     sequence: String!
   }
   type Balance {
     assetCode: String!
     balance: String!
     assetType: String!
   }
   type Payment {
     id: String!
     type: String!
     amount: String!
     asset: String!
     from: String!
     to: String!
     memo: String
     createdAt: String!
     transactionHash: String!
   }
   type Analytics {
     totalSentXLM: String!
     totalReceivedXLM: String!
     uniqueCounterparties: Int!
     averageTransactionSize: String!
     totalTransactions: Int!
     topRecipients: [TopRecipient!]!
     activityByDay: [DayActivity!]!
   }
   type Query {
     account(publicKey: String!): Account
     payments(publicKey: String!, limit: Int, cursor: String): [Payment!]!
     analytics(publicKey: String!): Analytics
     tipsReceived(creatorPublicKey: String!, limit: Int, offset: Int): TipResult
     turrets(ownerPublicKey: String): [TurretDeployment!]!
   }
   ```
4. Wire Apollo Server into `backend/src/server.js` at the `/api/graphql` path.
5. Add the `apollo-server-core` landing page for the GraphQL playground (disabled in production).
6. Ensure auth middleware applies to GraphQL requests.

**Expected Architecture:**

```
backend/src/
├── graphql/
│   ├── schema.js             (NEW)
│   └── resolvers.js          (NEW)
├── server.js                 (register Apollo Server)
└── package.json              (+ graphql, apollo-server-express)
```

**Acceptance Criteria:**
- [ ] `/api/graphql` accepts and resolves queries against the defined schema.
- [ ] Single query can fetch account, payments, and analytics in one request.
- [ ] GraphQL playground is available in development, disabled in production.
- [ ] Auth middleware protects authenticated fields.
- [ ] Existing REST endpoints continue to work unchanged.

---

### Issue #18 — Input Validation with Zod Schemas

**Labels:** `backend` `validation` `security` `refactor`

**Summary:** Replace all manual input validation in the backend with Zod schemas for type-safe, declarative validation across all API routes.

**Background:** The backend currently uses ad-hoc validation: manual checks for `if (!amount)`, regex matches for Stellar public keys, and inline validation messages. For example, `backend/src/controllers/accountController.js` manually validates usernames, and `backend/src/controllers/tipsController.js` validates amounts inline. This is error-prone and inconsistent.

**Problem Statement:** Inconsistent input validation makes the codebase harder to maintain and increases the risk of validation gaps. Zod provides composable, type-safe schemas with automatic TypeScript inference.

**Objectives:**
1. Add `zod` to the backend.
2. Create Zod schemas for every API endpoint's request body and query parameters.
3. Create a `validate` middleware that uses schemas and returns consistent error responses.
4. Refactor all controllers to use the validated, typed data.

**Scope:**
- **In scope:** request body validation, query parameter validation, path parameter validation. All 27 endpoints.
- **Out of scope:** response validation, contract-level validation.

**Detailed Implementation Requirements:**
1. Add `zod` to `backend/package.json`.
2. Create `backend/src/validation/` directory:
   - `backend/src/validation/schemas.js` — Zod schemas organized by route group:
     ```js
     const { z } = require("zod");
     
     const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/);
     
     const tipSchema = z.object({
       senderPublicKey: stellarAddress,
       creatorPublicKey: stellarAddress,
       amount: z.string().regex(/^\d+(\.\d+)?$/),
       asset: z.string().default("XLM"),
       memo: z.string().max(28).optional(),
       txHash: z.string().optional(),
     });
     ```
   - `backend/src/validation/middleware.js` — Express middleware:
     ```js
     function validate(schema, source = "body") {
       return (req, res, next) => {
         const result = schema.safeParse(req[source]);
         if (!result.success) {
           return res.status(400).json({
             error: "Validation failed",
             details: result.error.flatten().fieldErrors,
           });
         }
         req.validated = result.data;
         next();
       };
     }
     ```
3. Refactor controllers to use `req.validated` instead of manually destructuring and validating `req.body`/`req.query`/`req.params`.
4. Use Zod's `.refine()` for cross-field validations (e.g., amount > 0, startDate < endDate).
5. Add a `zodErrorHandler` global error middleware in `server.js` that catches `ZodError` and returns 400.

**Expected Architecture:**

```
backend/src/
├── validation/
│   ├── schemas.js            (NEW: all Zod schemas)
│   └── middleware.js          (NEW: validate middleware)
├── controllers/              (refactored: use req.validated)
└── server.js                 (+ zodErrorHandler)
```

**Acceptance Criteria:**
- [ ] All API endpoints validate input with Zod schemas.
- [ ] Invalid inputs return 400 with `{ error, details: { field: [messages] } }`.
- [ ] Controllers use `req.validated` with TypeScript-like confidence.
- [ ] All existing API tests pass without modification to response shapes (only the error details format may change to be more structured).
- [ ] At least 5 new tests verify validation error responses for each schema.

---

### Issue #19 — Scheduled Transaction Execution (Cron-Based)

**Labels:** `backend` `scheduled` `cron` `feature`

**Summary:** Implement a server-side scheduled transaction service that automatically executes recurring payments and stream claims based on user-defined schedules.

**Background:** The frontend has `RecurringPayments` (`frontend/components/RecurringPayments.tsx`) which stores schedules in `localStorage` and prompts the user to manually click "Pay Now" when a payment is due. The backend has `scheduledTransactions.js` routes (`backend/src/routes/scheduledTransactions.js`) that accept cron expressions but the implementation is a stub. The roadmap mentions this as a needed feature.

**Problem Statement:** Recurring payments require the user's browser to be open for execution. For production use, schedules should execute server-side without manual intervention.

**Objectives:**
1. Build a `ScheduledTransactionService` that parses cron expressions and executes transactions at the specified times.
2. Migrate scheduled payment storage from frontend `localStorage` to the database (from Issue #9).
3. Add API routes for CRUD operations on scheduled transactions.
4. Add a "Requires Signature" mode — transactions that trigger a push notification or email requesting the user to sign, rather than auto-executing.

**Scope:**
- **In scope:** server-side scheduler, DB storage, CRUD API, signature-required mode.
- **Out of scope:** auto-execution without user signature (requires delegated signing infrastructure).

**Detailed Implementation Requirements:**
1. Add `node-cron` or `croner` to `backend/package.json`.
2. Create `backend/src/services/scheduledTransactionService.js`:
   - On startup, load all active schedules from the `scheduled_transactions` DB table.
   - Register a cron job for each schedule.
   - When a schedule fires: create a transaction XDR, store it in `pending_executions`, and call webhook/push notification to alert the user.
   - Support frequencies: `daily`, `weekly`, `monthly`, and raw cron expressions.
3. Refactor `backend/src/routes/scheduledTransactions.js`:
   - `POST /api/scheduled-transactions` — create a schedule (recipient, amount, frequency, memo, startDate).
   - `GET /api/scheduled-transactions/:publicKey` — list schedules for a user.
   - `PUT /api/scheduled-transactions/:id` — update a schedule.
   - `DELETE /api/scheduled-transactions/:id` — delete a schedule and cancel its cron job.
   - `GET /api/scheduled-transactions/:publicKey/pending` — list transactions awaiting signature.
4. Create a `scheduled_transactions` table in the DB migration:
   ```sql
   CREATE TABLE scheduled_transactions (
     id TEXT PRIMARY KEY,
     owner_pk TEXT NOT NULL,
     recipient TEXT NOT NULL,
     amount TEXT NOT NULL,
     asset TEXT DEFAULT 'XLM',
     memo TEXT,
     frequency TEXT NOT NULL,
     cron_expression TEXT,
     start_date DATE NOT NULL,
     next_run_at TIMESTAMP,
     status TEXT DEFAULT 'active',
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```
5. Update the frontend `RecurringPayments` component to sync with the backend API, falling back to localStorage when offline.

**Expected Architecture:**

```
backend/src/
├── services/
│   └── scheduledTransactionService.js  (NEW: replaced stub)
├── routes/
│   └── scheduledTransactions.js        (refactored)
└── db/migrations/
    └── NNN_scheduled_transactions.sql  (NEW)

frontend/
└── components/
    └── RecurringPayments.tsx           (updated: API sync)
```

**Acceptance Criteria:**
- [ ] `POST /api/scheduled-transactions` persists a schedule and registers a cron job.
- [ ] At the scheduled time, a pending transaction XDR is stored and user is notified.
- [ ] `DELETE /api/scheduled-transactions/:id` removes the cron job.
- [ ] Schedules survive server restarts (loaded from DB).
- [ ] Frontend displays both local and server-side schedules.
- [ ] Tests cover schedule creation, execution, pause, and deletion.

---

### Issue #20 — OpenTelemetry Distributed Tracing

**Labels:** `backend` `observability` `tracing` `opentelemetry`

**Summary:** Implement OpenTelemetry distributed tracing across the backend to provide end-to-end visibility into request flows, Horizon calls, and service dependencies.

**Background:** The backend already has OpenTelemetry scaffolding: `backend/src/config/tracing.js` and `OTEL_EXPORTER_OTLP_ENDPOINT` env var documented in `ENV.md`. However, the tracing is not wired into the Express middleware or service calls.

**Problem Statement:** Without distributed tracing, debugging latency issues across the frontend → backend → Horizon chain is blind. Production issues require guesswork to identify bottlenecks.

**Objectives:**
1. Wire OpenTelemetry auto-instrumentation for Express and HTTP calls.
2. Add manual spans for key operations: Horizon API calls, database queries, webhook delivery.
3. Propagate trace context to the frontend via `traceparent` header.
4. Export traces to the configured OTLP endpoint (Jaeger, Grafana Tempo, etc.).

**Scope:**
- **In scope:** Express auto-instrumentation, manual spans for Horizon/DB/webhook, trace context propagation to frontend.
- **Out of scope:** frontend tracing (future issue), custom metrics beyond traces.

**Detailed Implementation Requirements:**
1. Add OpenTelemetry packages to `backend/package.json`:
   - `@opentelemetry/sdk-node`
   - `@opentelemetry/auto-instrumentations-node`
   - `@opentelemetry/exporter-trace-otlp-http`
   - `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-express`
2. Refactor `backend/src/config/tracing.js`:
   - Initialize `NodeSDK` with auto-instrumentation.
   - Configure OTLP exporter from `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` env vars.
   - Start the SDK before the Express server.
3. Add manual spans in `stellarService.js`:
   ```js
   const tracer = require("../config/tracing").getTracer("stellar-service");
   async function getAccount(publicKey) {
     const span = tracer.startSpan("horizon.getAccount");
     span.setAttribute("stellar.publicKey", publicKey);
     try {
       return await horizon.getAccount(publicKey);
     } finally {
       span.end();
     }
   }
   ```
4. Add trace context propagation middleware in `backend/src/middleware/tracing.js`:
   - Parse `traceparent` header from incoming requests.
   - Include `traceparent` in responses so the frontend can continue the trace.
5. Add `traceparent` header to frontend API calls in `frontend/lib/stellar.ts` (or a new `frontend/lib/api.ts` utility).
6. Enable tracing only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; disable in test mode (already guarded in the config).

**Expected Architecture:**

```
backend/src/
├── config/tracing.js         (refactored: full SDK init)
├── middleware/tracing.js     (NEW: context propagation)
├── services/stellarService.js (updated: manual spans)
└── server.js                 (import tracing before everything)

frontend/lib/
└── api.ts                    (NEW: traceparent propagation)
```

**Acceptance Criteria:**
- [ ] Backend spans appear in the configured trace collector (e.g., Jaeger).
- [ ] Each HTTP request generates a trace with spans for Express routing and Horizon calls.
- [ ] `traceparent` header is propagated from backend responses to frontend requests.
- [ ] Tracing has negligible performance impact (<1% latency increase).
- [ ] Tracing is disabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.

---

## FRONTEND (Issues #21–#38)

---

### Issue #21 — Soroban RPC Client Abstraction Layer

**Labels:** `frontend` `soroban` `refactor` `architecture`

**Summary:** Create a unified Soroban RPC client layer in `frontend/lib/soroban.ts` that abstracts all contract interactions, replacing the ad-hoc Soroban calls currently scattered across components.

**Background:** Contract interactions are currently handled directly in components like `StreamingPayments.tsx` and through the `frontend/lib/stellar.ts` helper. The `ROADMAP.md` v1.3 lists "Soroban RPC abstraction layer in the frontend" as an in-progress hardening item. There is no centralized error handling, retry logic, or contract method mapping.

**Problem Statement:** Scattered Soroban calls make the codebase fragile — changing the contract ABI requires finding and updating every inline invocation. A centralized client enables mock testing, consistent error handling, and ABI versioning.

**Objectives:**
1. Create `frontend/lib/soroban.ts` with typed methods for every contract entry-point.
2. Add consistent error handling with user-friendly messages mapped from `ContractError` codes.
3. Add automatic retry for RPC failures (timeout → exponential backoff).
4. Support contract version detection and ABI compatibility checks.
5. Refactor existing components to use the new client.

**Scope:**
- **In scope:** typed client for all contract functions, error mapping, retry logic, component refactor.
- **Out of scope:** Soroban transaction simulation (Issue #29).

**Detailed Implementation Requirements:**
1. Create `frontend/lib/soroban.ts`:
   ```ts
   class FinchippayClient {
     constructor(rpcUrl: string, contractId: string, networkPassphrase: string);
     
     // Tips
     async sendTip(token: string, from: string, to: string, amount: string, memo?: string): Promise<SendTipResult>;
     async getTipTotal(recipient: string): Promise<string>;
     
     // Escrow
     async createEscrow(token: string, from: string, to: string, amount: string, releaseLedger: number, memo?: string): Promise<number>;
     async claimEscrow(escrowId: number): Promise<void>;
     async cancelEscrow(escrowId: number): Promise<void>;
     async getEscrow(escrowId: number): Promise<Escrow>;
     
     // Streaming
     async openStream(token: string, payer: string, recipient: string, ratePerLedger: string, deposit: string): Promise<number>;
     async claimStream(streamId: number): Promise<string>;
     async getClaimable(streamId: number): Promise<string>;
     async closeStream(streamId: number): Promise<string>;
     async getStream(streamId: number): Promise<Stream>;
     
     // Multi-sig
     async createMultisig(...): Promise<number>;
     async approveMultisig(proposalId: number): Promise<void>;
     async getMultisig(proposalId: number): Promise<MultiSigProposal>;
     
     // Batch
     async batchSend(token: string, from: string, recipients: string[], amounts: string[]): Promise<void>;
     
     // Contract info
     async getContractVersion(): Promise<number>;
     async getContractStats(): Promise<{ escrows: number; streams: number; multisigs: number }>;
     async isPaused(): Promise<boolean>;
   }
   ```
2. Map `ContractError` variants (from `lib.rs`) to user-friendly messages:
   ```ts
   const ERROR_MESSAGES: Record<number, string> = {
     1: "Contract already initialized",
     2: "Unauthorized — you don't have permission for this action",
     3: "Amount must be positive",
     // ... all 17 error codes
   };
   ```
3. Add RPC retry with exponential backoff:
   - 3 retries with 1s, 5s, 25s delays.
   - Only retry on network/timeout errors, not contract panics.
4. Add `getClient()` as a lazy singleton that reads `NEXT_PUBLIC_CONTRACT_ID` and `NEXT_PUBLIC_SOROBAN_RPC_URL`.
5. Refactor `frontend/components/StreamingPayments.tsx` and `frontend/pages/escrow.tsx` to use the new client.
6. Add `frontend/__tests__/sorobanClient.test.ts` with mocked Soroban RPC responses.

**Expected Architecture:**

```
frontend/lib/
├── soroban.ts                (NEW: unified client)
└── stellar.ts                (unchanged: payment operations)

frontend/components/
├── StreamingPayments.tsx     (refactored: use soroban.ts)
└── pages/
    └── escrow.tsx            (refactored: use soroban.ts)
```

**Acceptance Criteria:**
- [ ] All contract interaction methods are exposed through the typed client.
- [ ] Contract errors are mapped to human-readable messages.
- [ ] RPC failures are retried with exponential backoff.
- [ ] Components use `FinchippayClient` instead of inline Soroban calls.
- [ ] Unit tests verify client methods with mocked RPC.

---

### Issue #22 — Dark Mode with System Preference Detection

**Labels:** `frontend` `ui` `dark-mode` `accessibility` `feature`

**Summary:** Implement a dark/light theme toggle with automatic system preference detection, persisted user preference, and smooth transitions.

**Background:** The application currently uses a hard-coded dark theme throughout (`globals.css` with dark backgrounds, `text-white`, etc.). There is no light mode or user preference control. Tailwind's `dark:` variant is not utilized.

**Problem Statement:** Users in bright environments or with visual preferences find the forced dark theme inaccessible. A proper theme system with system preference detection is an accessibility and UX baseline.

**Objectives:**
1. Refactor `tailwind.config.ts` to use the `class` dark mode strategy.
2. Define a light theme color palette matching the existing dark theme.
3. Create a `ThemeProvider` context that manages theme state.
4. Add a theme toggle to the `Navbar` component.
5. Persist preference in `localStorage` and respect `prefers-color-scheme` media query.
6. Add smooth CSS transitions on theme change.

**Scope:**
- **In scope:** dark/light themes, system preference detection, localStorage persistence, Navbar toggle, all pages.
- **Out of scope:** custom theme colors (user-chosen accent), per-component theme overrides.

**Detailed Implementation Requirements:**
1. Update `frontend/tailwind.config.ts`:
   ```ts
   module.exports = {
     darkMode: "class",
     theme: {
       extend: {
         colors: {
           // Light theme additions
           surface: {
             light: "#ffffff",
             dark: "#0f172a",
           },
           // ... keep existing stellar, etc. colors
         },
       },
     },
   };
   ```
2. Refactor `frontend/styles/globals.css`:
   - Move dark-specific styles into `.dark` class selectors.
   - Add light theme defaults for `body`, `.card`, `.input-field`, `.btn-primary`, etc.
   - Add `transition: background-color 0.3s ease, color 0.3s ease` on `body` and major containers.
3. Create `frontend/lib/ThemeContext.tsx`:
   ```tsx
   type Theme = "light" | "dark" | "system";
   const ThemeContext = createContext<{ theme: Theme; resolved: "light" | "dark"; setTheme: (t: Theme) => void }>();
   ```
   - On mount: read `localStorage("finchippay:theme")` or default to `"system"`.
   - When resolved to "system": use `window.matchMedia("(prefers-color-scheme: dark)")`.
   - Apply `document.documentElement.classList.toggle("dark", isDark)`.
4. Create a `ThemeToggle` component with sun/moon icons, rendered in `frontend/components/Navbar.tsx`.
5. Add `suppressHydrationWarning` to `<html>` in `frontend/pages/_document.tsx` to prevent flash.
6. Add a `ThemeScript` (inline script in `_document.tsx`) that reads localStorage before React hydrates to prevent FOUC (flash of unstyled content).
7. Add Storybook stories for `ThemeToggle`.

**Expected Architecture:**

```
frontend/
├── lib/
│   └── ThemeContext.tsx       (NEW)
├── components/
│   ├── Navbar.tsx             (updated: add ThemeToggle)
│   └── ThemeToggle.tsx        (NEW)
├── styles/
│   └── globals.css            (refactored: light + dark)
├── tailwind.config.ts         (updated: class dark mode)
└── pages/
    └── _document.tsx          (updated: FOUC prevention)
```

**Acceptance Criteria:**
- [ ] Toggle switches between light and dark theme without page reload.
- [ ] "System" option follows OS preference, updating in real-time when OS setting changes.
- [ ] Preference persists across page reloads.
- [ ] No flash of wrong theme on page load (FOUC prevented).
- [ ] All existing components render correctly in light mode.
- [ ] Light mode has sufficient contrast ratios (WCAG AA minimum: 4.5:1 for normal text).

---

### Issue #23 — Accessibility (a11y) Audit & Remediation

**Labels:** `frontend` `accessibility` `a11y` `audit`

**Summary:** Conduct a comprehensive accessibility audit of the frontend application and remediate all WCAG 2.1 AA violations.

**Background:** The application uses Tailwind CSS with various interactive components (forms, modals, navigation, payment flows). No formal accessibility audit has been conducted. Components like `SendPaymentForm`, `MultiSigFlow`, and `BatchPaymentForm` have complex interactive states that likely have keyboard navigation and screen reader gaps.

**Problem Statement:** Financial applications must be accessible to all users. WCAG 2.1 AA compliance is a legal requirement in many jurisdictions and a prerequisite for institutional adoption.

**Objectives:**
1. Run automated accessibility audits using `axe-core` and `@axe-core/react`.
2. Perform manual keyboard navigation testing across all pages and components.
3. Fix all critical and serious violations.
4. Add ARIA labels, roles, and live regions where needed.
5. Ensure all interactive elements have visible focus indicators.
6. Add accessibility tests to the CI pipeline.

**Scope:**
- **In scope:** all pages (`/`, `/dashboard`, `/transactions`, `/escrow`, `/trade`, `/settings`, `/contacts`, `/pay`, `/request`, `/tip/[username]`), all interactive components.
- **Out of scope:** third-party iframes (Freighter extension), browser-native `<select>` styling.

**Detailed Implementation Requirements:**
1. Add `jest-axe` and `@axe-core/react` to `frontend/package.json`.
2. Run `jest-axe` on every component test:
   ```ts
   import { axe, toHaveNoViolations } from "jest-axe";
   expect.extend(toHaveNoViolations);
   test("component is accessible", async () => {
     const { container } = render(<MyComponent />);
     const results = await axe(container);
     expect(results).toHaveNoViolations();
   });
   ```
3. Common violations to fix (likely findings based on code review):
   - Add `aria-label` to icon-only buttons (e.g., edit/delete icons in `RecurringPayments.tsx` — `aria-label="Edit schedule"` already there, but check all).
   - Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to modals (`QuickSendModal`, `QRCodeModal`, `PaymentStatusModal`).
   - Add `aria-live="polite"` regions for status messages (batch payment status, payment success/error).
   - Ensure form inputs have associated `<label>` elements (some use `span.label` without `htmlFor`).
   - Add visible focus rings using `focus-visible:ring-2` Tailwind classes.
   - Add skip-to-content link as the first focusable element.
   - Ensure color is not the only means of conveying information (e.g., red/green status badges need icons or text).
4. Add keyboard navigation support:
   - `Esc` key closes modals.
   - `Enter`/`Space` activates all interactive elements.
   - Tab order is logical through multi-step flows (`MultiSigFlow`).
5. Add `frontend/__tests__/a11y.test.tsx` that renders each page and runs `axe()`.
6. Document accessibility features in a new `ACCESSIBILITY.md`.

**Expected Architecture:**

```
frontend/__tests__/
└── a11y.test.tsx             (NEW: automated accessibility tests)
components/
├── Navbar.tsx                (updated: skip-to-content, focus management)
├── QuickSendModal.tsx        (updated: aria-modal, keyboard)
├── QRCodeModal.tsx           (updated: aria-modal, keyboard)
├── PaymentStatusModal.tsx    (updated: aria-modal, aria-live)
└── MultiSigFlow.tsx          (updated: keyboard navigation)

ACCESSIBILITY.md              (NEW)
```

**Acceptance Criteria:**
- [ ] All pages pass `jest-axe` with 0 violations.
- [ ] All interactive elements are keyboard accessible (Tab, Enter, Space, Esc).
- [ ] All form inputs have associated labels.
- [ ] Modals trap focus and close on Esc.
- [ ] Screen reader announces dynamic content changes (status, errors, success).
- [ ] Skip-to-content link is present and functional.
- [ ] Focus indicators are visible on all interactive elements.

---

### Issue #24 — Offline Transaction Queue with Background Sync

**Labels:** `frontend` `pwa` `offline` `feature`

**Summary:** Implement an offline transaction queue that stores user-signed transactions when the network is unavailable and submits them automatically when connectivity returns.

**Background:** The application already has a PWA with a service worker (`frontend/public/sw.js`) and an `OfflineBanner` component (`frontend/components/OfflineBanner.tsx`). The service worker currently only caches static assets — it does not handle transaction queuing.

**Problem Statement:** Users in areas with intermittent connectivity (mobile, developing regions) cannot complete payments when offline. A transaction queue with background sync enables reliable payment submission regardless of network conditions.

**Objectives:**
1. Create a transaction queue service in `frontend/lib/offlineQueue.ts`.
2. Store signed XDR transactions in IndexedDB when offline.
3. Use the Background Sync API (`navigator.serviceWorker.ready.then(reg => reg.sync.register("submit-payments"))`) to trigger submission when online.
4. Update the service worker to handle `sync` events.
5. Show queue status in the Navbar and OfflineBanner.

**Scope:**
- **In scope:** offline transaction queuing, background sync, IndexedDB storage, UI indicators.
- **Out of scope:** offline contract interactions (requires full Soroban RPC mock), offline balance updates.

**Detailed Implementation Requirements:**
1. Create `frontend/lib/offlineQueue.ts`:
   ```ts
   interface QueuedTransaction {
     id: string;
     signedXDR: string;
     destination: string;
     amount: string;
     createdAt: number;
     status: "queued" | "submitting" | "submitted" | "failed";
     error?: string;
   }
   
   export async function queueTransaction(signedXDR: string, metadata: {...}): Promise<void>;
   export async function getQueuedTransactions(): Promise<QueuedTransaction[]>;
   export async function removeTransaction(id: string): Promise<void>;
   export async function processQueue(): Promise<void>;  // submits all queued
   ```
2. Use `idb` (IndexedDB wrapper) for storage.
3. Update `frontend/public/sw.js`:
   - Add `sync` event listener:
     ```js
     self.addEventListener("sync", (event) => {
       if (event.tag === "submit-payments") {
         event.waitUntil(submitQueuedPayments());
       }
     });
     ```
4. Update `frontend/components/OfflineBanner.tsx` to show queue count and "Retry" button.
5. Add a queue badge to `frontend/components/Navbar.tsx` showing pending count.
6. Update `frontend/lib/wallet.ts` and `frontend/lib/stellar.ts` to automatically queue when `navigator.onLine === false`.
7. Register background sync after successful Freighter signing when offline.
8. Add a `online` event listener that triggers `processQueue()`.
9. Add `frontend/__tests__/offlineQueue.test.ts` mocking IndexedDB and the Background Sync API.

**Expected Architecture:**

```
frontend/lib/
├── offlineQueue.ts           (NEW)
├── wallet.ts                 (updated: queue when offline)
└── stellar.ts                (updated: queue when offline)
frontend/public/
└── sw.js                     (updated: sync handler)
frontend/components/
├── OfflineBanner.tsx          (updated: queue status)
└── Navbar.tsx                 (updated: queue badge)
```

**Acceptance Criteria:**
- [ ] When offline, signed transactions are stored in IndexedDB with status "queued".
- [ ] When online, queued transactions are automatically submitted.
- [ ] Background Sync API is used to trigger submission even if the tab is closed.
- [ ] Failed submissions are retried on next connectivity event.
- [ ] Queue badge in Navbar shows pending count.
- [ ] OfflineBanner shows queue status and "Retry" button.
- [ ] Tests verify queue, persistence, and auto-submit.

---

### Issue #25 — Multi-Account Management

**Labels:** `frontend` `wallet` `multi-account` `feature`

**Summary:** Add support for managing multiple Stellar accounts within the Finchippay dashboard, with per-account balances, transaction history, and quick account switching.

**Background:** The current wallet integration (`frontend/lib/wallet.ts`, `frontend/components/WalletConnect.tsx`) supports connecting a single Freighter account. Freighter itself supports multiple accounts, but Finchippay only surfaces the first one. The `useWallet` hook (`frontend/lib/useWallet.tsx`) manages a single key.

**Problem Statement:** Users with multiple Stellar accounts (personal, business, savings) must disconnect and reconnect to switch between them. Multi-account management is a core wallet feature.

**Objectives:**
1. Update `useWallet` to support an array of connected accounts.
2. Add account switcher dropdown in the Navbar.
3. Add "Add Account" flow that connects an additional Freighter account.
4. Each account gets its own balance, payment history, and analytics.
5. Persist account list in localStorage.

**Scope:**
- **In scope:** parallel account connections, switcher UI, per-account data isolation, localStorage persistence.
- **Out of scope:** hardware wallet multi-account, cross-account transfers, aggregated analytics.

**Detailed Implementation Requirements:**
1. Update `frontend/lib/useWallet.tsx`:
   ```ts
   interface Account {
     publicKey: string;
     label?: string;    // user-assigned nickname
     isPrimary: boolean;
   }
   interface WalletState {
     accounts: Account[];
     activeAccountIndex: number;
     activeAccount: Account | null;
     setActiveAccount: (index: number) => void;
     addAccount: () => Promise<void>;
     removeAccount: (publicKey: string) => void;
   }
   ```
2. Update `WalletConnect.tsx`:
   - "Connect Wallet" becomes "Add Account" when at least one account is connected.
   - Account switcher renders as a dropdown with account labels and truncated public keys.
   - "Disconnect" → "Remove account" (with confirmation if it's the only one).
3. Update all pages (`dashboard`, `transactions`, `escrow`, etc.) to use `activeAccount` instead of the top-level public key.
4. Add a `label` field to stored accounts (editable from the settings page).
5. Add "Switch Account" keyboard shortcut (`Cmd+K` / `Ctrl+K`).
6. Persist `accounts` array to localStorage via `STORAGE_KEY = "finchippay:accounts"`.
7. Add `frontend/__tests__/wallet-multi-account.test.tsx` covering add, switch, remove, and persist.

**Expected Architecture:**

```
frontend/lib/
├── useWallet.tsx             (refactored: multi-account)
└── wallet.ts                 (unchanged: per-key operations)
frontend/components/
├── WalletConnect.tsx          (refactored: account switcher)
└── Navbar.tsx                 (updated: account picker)
frontend/pages/
└── settings.tsx              (updated: account labels)
```

**Acceptance Criteria:**
- [ ] Users can connect multiple Freighter accounts.
- [ ] Account switcher in Navbar shows all connected accounts with labels.
- [ ] Switching accounts updates balance, history, and analytics.
- [ ] Accounts persist across page reloads.
- [ ] Users can assign labels to accounts.
- [ ] Removing the last account disconnects the wallet entirely.
- [ ] `Cmd+K` / `Ctrl+K` opens account switcher.

---

### Issue #26 — CSV Export of Transaction History

**Labels:** `frontend` `export` `csv` `feature`

**Summary:** Add a CSV export button to the transactions page that downloads the user's full payment history as a CSV file with configurable date range and filters.

**Background:** The `frontend/pages/transactions.tsx` page displays paginated payment history from Horizon via the `TransactionList` component (`frontend/components/TransactionList.tsx`). There is no export functionality. The `ROADMAP.md` "Ideas" section lists "CSV export of payment history."

**Problem Statement:** Users need to export their transaction history for accounting, tax reporting, and record-keeping. Manual copy-paste is not viable for users with hundreds of transactions.

**Objectives:**
1. Add a "Download CSV" button to the transactions page.
2. Support filtering by date range, transaction type (sent/received/all), and asset.
3. Generate a well-formatted CSV with headers and proper escaping.
4. Support large datasets with streaming/chunked export.

**Scope:**
- **In scope:** CSV generation, date range filter, type filter, asset filter, download trigger.
- **Out of scope:** PDF export, XLSX export, automated scheduled exports.

**Detailed Implementation Requirements:**
1. Create `frontend/lib/exportTransactions.ts`:
   ```ts
   interface ExportOptions {
     publicKey: string;
     startDate?: Date;
     endDate?: Date;
     type?: "all" | "sent" | "received";
     asset?: string;
   }
   export async function exportTransactionsCSV(options: ExportOptions): Promise<string>;
   ```
2. Implementation:
   - Fetch all transactions for the public key using cursor-based pagination (up to 10,000 transactions).
   - Apply client-side filtering by date range, type, and asset.
   - Generate CSV string with columns: `Date, Type, Amount, Asset, Counterparty, Memo, Transaction Hash`.
   - Properly escape values containing commas, quotes, or newlines.
   - Add BOM (`\uFEFF`) for Excel UTF-8 compatibility.
3. Add `ExportModal` component (`frontend/components/ExportModal.tsx`):
   - Date range picker (start/end date inputs).
   - Type filter dropdown (All, Sent, Received).
   - Asset filter dropdown (populated from transaction history).
   - "Export CSV" button that triggers download.
   - Progress indicator for large datasets.
4. Add `DownloadIcon` to `frontend/components/icons/index.tsx`.
5. Add the export button to the transaction list header area.
6. Use `Blob` and `URL.createObjectURL` with a temporary `<a>` element for download (avoid `download` attribute limitations).
7. Add `frontend/__tests__/exportTransactions.test.ts`.

**Expected Architecture:**

```
frontend/lib/
└── exportTransactions.ts    (NEW)
frontend/components/
├── ExportModal.tsx           (NEW)
└── icons/index.tsx           (+ DownloadIcon)
frontend/pages/
└── transactions.tsx          (updated: export button + modal)
```

**Acceptance Criteria:**
- [ ] "Download CSV" button is visible on the transactions page.
- [ ] Export modal allows filtering by date range, type, and asset.
- [ ] Downloaded CSV opens correctly in Excel and Google Sheets.
- [ ] CSV contains proper headers and all relevant columns.
- [ ] Special characters (commas, quotes) in memos are properly escaped.
- [ ] Export handles up to 10,000 transactions without browser freeze.
- [ ] Progress is shown during export generation.

---

### Issue #27 — Advanced Analytics Dashboard with Date Range Filtering

**Labels:** `frontend` `analytics` `charts` `feature`

**Summary:** Enhance the dashboard analytics with interactive date range filtering, additional chart types, and per-asset breakdowns.

**Background:** The dashboard (`frontend/pages/dashboard.tsx`) currently shows basic analytics (total sent/received, top recipients, activity by day of week) computed from the `/api/analytics/:publicKey/summary` endpoint. The backend `analyticsService.js` aggregates from the last 100 payments. There is no date range filtering, no volume-over-time chart, and no per-asset breakdown.

**Problem Statement:** The current analytics provide a snapshot but no ability to explore trends over time. Users cannot see their spending patterns by month, compare different time periods, or analyze per-asset activity.

**Objectives:**
1. Add `GET /api/analytics/:publicKey/timeseries?startDate=X&endDate=Y&asset=Z` backend endpoint.
2. Add time-series line/bar chart to the dashboard using a lightweight charting library.
3. Add date range picker to the analytics section.
4. Add per-asset breakdown pie/donut chart.
5. Add monthly comparison metrics (vs. previous month).

**Scope:**
- **In scope:** time-series chart, date range filtering, per-asset breakdown, monthly comparison.
- **Out of scope:** predictive analytics, export-as-image, custom dashboard layouts.

**Detailed Implementation Requirements:**
1. Add a lightweight charting library to `frontend/package.json` (recommend `recharts` since it's React-native and tree-shakeable, or `chart.js` with `react-chartjs-2`).
2. Add `GET /api/analytics/:publicKey/timeseries` endpoint in `backend/src/routes/analytics.js`:
   - Query params: `startDate`, `endDate`, `asset`, `granularity` (day/week/month).
   - Returns: `{ data: [{ period: "2026-01", sent: "100", received: "50", volume: "150" }, ...] }`.
3. Update `backend/src/services/analyticsService.js` to support date range filtering and time-series aggregation.
4. Create `frontend/components/AnalyticsCharts.tsx`:
   - `VolumeOverTimeChart` — line/bar chart showing sent vs received vs net over time.
   - `AssetBreakdownChart` — pie chart showing allocation across assets.
   - `MonthlyComparison` — card showing this month vs last month with % change indicators.
5. Add `DateRangePicker` component (two date inputs with validation).
6. Add charts section below the existing analytics cards on the dashboard.
7. Add a loading skeleton while charts are fetching.
8. Add `frontend/__tests__/AnalyticsCharts.test.tsx` and `frontend/stories/AnalyticsCharts.stories.tsx`.

**Expected Architecture:**

```
backend/src/
├── routes/analytics.js       (+ timeseries endpoint)
└── services/analyticsService.js  (updated: date range + time-series)

frontend/
├── components/
│   └── AnalyticsCharts.tsx   (NEW)
├── pages/
│   └── dashboard.tsx         (updated: charts section)
└── stories/
    └── AnalyticsCharts.stories.tsx (NEW)
```

**Acceptance Criteria:**
- [ ] Time-series chart renders with configurable date range.
- [ ] Asset breakdown chart shows allocation percentages.
- [ ] Monthly comparison cards show % change from previous period.
- [ ] Charts are responsive and display correctly on mobile.
- [ ] Empty state is handled gracefully (no data for selected range).
- [ ] Chart colors meet WCAG contrast requirements with both light and dark themes.

---

### Issue #28 — Network Fee Estimator

**Labels:** `frontend` `fees` `ux` `feature`

**Summary:** Add a real-time fee estimator to the SendPaymentForm and BatchPaymentForm that displays the estimated transaction fee in XLM based on current network conditions.

**Background:** Stellar transaction fees are nominally 100 stroops (0.00001 XLM) per operation but can increase during network congestion. The `frontend/components/SendPaymentForm.tsx` and `frontend/components/BatchPaymentForm.tsx` do not display estimated fees. Users may be confused when their balance is sufficient for the payment amount but not for the total (amount + fee).

**Problem Statement:** Users need to know the total cost (amount + fees) before signing a transaction. Without fee estimation, users may encounter unexpected failures when their balance after fees is insufficient.

**Objectives:**
1. Fetch current network fee stats from Horizon's `/fee_stats` endpoint.
2. Display estimated fee for the current transaction in the payment form UI.
3. For batch payments, show per-recipient fee and total batch fee.
4. Show a warning when the user's balance is insufficient to cover amount + fees.
5. Allow users to select fee tier (low/medium/high) for time-sensitive transactions.

**Scope:**
- **In scope:** fee estimation display, balance-sufficiency warning, fee tier selection.
- **Out of scope:** dynamic fee bumping (RBF), fee sponsorship.

**Detailed Implementation Requirements:**
1. Create `frontend/lib/fees.ts`:
   ```ts
   interface FeeStats {
     min: number;      // 100 stroops
     mode: number;     // most common fee
     p50: number;      // median
     p95: number;      // high congestion
     p99: number;      // peak congestion
     lastLedger: number;
     max: number;      // network maximum
   }
   export async function getFeeStats(): Promise<FeeStats>;
   export function estimateTransactionFee(operationCount: number, feePerOp: number): string;
   ```
2. Fetch from Horizon's `GET /fee_stats` endpoint (cached for 60 seconds).
3. Create `FeeDisplay` component:
   - Shows estimated fee in XLM with stroop precision.
   - Dropdown to select: Economy (p50), Standard (p95), Priority (p99).
   - For batch: shows "XLM {perTx} × {count} = {total} XLM" breakdown.
4. Add fee display to `SendPaymentForm.tsx`:
   - Below the amount input, show: "Estimated fee: 0.00001 XLM".
   - Update the balance check to: `availableBalance >= amount + estimatedFee`.
   - Show warning when `balance >= amount` but `balance < amount + fee`.
5. Pass fee selection as `fee` parameter to `buildPaymentTransaction` in `frontend/lib/stellar.ts`.
6. Add `frontend/__tests__/fees.test.ts`.

**Expected Architecture:**

```
frontend/lib/
└── fees.ts                   (NEW)
frontend/components/
├── SendPaymentForm.tsx       (updated: fee display + balance check)
└── BatchPaymentForm.tsx      (updated: fee display)
```

**Acceptance Criteria:**
- [ ] Fee estimate is displayed on the send payment form.
- [ ] Fee tier selector (Economy/Standard/Priority) is available.
- [ ] Balance check accounts for the estimated fee.
- [ ] Warning is shown when balance covers amount but not amount + fee.
- [ ] Batch payment form shows total fee across all recipients.
- [ ] Fee stats are cached and refreshed periodically.
- [ ] Fee estimate defaults to `p95` (Standard).

---

### Issue #29 — Transaction Simulation Before Signing

**Labels:** `frontend` `soroban` `safety` `feature`

**Summary:** Add a transaction simulation step that previews the outcome of a Soroban invocation before the user signs, showing token balance changes, expected fees, and potential errors.

**Background:** All contract interactions go through Soroban RPC. The `simulateTransaction` RPC method runs a transaction against the current ledger state without submitting it, returning the computed footprint, results, and any errors. Currently, Finchippay does not use this — transactions are built, signed, and submitted without preview.

**Problem Statement:** Users have no way to verify what a contract interaction will do before signing. This increases the risk of mistakes (wrong amount, unexpected fees, failing transactions) and lowers trust in the smart contract.

**Objectives:**
1. Add `simulateTransaction` call in the Soroban client (`frontend/lib/soroban.ts` from Issue #21).
2. Create a `TransactionPreview` modal that shows simulation results before signing.
3. Display: token balance changes (before → after), estimated resource fees, operation result.
4. Highlight potential errors (e.g., "Escrow release ledger not yet reached") before the user signs.
5. Integrate with escrow, streaming, and multi-sig flows.

**Scope:**
- **In scope:** Soroban simulation, preview modal, integration with contract interaction flows.
- **Out of scope:** simulating Stellar payment transactions (only Soroban invocations).

**Detailed Implementation Requirements:**
1. Add `simulateTransaction(xdr: string)` to `frontend/lib/soroban.ts`:
   ```ts
   interface SimulationResult {
     success: boolean;
     result?: any;            // decoded return value
     error?: string;          // contract error message if any
     footprint: object;
     resourceFee: string;     // in stroops
     balanceChanges: Array<{ address: string; asset: string; before: string; after: string }>;
   }
   ```
2. Create `frontend/components/TransactionPreview.tsx`:
   - Modal with sections: "Balance Changes", "Resource Fee", "Operation Result".
   - Green/red color coding for positive/negative balance changes.
   - Error section with human-readable message mapped from `ContractError`.
   - "Looks good — sign transaction" primary button.
   - "Cancel" secondary button.
3. Integrate into flows:
   - Escrow page: preview `create_escrow`, `claim_escrow`, `cancel_escrow`.
   - Streaming: preview `claim_stream`, `close_stream`.
   - Multi-sig: preview `approve_multisig`.
4. Handle `simulateTransaction` errors gracefully — if simulation fails (e.g., RPC unavailable), skip preview and proceed directly to signing with a warning.
5. Add loading skeleton while simulation is in progress.
6. Add `frontend/__tests__/TransactionPreview.test.tsx` and `frontend/stories/TransactionPreview.stories.tsx`.

**Expected Architecture:**

```
frontend/lib/
└── soroban.ts                (+ simulateTransaction)
frontend/components/
└── TransactionPreview.tsx    (NEW)
frontend/pages/
├── escrow.tsx                (updated: preview before sign)
└── StreamingPayments.tsx     (updated: preview before sign)
```

**Acceptance Criteria:**
- [ ] Before signing a Soroban transaction, a preview modal shows simulation results.
- [ ] Balance changes are displayed with before/after amounts.
- [ ] Contract errors (e.g., "release_ledger not reached") are surfaced before signing.
- [ ] Resource fees are shown in XLM.
- [ ] If simulation fails, a warning is shown but the user can still proceed.
- [ ] Preview is integrated into escrow, streaming claim, and multi-sig flows.

---

### Issue #30 — Ledger Hardware Wallet Support

**Labels:** `frontend` `wallet` `ledger` `hardware` `feature`

**Summary:** Implement Ledger hardware wallet support in addition to Freighter, allowing users to sign transactions with a Ledger Nano S/X device.

**Background:** `frontend/lib/wallet.ts` has placeholder functions for Ledger support (`isLedgerSupported`, `signTransactionWithLedger`, `getLedgerPublicKey`) that all return `{ error: "Ledger support not implemented." }`. The existing wallet connect flow only supports Freighter.

**Problem Statement:** Hardware wallet support is essential for users managing significant funds. Ledger is the most popular hardware wallet for Stellar, and its absence limits Finchippay's adoption among security-conscious users.

**Objectives:**
1. Implement Ledger Stellar app communication via `@ledgerhq/hw-transport-webusb` and `@stellar/stellar-sdk`.
2. Update `WalletConnect` to offer a wallet selection screen (Freighter or Ledger).
3. Implement `signTransactionWithLedger` and `getLedgerPublicKey`.
4. Support Ledger for all transaction types: payments, contract interactions, multi-sig, SEP-0010 auth.

**Scope:**
- **In scope:** Ledger via WebUSB, wallet selection UI, transaction signing, SEP-0010 auth.
- **Out of scope:** Ledger via Bluetooth (mobile), Trezor support, Ledger Stax frame support.

**Detailed Implementation Requirements:**
1. Add `@ledgerhq/hw-transport-webusb` and `@ledgerhq/hw-app-str` to `frontend/package.json`.
2. Implement `frontend/lib/wallet.ts` Ledger functions:
   ```ts
   export async function connectLedger(): Promise<{ publicKey: string | null; error: string | null }>;
   export async function signTransactionWithLedger(xdr: string, publicKey: string): Promise<{ signedXDR: string | null; error: string | null }>;
   export async function getLedgerPublicKey(): Promise<{ publicKey: string | null; error: string | null }>;
   ```
3. Update `WalletConnect.tsx`:
   - On "Connect Wallet", show a modal with two options: "Freighter (Browser Extension)" and "Ledger (Hardware Wallet)".
   - For Ledger: show step-by-step instructions (connect device, open Stellar app, confirm on device).
   - On successful connection, store wallet type in state (`"freighter" | "ledger"`).
   - The `useWallet` hook should track wallet type and route signing to the appropriate method.
4. Update `signTransactionWithWallet` to dispatch to the active wallet type.
5. Add Ledger-specific error handling:
   - Device not connected → prompt to connect.
   - Stellar app not open → prompt to open.
   - User rejected on device → friendly message.
   - Ledger locked → prompt to unlock.
6. Test with Ledger Stellar app on Stellar testnet.
7. Add `frontend/__tests__/wallet-ledger.test.ts` with mocked Ledger transport.

**Expected Architecture:**

```
frontend/lib/
└── wallet.ts                 (implement Ledger placeholders)
frontend/components/
└── WalletConnect.tsx         (updated: wallet selector modal)
```

**Acceptance Criteria:**
- [ ] Wallet connect modal offers choice between Freighter and Ledger.
- [ ] Ledger connects via WebUSB and retrieves the user's public key.
- [ ] Transactions can be signed with Ledger (tested on testnet).
- [ ] SEP-0010 auth flow works with Ledger.
- [ ] Clear error messages guide the user when Ledger is not connected/unlocked.
- [ ] Switching between Freighter and Ledger does not lose account data.

---

### Issue #31 — NFT Receipt Gallery

**Labels:** `frontend` `nft` `receipts` `feature`

**Summary:** Build an NFT receipt gallery page that displays all payment receipts minted via the `mint_receipt` contract function, with metadata display and sharing capabilities.

**Background:** The `FinchippayContract` has a `mint_receipt` function and `ReceiptMetadata` struct (`lib.rs` line ~85) that stores payment receipt metadata on-chain. However, there is no frontend UI to view these receipts.

**Problem Statement:** Users who mint receipts have no way to view or share them. The contract produces the data but the frontend provides no gallery or detail view.

**Objectives:**
1. Create a `/receipts` page that lists all receipts for the connected user.
2. Display receipt details: from, to, amount, timestamp, memo, ledger.
3. Add receipt detail view with a shareable link.
4. Add a "Mint Receipt" button on the payment success screen.

**Scope:**
- **In scope:** receipt listing, detail view, mint UI, shareable links.
- **Out of scope:** NFT marketplace integration, receipt image generation, IPFS metadata.

**Detailed Implementation Requirements:**
1. Create `frontend/pages/receipts.tsx`:
   - Fetches receipts using the Soroban client's `get_receipt_count` + `get_receipt` loop.
   - Renders as a grid of receipt cards with: recipient, amount, memo, date.
   - Empty state: "No receipts minted yet."
   - Loading state with skeleton cards.
2. Create `frontend/components/ReceiptCard.tsx`:
   - Card with glassmorphism style.
   - Shows: receipt index, from (truncated), to (truncated), amount, memo, timestamp, ledger.
   - "View Details" button.
3. Create `frontend/components/ReceiptDetail.tsx`:
   - Modal or full-page view.
   - All receipt fields displayed.
   - "Copy Share Link" button that copies a URL like `/{username}/receipts/{index}`.
4. Create `frontend/pages/[username]/receipt/[index].tsx` — public receipt view page.
5. Update `frontend/components/SendPaymentForm.tsx` to show "Mint Receipt" checkbox (default: unchecked). When checked, after successful payment, call `mint_receipt` on the contract.
6. Add `frontend/__tests__/ReceiptCard.test.tsx` and `frontend/stories/ReceiptCard.stories.tsx`.

**Expected Architecture:**

```
frontend/pages/
├── receipts.tsx              (NEW)
└── [username]/receipt/
    └── [index].tsx           (NEW: public view)
frontend/components/
├── ReceiptCard.tsx           (NEW)
└── ReceiptDetail.tsx         (NEW)
frontend/stories/
├── ReceiptCard.stories.tsx   (NEW)
```

**Acceptance Criteria:**
- [ ] `/receipts` page lists all minted receipts for the connected user.
- [ ] Receipt cards show key metadata (amount, counterparty, memo, date).
- [ ] "Mint Receipt" option on send payment form triggers on-chain receipt minting.
- [ ] Shareable receipt URLs display receipt details publicly.
- [ ] Empty state and loading state are handled.
- [ ] Receipts are paginated if more than 20 exist.

---

### Issue #32 — Push Notification Webhooks via Web Push API

**Labels:** `frontend` `notifications` `push` `pwa` `feature`

**Summary:** Complete the browser push notification implementation for payment events, scheduled payment reminders, and multi-sig approval requests.

**Background:** The `frontend/pages/dashboard.tsx` contains a large comment block describing the Push API flow (register service worker, request notification permission, subscribe with VAPID key). However, the actual implementation is incomplete — the VAPID key generation and subscription flow are not fully wired. The `ROADMAP.md` v2.0 lists "Push notification webhooks via web-push" as planned.

**Problem Statement:** Users have no way to receive notifications when they receive payments, when scheduled payments are due, or when their multi-sig approval is needed.

**Objectives:**
1. Complete the VAPID key generation and server-side push delivery infrastructure.
2. Add push notification preferences to the settings page.
3. Send push notifications for: payment received, scheduled payment due, multi-sig approval needed, escrow release reminder.
4. Implement notification click handling (navigate to relevant page).

**Scope:**
- **In scope:** VAPID setup, subscription management, push delivery for payment/schedule/multi-sig events, settings UI.
- **Out of scope:** email notifications, SMS notifications, in-app notification center.

**Detailed Implementation Requirements:**
1. Generate VAPID keys and add to backend env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
2. Add `web-push` to `backend/package.json`.
3. Create `backend/src/services/pushService.js`:
   - `sendPushNotification(subscription, payload)` — uses `web-push.sendNotification`.
   - `notifyPaymentReceived(publicKey, payment)` — look up user's subscriptions, send "You received X XLM from G..."
   - `notifyScheduledDue(publicKey, schedule)` — send reminder.
   - `notifyMultiSigNeeded(publicKey, proposalId)` — send "Your approval is needed for a multi-sig payment".
4. Update `frontend/public/sw.js`:
   - Add `push` event listener that calls `self.registration.showNotification(title, options)`.
   - Add `notificationclick` event listener that focuses or opens the relevant page.
5. Create `frontend/lib/notifications.ts`:
   - `requestNotificationPermission() → "granted" | "denied" | "default"`.
   - `subscribeToPush() → PushSubscription`.
   - `saveSubscription(subscription)` → POST to backend.
6. Add notification settings to `frontend/pages/settings.tsx`:
   - Toggle: "Enable push notifications".
   - Sub-toggles: "Payment received", "Scheduled payment due", "Multi-sig approval needed".
   - Show subscription status.
7. Wire push notifications into the backend's webhook service and scheduled transaction service.

**Expected Architecture:**

```
backend/src/
├── services/
│   └── pushService.js        (NEW)
├── routes/
│   └── push.js               (NEW: POST /api/push/subscribe, DELETE /api/push/unsubscribe)
└── config/
    └── validateEnv.js        (+ VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

frontend/
├── lib/
│   └── notifications.ts     (NEW)
├── public/
│   └── sw.js                 (updated: push + notificationclick handlers)
└── pages/
    └── settings.tsx          (updated: notification preferences)
```

**Acceptance Criteria:**
- [ ] Users can enable/disable push notifications from the settings page.
- [ ] Payments received trigger a browser push notification with amount and sender.
- [ ] Scheduled payments due trigger a reminder notification.
- [ ] Multi-sig approval requests trigger a notification with a link to the signing page.
- [ ] Clicking a notification navigates to the relevant page.
- [ ] Notifications work when the app is in the background.
- [ ] VAPID keys are properly managed (not hardcoded).

---

### Issue #33 — Mobile-Responsive PWA Improvements

**Labels:** `frontend` `mobile` `pwa` `responsive` `enhancement`

**Summary:** Audit and improve the mobile responsiveness of all pages, optimise PWA install experience, and implement mobile-specific interaction patterns.

**Background:** The `ROADMAP.md` v2.0 lists "Mobile-responsive PWA improvements" as planned. The app has a `manifest.json` and service worker but several pages use desktop-oriented layouts (multi-column dashboards, complex forms). The `OfflineBanner` exists but the offline experience is limited.

**Problem Statement:** Users on mobile devices encounter layout issues, difficult touch targets, and a suboptimal PWA experience. The app should feel native on mobile.

**Objectives:**
1. Audit all pages at 375px and 414px viewport widths.
2. Fix layout issues: stacked columns where appropriate, bottom navigation for mobile, full-width cards.
3. Ensure all touch targets are ≥44x44px (WCAG 2.5.5).
4. Add pull-to-refresh on the transaction list.
5. Add swipe gestures where appropriate.
6. Implement a mobile bottom navigation bar.
7. Improve the PWA splash screen and install prompt.

**Scope:**
- **In scope:** responsive layouts, touch targets, bottom nav, pull-to-refresh, swipe gestures.
- **Out of scope:** native mobile app (React Native), tablet-specific layouts.

**Detailed Implementation Requirements:**
1. Audit using Chrome DevTools device emulation at 375px (iPhone SE) and 414px (iPhone 11).
2. Fix identified issues:
   - `frontend/pages/dashboard.tsx` — ensure the stats grid stacks on mobile, charts are full-width.
   - `frontend/components/SendPaymentForm.tsx` — input fields full-width on mobile, button full-width.
   - `frontend/components/BatchPaymentForm.tsx` — form fields stack vertically.
   - `frontend/components/Navbar.tsx` — implement hamburger menu on mobile.
   - `frontend/pages/escrow.tsx` — form inputs stack vertically.
3. Create `frontend/components/MobileBottomNav.tsx`:
   - Fixed bottom bar with 4-5 icon buttons: Home, Send, Transactions, Settings.
   - Visible only on screens <768px.
   - Active state for current page.
   - Badge for pending notifications/queue.
4. Add pull-to-refresh to `TransactionList` using a touch event handler (or a small library).
5. Add swipe-to-dismiss for toast notifications in `Toast.tsx`.
6. Update `manifest.json`:
   - Add `screenshots` for PWA install prompt.
   - Set `display: "standalone"`, `orientation: "any"`.
   - Add `shortcuts` for quick actions (Send, Scan QR).
7. Ensure minimum touch target size of 44x44px for all interactive elements (buttons, links, form controls).
8. Test the PWA "Add to Home Screen" flow on both Android (Chrome) and iOS (Safari).
9. Add viewport meta tag verification in `_document.tsx`.

**Expected Architecture:**

```
frontend/components/
├── MobileBottomNav.tsx       (NEW)
├── Navbar.tsx                (updated: hamburger menu)
├── SendPaymentForm.tsx       (updated: responsive)
└── BatchPaymentForm.tsx      (updated: responsive)
frontend/pages/
├── dashboard.tsx             (updated: responsive)
├── escrow.tsx                (updated: responsive)
└── transactions.tsx          (updated: pull-to-refresh)
frontend/public/
└── manifest.json             (updated: screenshots, shortcuts)
```

**Acceptance Criteria:**
- [ ] All pages are fully usable at 375px width without horizontal scroll.
- [ ] All touch targets are ≥44x44px.
- [ ] Mobile bottom navigation bar appears on screens <768px.
- [ ] Hamburger menu works correctly on mobile.
- [ ] Pull-to-refresh works on the transaction list.
- [ ] PWA manifest includes screenshots and shortcuts.
- [ ] "Add to Home Screen" prompt triggers on eligible devices.

---

### Issue #34 — Complete i18n Translation Coverage

**Labels:** `frontend` `i18n` `internationalization` `enhancement`

**Summary:** Complete the internationalization (i18n) coverage for all user-facing strings across all pages and components, ensuring full translation into English, Spanish, and French.

**Background:** The project has i18n infrastructure set up: `frontend/lib/i18n.ts`, `frontend/public/locales/en/common.json`, `es/common.json`, and `fr/common.json`. The `ROADMAP.md` notes "Multi-language i18n support (English, Spanish, French) ✅" as shipped. However, a quick audit reveals many hardcoded English strings throughout components.

**Problem Statement:** Despite having i18n infrastructure, many components and pages still use hardcoded English strings, making the translation coverage incomplete and inconsistent.

**Objectives:**
1. Audit all user-facing strings across all pages and components for i18n coverage.
2. Extract hardcoded strings into translation keys.
3. Provide complete translations for English, Spanish, and French.
4. Add an i18n lint rule to CI that flags hardcoded user-facing strings.

**Scope:**
- **In scope:** all user-facing strings in pages, components, and error messages.
- **Out of scope:** RTL language support (covered in Issue #38), additional languages.

**Detailed Implementation Requirements:**
1. Create an i18n audit script (`scripts/audit-i18n.js`) that scans for hardcoded English strings in JSX text content and component props.
2. Extract all found strings into namespace-organized JSON keys in each locale file.
3. Add missing keys to `en/common.json`:
   - `errors.*` — all error messages.
   - `nav.*` — navigation items, breadcrumbs.
   - `payment.*` — payment form labels, buttons, statuses.
   - `escrow.*` — escrow form labels, statuses.
   - `streaming.*` — streaming payment labels.
   - `multisig.*` — multi-sig flow labels.
   - `batch.*` — batch payment form labels.
   - `tips.*` — tip widget labels.
   - `settings.*` — settings page labels.
   - `analytics.*` — analytics labels.
   - `common.*` — shared buttons (Cancel, Save, Submit, etc.).
4. Create complete `es/common.json` and `fr/common.json` files (use professional translation or a reputable translation API).
5. Add a `useTranslation` hook wrapper that provides typed translation keys.
6. Add i18n interpolation for dynamic values (e.g., "You sent {{amount}} XLM to {{recipient}}").
7. Add a pre-commit or CI step that warns on untranslated keys.
8. Add a language switcher to the Navbar (currently only settings-based).

**Expected Architecture:**

```
frontend/public/locales/
├── en/common.json            (expanded: full coverage)
├── es/common.json            (expanded: full coverage)
└── fr/common.json            (expanded: full coverage)
scripts/
└── audit-i18n.js             (NEW)
```

**Acceptance Criteria:**
- [ ] All user-facing strings use the `t()` function from `useTranslation`.
- [ ] English, Spanish, and French locale files contain all keys.
- [ ] Language switcher in Navbar changes the app language without reload.
- [ ] Numbers and dates are formatted according to locale.
- [ ] No hardcoded English strings remain in JSX (enforced by audit script).
- [ ] Audit script runs in CI and fails if untranslated strings are found.

---

### Issue #35 — Real-Time Balance via Server-Sent Events (SSE)

**Labels:** `frontend` `realtime` `sse` `performance`

**Summary:** Replace the dashboard's periodic polling for balance updates with a Server-Sent Events (SSE) connection that pushes balance changes in real-time.

**Background:** The dashboard currently polls `/api/accounts/:publicKey/balance` on an interval (likely via `useEffect` with `setInterval`). This creates unnecessary network traffic and delays balance updates. There is no real-time data feed.

**Problem Statement:** Polling is inefficient — it creates unnecessary load on the backend and Horizon, and users see stale balances between polling intervals (potentially 10-30 seconds).

**Objectives:**
1. Create an SSE endpoint `GET /api/accounts/:publicKey/stream` that pushes balance updates.
2. Use Horizon's SSE payment stream (`/accounts/:id/payments?cursor=now`) to detect balance changes.
3. Update the frontend's `useWallet` hook to consume the SSE stream.
4. Fall back to polling when SSE is not supported or the connection fails.

**Scope:**
- **In scope:** SSE endpoint for balance, frontend SSE consumer, Horizon cursor tracking, fallback polling.
- **Out of scope:** WebSocket upgrade, GraphQL subscriptions.

**Detailed Implementation Requirements:**
1. Create `GET /api/accounts/:publicKey/stream` in `backend/src/routes/accounts.js`:
   - Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
   - Opens a Horizon SSE stream for the account's payment operations.
   - On each payment event affecting the account: fetch the new balance, push as SSE event.
   - Send heartbeat comment (`: heartbeat`) every 30 seconds to keep connection alive.
   - On client disconnect: clean up the Horizon stream.
2. Create `frontend/lib/useBalanceStream.ts`:
   ```ts
   export function useBalanceStream(publicKey: string | null): {
     xlmBalance: string;
     isLive: boolean;
     error: string | null;
   }
   ```
   - Opens `EventSource` to the SSE endpoint.
   - On `balance` event: update the balance state.
   - On error: close connection and fall back to polling (every 30 seconds via `useEffect` + `setInterval`).
3. Update `frontend/pages/dashboard.tsx` to use `useBalanceStream` instead of manual polling.
4. Update `frontend/components/SendPaymentForm.tsx` to use the streamed balance.
5. Add reconnection logic with exponential backoff (1s, 2s, 4s, 8s, max 30s).
6. Handle page visibility: pause stream when tab is hidden (`document.visibilitychange`).

**Expected Architecture:**

```
backend/src/routes/
└── accounts.js               (+ SSE stream endpoint)

frontend/lib/
└── useBalanceStream.ts       (NEW)
frontend/pages/
└── dashboard.tsx             (updated: useBalanceStream)
```

**Acceptance Criteria:**
- [ ] `GET /api/accounts/:pk/stream` pushes balance updates via SSE.
- [ ] Balance updates in the dashboard are near-real-time (<2s delay after payment).
- [ ] Connection gracefully falls back to polling on SSE failure.
- [ ] Heartbeat keeps the connection alive.
- [ ] Stream pauses when the browser tab is hidden.
- [ ] Multiple tabs do not create duplicate Horizon streams.
- [ ] Server cleans up Horizon streams on client disconnect.

---

### Issue #36 — Address Book Import/Export (CSV & vCard)

**Labels:** `frontend` `contacts` `import-export` `feature`

**Summary:** Add CSV and vCard import/export functionality to the address book, allowing users to bulk-manage their saved contacts.

**Background:** The address book (`frontend/lib/addressBook.ts`) stores contacts in localStorage with fields for name, Stellar address, and optional federation username. The contacts page (`frontend/pages/contacts.tsx`) provides add/edit/delete but no import/export.

**Problem Statement:** Users migrating from other wallets or managing large contact lists need bulk import/export. Manual entry of dozens of contacts is a poor user experience.

**Objectives:**
1. Add CSV export of all saved contacts.
2. Add CSV import with validation (Stellar address format, duplicate detection, field mapping).
3. Add vCard export for individual contacts (or all as a `.vcf`).
4. Add "Import Contacts" and "Export Contacts" buttons to the contacts page.

**Scope:**
- **In scope:** CSV import/export, vCard export, validation, duplicate handling.
- **Out of scope:** contact sync across devices, cloud backup, LDAP/Active Directory integration.

**Detailed Implementation Requirements:**
1. Create `frontend/lib/contactImportExport.ts`:
   ```ts
   interface ContactRow { name: string; address: string; federation?: string; }
   
   export function exportContactsCSV(contacts: ContactRow[]): string;
   export function parseContactsCSV(csv: string): { contacts: ContactRow[]; errors: string[] };
   export function exportContactVCard(contact: ContactRow): string;
   export function exportContactsVCard(contacts: ContactRow[]): string;
   ```
2. CSV format:
   ```csv
   Name,Stellar Address,Federation Username
   Alice,GABC123...,alice*example.com
   Bob,GXYZ789...,bob*example.com
   ```
3. CSV import logic:
   - Parse with `papaparse` (already installed? check) or manual CSV parser.
   - Validate each row: valid Stellar address (`isValidStellarAddress` from `frontend/lib/stellar.ts`).
   - Detect duplicates against existing contacts.
   - Return `{ contacts, errors }` — show import preview with errors highlighted.
4. Create `frontend/components/ContactImportModal.tsx`:
   - File upload (drag-and-drop or click to browse).
   - Parse and preview imported contacts.
   - Show validation errors per row.
   - "Skip duplicates" / "Overwrite duplicates" option.
   - "Import {N} contacts" button.
5. Add buttons to `frontend/pages/contacts.tsx`:
   - "Import" → opens `ContactImportModal`.
   - "Export CSV" → downloads CSV file.
   - "Export vCard" → downloads VCF file.
6. Add `frontend/__tests__/contactImportExport.test.ts`.

**Expected Architecture:**

```
frontend/lib/
└── contactImportExport.ts    (NEW)
frontend/components/
└── ContactImportModal.tsx    (NEW)
frontend/pages/
└── contacts.tsx              (updated: import/export buttons)
```

**Acceptance Criteria:**
- [ ] "Export CSV" downloads a valid CSV with all contacts.
- [ ] "Export vCard" downloads a valid VCF file.
- [ ] CSV import parses and validates contacts.
- [ ] Import preview shows contacts with errors highlighted.
- [ ] Duplicate detection offers skip/overwrite options.
- [ ] Invalid Stellar addresses in import are flagged.
- [ ] Imported contacts appear in the address book after confirmation.

---

### Issue #37 — Token List Browser with Asset Discovery

**Labels:** `frontend` `tokens` `assets` `discovery` `feature`

**Summary:** Add a token/assets browser page that displays known Stellar assets (SAC tokens), their metadata, and allows users to add trustlines and view balances.

**Background:** The application currently focuses on XLM payments. The dashboard shows account balances including non-native assets, but there is no way to discover, learn about, or manage trustlines for Stellar assets. The trade page (`frontend/pages/trade.tsx`) allows trading but doesn't help discover tokens.

**Problem Statement:** Stellar has a rich ecosystem of assets (USDC, EURT, etc.), but Finchippay users have no way to discover and manage them beyond what appears in their balance list.

**Objectives:**
1. Create a `/tokens` page with a searchable, filterable list of known Stellar assets.
2. Fetch asset metadata from the Stellar TOML files (SEP-0001).
3. Show trustline status (trusted/not trusted) for the connected account.
4. Add "Add Trustline" action that builds and submits a `change_trust` operation.
5. Display asset icons, codes, issuers, and descriptions.

**Scope:**
- **In scope:** token listing, search/filter, trustline management, TOML metadata.
- **Out of scope:** token price data (use DEX for that), user-added custom tokens (future).

**Detailed Implementation Requirements:**
1. Create `frontend/pages/tokens.tsx`:
   - Search bar for filtering by asset code or issuer.
   - Grid/list of token cards showing: icon, code, issuer (truncated), domain, description.
   - Badge: "Trusted ✓" or "Add Trustline" button.
   - "Add Trustline" triggers a `change_trust` transaction.
2. Create `frontend/lib/assetDiscovery.ts`:
   ```ts
   interface AssetInfo {
     code: string;
     issuer: string;
     domain?: string;
     image?: string;       // from TOML
     description?: string; // from TOML
     isTrusted: boolean;
     balance?: string;
   }
   export async function getKnownAssets(network: string): Promise<AssetInfo[]>;
   export async function buildAddTrustlineTx(publicKey: string, assetCode: string, assetIssuer: string): Promise<Transaction>;
   ```
3. Hardcode a list of well-known testnet/mainnet assets as a fallback (USDC, EURT, BTC, ETH tokens on Stellar).
4. Attempt to fetch `.well-known/stellar.toml` from known issuer domains to get asset metadata.
5. Create `frontend/components/TokenCard.tsx` with a clean card design.
6. Add a "Tokens" link to the Navbar.
7. Add `frontend/__tests__/assetDiscovery.test.ts` and `frontend/stories/TokenCard.stories.tsx`.

**Expected Architecture:**

```
frontend/pages/
└── tokens.tsx                (NEW)
frontend/lib/
└── assetDiscovery.ts         (NEW)
frontend/components/
├── TokenCard.tsx             (NEW)
└── Navbar.tsx                (updated: Tokens link)
frontend/stories/
└── TokenCard.stories.tsx     (NEW)
```

**Acceptance Criteria:**
- [ ] `/tokens` page displays known Stellar assets with search/filter.
- [ ] Connected account's trustline status is shown per token.
- [ ] "Add Trustline" builds and submits a valid `change_trust` operation.
- [ ] Token metadata (icon, description) is fetched from TOML files where available.
- [ ] Assets without TOML metadata show a fallback with code and issuer.
- [ ] Trustline addition shows success/error feedback.

---

### Issue #38 — RTL Language Support (Arabic, Hebrew)

**Labels:** `frontend` `i18n` `rtl` `accessibility` `feature`

**Summary:** Add Right-to-Left (RTL) language support to the UI, enabling proper rendering for Arabic and Hebrew locales.

**Background:** The `ROADMAP.md` notes "RTL language support (Arabic, Hebrew) — noted as future work." The existing i18n infrastructure supports JSON translation files, but the layout, CSS, and component structures assume LTR text direction.

**Problem Statement:** RTL languages require more than just translated strings — the entire layout must mirror (navigation on the right, icons flipped, text aligned right). Without RTL support, the app is unusable for Arabic and Hebrew speakers.

**Objectives:**
1. Add `dir="rtl"` to the HTML element when the selected language is RTL.
2. Add RTL-aware Tailwind CSS utilities.
3. Mirror layouts: sidebar/nav on the right, form labels right-aligned, step indicators flow right-to-left.
4. Add `ar/common.json` and `he/common.json` translation files (start with machine translation + manual review).
5. Handle bidirectional text (numbers and embedded LTR strings within RTL content).

**Scope:**
- **In scope:** RTL layout mirroring, Arabic and Hebrew locale files, bidirectional text handling.
- **Out of scope:** full manual translation quality (machine translation acceptable for initial release), vertical writing modes.

**Detailed Implementation Requirements:**
1. Update `frontend/tailwind.config.ts`:
   ```ts
   module.exports = {
     // ...
     plugins: [
       function ({ addVariant }) {
         addVariant("rtl", '[dir="rtl"] &');
       },
     ],
   };
   ```
2. Create `frontend/lib/useDirection.ts`:
   ```ts
   const RTL_LANGUAGES = ["ar", "he", "fa", "ur"];
   export function useDirection(locale: string): "ltr" | "rtl";
   ```
3. Update `frontend/pages/_document.tsx` to set `dir` attribute based on locale.
4. Update `frontend/pages/_app.tsx` to set `dir` on the HTML element when locale changes.
5. Add `rtl:` variants to key components:
   - `Navbar` — `rtl:flex-row-reverse`, `rtl:text-right`.
   - `SendPaymentForm` — labels `rtl:text-right`.
   - `MultiSigFlow` — step indicator `rtl:flex-row-reverse`.
   - `TransactionList` — arrow direction for sent/received `rtl:rotate-180`.
   - Icons that imply direction (arrow-right becomes arrow-left in RTL).
6. Add `ar/common.json` with Arabic translations (use a translation API for initial population).
7. Add `he/common.json` with Hebrew translations.
8. Add RTL-specific CSS for elements that need explicit direction control:
   ```css
   [dir="rtl"] .icon-directional { transform: scaleX(-1); }
   [dir="rtl"] .text-start { text-align: right; }
   [dir="rtl"] .text-end { text-align: left; }
   ```
9. Add a note in the language switcher indicating RTL support level.
10. Add `frontend/__tests__/rtl.test.tsx` that renders key pages with RTL locale and verifies `dir` attribute and layout.

**Expected Architecture:**

```
frontend/
├── lib/
│   └── useDirection.ts       (NEW)
├── styles/
│   └── globals.css           (+ RTL overrides)
├── tailwind.config.ts        (+ rtl variant)
├── pages/
│   ├── _document.tsx         (updated: dir attribute)
│   └── _app.tsx              (updated: dir attribute)
└── public/locales/
    ├── ar/common.json        (NEW)
    └── he/common.json        (NEW)
```

**Acceptance Criteria:**
- [ ] When Arabic or Hebrew is selected, the layout mirrors (RTL).
- [ ] Navigation, forms, and step indicators flow right-to-left.
- [ ] Directional icons are flipped correctly.
- [ ] Numbers within Arabic text maintain LTR rendering.
- [ ] Switching between LTR and RTL languages updates the layout without page reload.
- [ ] Arabic and Hebrew translation files contain all keys (machine translation acceptable).

---

## DEVOPS / QA (Issues #39–#46)

---

### Issue #39 — End-to-End Test Coverage: Escrow Flow

**Labels:** `e2e` `testing` `playwright` `escrow`

**Summary:** Create comprehensive Playwright end-to-end tests for the escrow flow, covering create, claim, cancel, and edge cases.

**Background:** The project has Playwright E2E tests (`frontend/e2e/`) with existing test files for dashboard, escrow, transactions, and AI assistant. The `frontend/e2e/escrow.spec.ts` exists but likely has limited coverage. The escrow page (`frontend/pages/escrow.tsx`) and contract (`lib.rs`, `create_escrow`, `claim_escrow`, `cancel_escrow`, `claim_escrow_partial`) form a complex feature with multiple states.

**Problem Statement:** Insufficient E2E test coverage for the escrow feature risks regressions in the most security-critical user flow (timelocked funds).

**Objectives:**
1. Expand `frontend/e2e/escrow.spec.ts` with tests for the full escrow lifecycle.
2. Test: create escrow → verify on-chain → advance time → claim escrow → verify funds.
3. Test: create escrow → cancel before release → verify refund.
4. Test: attempt claim before release → verify rejected.
5. Test: partial claim after release → verify remaining balance.
6. Test: attempt cancel after release → verify rejected.
7. Test with custom Stellar assets (not just XLM).

**Scope:**
- **In scope:** escrow create/claim/cancel/partial flows, edge cases, asset types.
- **Out of scope:** escrow UI responsiveness, escrow with very large amounts.

**Detailed Implementation Requirements:**
1. Refactor `frontend/e2e/escrow.spec.ts`:
   ```ts
   test.describe("Escrow Flow", () => {
     test("create escrow locks funds and displays pending status");
     test("claim escrow after release ledger transfers funds");
     test("cancel escrow before release refunds payer");
     test("attempt claim before release shows error");
     test("attempt cancel after release shows error");
     test("partial claim reduces remaining balance");
     test("escrow with USDC asset works correctly");
     test("escrow details page shows correct metadata");
   });
   ```
2. Use the `fixtures.ts` helpers for wallet connection and transaction setup.
3. Use `page.waitForTimeout` or ledger manipulation for time-based tests (or mock the ledger on testnet by waiting for enough ledgers).
4. Verify on-chain state by querying Horizon or Soroban RPC after each operation.
5. Add visual regression snapshots for key escrow UI states.
6. Ensure tests are hermetic — each test creates its own escrow with unique IDs.
7. Update `frontend/playwright.config.ts` if needed for longer timeouts.

**Expected Architecture:**

```
frontend/e2e/
└── escrow.spec.ts            (expanded)
```

**Acceptance Criteria:**
- [ ] 8 escrow E2E tests pass consistently in CI.
- [ ] Tests cover create, claim, cancel, partial claim, and edge cases.
- [ ] On-chain state is verified after each operation.
- [ ] Tests run against Stellar testnet (not mocked).
- [ ] Test time <5 minutes total for escrow suite.

---

### Issue #40 — End-to-End Test Coverage: Multi-Sig Flow

**Labels:** `e2e` `testing` `playwright` `multi-sig`

**Summary:** Create comprehensive Playwright end-to-end tests for the multi-signature payment flow across multiple browser contexts (simulating multiple signers).

**Background:** The `frontend/components/MultiSigFlow.tsx` implements a 5-step multi-sig flow (build → sign → share → collect → submit). The `frontend/pages/multi-sig-sign.tsx` page handles co-signers signing a shared XDR. There are no existing E2E tests for multi-sig.

**Problem Statement:** Multi-sig is the most complex UI flow in the application, involving multiple users and browsers. Without E2E tests, regressions in the signature collection or XDR sharing logic are likely.

**Objectives:**
1. Create `frontend/e2e/multi-sig.spec.ts` with tests for the full multi-sig lifecycle.
2. Use Playwright's multi-context support to simulate initiator and co-signers.
3. Test: 2-of-2 multi-sig from build to submission.
4. Test: 2-of-3 with only 2 signers approving.
5. Test: invalid co-signer XDR rejection.
6. Test: co-signer page (`/multi-sig-sign`) URL parsing and signing.

**Scope:**
- **In scope:** multi-sig full flow, multi-context testing, co-signer page, edge cases.
- **Out of scope:** Soroban-based multi-sig (on-chain N-of-M via contract), threshold tests with >3 signers.

**Detailed Implementation Requirements:**
1. Create `frontend/e2e/multi-sig.spec.ts`:
   ```ts
   test.describe("Multi-Sig Flow", () => {
     test("2-of-2 multi-sig: initiator creates, signs, shares, co-signer signs, submit");
     test("2-of-3 multi-sig: two co-signers approve, threshold met, submit");
     test("co-signer page parses XDR from URL and allows signing");
     test("invalid XDR pasted in collect step shows error");
     test("co-signer page with invalid XDR shows error");
     test("signature count updates correctly as signers are added");
   });
   ```
2. For multi-context tests:
   ```ts
   const initiatorContext = await browser.newContext();
   const cosignerContext = await browser.newContext();
   const initiatorPage = await initiatorContext.newPage();
   const cosignerPage = await cosignerContext.newPage();
   // Connect different wallets, share URL between contexts
   ```
3. Use Freighter wallet accounts for both initiator and co-signer (pre-funded testnet accounts in fixtures).
4. Test the copy-to-clipboard workflow in the "Share" step.
5. Verify on-chain transaction hash after successful submission.
6. Add a test for the "Remove signature" button in the collect step.

**Expected Architecture:**

```
frontend/e2e/
├── multi-sig.spec.ts         (NEW)
└── fixtures.ts               (updated: multi-account support)
```

**Acceptance Criteria:**
- [ ] 6 multi-sig E2E tests pass consistently in CI.
- [ ] Multi-context tests simulate initiator + co-signer(s).
- [ ] Full 2-of-2 flow results in a confirmed on-chain transaction.
- [ ] Invalid XDR is rejected with an error message.
- [ ] Co-signer page correctly parses and signs a shared XDR.
- [ ] Test time <8 minutes for multi-sig suite.

---

### Issue #41 — Lighthouse CI Performance Budget

**Labels:** `devops` `performance` `lighthouse` `ci`

**Summary:** Integrate Lighthouse CI into the GitHub Actions workflow to enforce performance budgets and prevent regressions in page load speed, accessibility, and SEO.

**Background:** The frontend uses dynamic imports for code splitting (`frontend/pages/dashboard.tsx` has `dynamic(() => import(...))`). The PWA is set up. However, there is no automated performance monitoring in CI.

**Problem Statement:** Without automated performance budgets, page load regressions can go unnoticed. A new dependency or component change could silently degrade the Lighthouse score.

**Objectives:**
1. Add `@lhci/cli` to the frontend dev dependencies.
2. Configure Lighthouse CI with performance budgets.
3. Add a GitHub Actions step that runs Lighthouse CI against the production build.
4. Set thresholds: Performance ≥80, Accessibility ≥90, Best Practices ≥90, SEO ≥90.
5. Fail the CI check if any budget is exceeded.

**Scope:**
- **In scope:** Lighthouse CI configuration, CI integration, budget thresholds, key pages.
- **Out of scope:** custom Lighthouse audits, PWA-specific audits, performance optimization (separate issues).

**Detailed Implementation Requirements:**
1. Add `@lhci/cli` to `frontend/package.json` (`devDependencies`).
2. Create `frontend/lighthouserc.js`:
   ```js
   module.exports = {
     ci: {
       collect: {
         staticDistDir: "./out",
         numberOfRuns: 3,
         settings: { preset: "desktop" },
       },
       assert: {
         preset: "lighthouse:recommended",
         assertions: {
           "categories:performance": ["error", { minScore: 0.8 }],
           "categories:accessibility": ["error", { minScore: 0.9 }],
           "categories:best-practices": ["error", { minScore: 0.9 }],
           "categories:seo": ["error", { minScore: 0.9 }],
           "first-contentful-paint": ["warn", { maxNumericValue: 2000 }],
           "largest-contentful-paint": ["warn", { maxNumericValue: 3500 }],
           "total-blocking-time": ["warn", { maxNumericValue: 300 }],
           "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
         },
       },
       upload: {
         target: "temporary-public-storage",
       },
     },
   };
   ```
3. Add a new CI job in `.github/workflows/ci.yml`:
   ```yaml
   lighthouse:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with: { node-version: 20 }
       - run: npm ci
         working-directory: frontend
       - run: npm run build
         working-directory: frontend
       - run: npx lhci autorun
         working-directory: frontend
   ```
4. Test key pages: `/`, `/dashboard`, `/transactions`, `/escrow`.
5. Document the performance budgets in `frontend/PERFORMANCE.md`.

**Expected Architecture:**

```
frontend/
├── lighthouserc.js           (NEW)
└── package.json              (+ @lhci/cli, + lhci script)
.github/workflows/
└── ci.yml                    (+ lighthouse job)
frontend/PERFORMANCE.md       (NEW)
```

**Acceptance Criteria:**
- [ ] `npm run lhci` runs Lighthouse against the production build.
- [ ] CI job runs Lighthouse on every PR to master.
- [ ] Performance score <80 fails the check.
- [ ] Accessibility score <90 fails the check.
- [ ] Lighthouse report URL is available in the CI logs.
- [ ] Budget thresholds are documented.

---

### Issue #42 — Bundle Size Monitoring with `bundlesize` or `size-limit`

**Labels:** `devops` `performance` `bundle-size` `ci`

**Summary:** Add automated bundle size monitoring to the CI pipeline that reports size changes for each PR and enforces maximum bundle sizes.

**Background:** The frontend has multiple large components (dashboard, MultiSigFlow, BatchPaymentForm, etc.) and dynamic imports. There is no monitoring of how bundle sizes change over time.

**Problem Statement:** Bundle size creep degrades the user experience, especially on slow connections. Without monitoring, contributors may unknowingly add large dependencies that increase load times.

**Objectives:**
1. Add `@size-limit/preset-app` or `bundlesize` to the frontend.
2. Configure size budgets for the main JS bundles and pages.
3. Add a CI check that fails if any bundle exceeds its budget.
4. Generate a size comparison report for PRs.

**Scope:**
- **In scope:** JS bundle size monitoring, per-page budgets, CI integration, PR comments.
- **Out of scope:** CSS bundle monitoring, image optimization monitoring.

**Detailed Implementation Requirements:**
1. Add `size-limit` and `@size-limit/preset-app` to `frontend/package.json` (`devDependencies`).
2. Create `frontend/.size-limit.js`:
   ```js
   module.exports = [
     { path: ".next/static/chunks/pages/_app-*.js", limit: "150 KB" },
     { path: ".next/static/chunks/pages/index-*.js", limit: "80 KB" },
     { path: ".next/static/chunks/pages/dashboard-*.js", limit: "120 KB" },
     { path: ".next/static/chunks/pages/escrow-*.js", limit: "60 KB" },
     { path: ".next/static/chunks/pages/trade-*.js", limit: "70 KB" },
     { path: ".next/static/chunks/*.js", limit: "500 KB", name: "total JS" },
   ];
   ```
3. Add `"size": "size-limit"` script to `frontend/package.json`.
4. Add CI step in `.github/workflows/ci.yml`:
   ```yaml
   - name: Check bundle size
     working-directory: frontend
     run: npm run size
   ```
5. Optionally add a PR comment with size comparison (using `size-limit`'s GitHub integration or a custom action).
6. Document size budgets and how to update them in `frontend/PERFORMANCE.md`.

**Expected Architecture:**

```
frontend/
├── .size-limit.js            (NEW)
├── package.json              (+ size-limit, + size script)
└── PERFOMANCE.md             (+ bundle size section)
.github/workflows/
└── ci.yml                    (+ bundle size check)
```

**Acceptance Criteria:**
- [ ] `npm run size` checks bundle sizes against budgets.
- [ ] CI fails if any bundle exceeds its limit.
- [ ] Total JS bundle is ≤500 KB.
- [ ] Individual page bundles stay within their limits.
- [ ] Size report is visible in CI logs.

---

### Issue #43 — Dependency Vulnerability Scanning

**Labels:** `devops` `security` `dependencies` `ci`

**Summary:** Add automated dependency vulnerability scanning to CI using `npm audit` (with a severity threshold) and Dependabot for automated security PRs.

**Background:** The project has multiple `package.json` files (root, frontend, backend) and a `Cargo.toml` for the Rust contract. The `.github/workflows/codeql.yml` performs CodeQL analysis but `npm audit` is not run in CI. Dependabot may or may not be configured.

**Problem Statement:** Vulnerable dependencies pose a security risk. Without automated scanning, vulnerabilities can persist for months. OSS grant programs require demonstrated security practices.

**Objectives:**
1. Add `npm audit` with a configurable severity threshold to CI.
2. Enable Dependabot for all three package ecosystems (npm root, npm frontend, npm backend, cargo contract).
3. Add `cargo audit` for Rust dependency vulnerabilities.
4. Document the vulnerability management process.

**Scope:**
- **In scope:** `npm audit` in CI, Dependabot configuration, `cargo audit`, vulnerability process docs.
- **Out of scope:** Snyk integration, OWASP dependency check, custom vulnerability database.

**Detailed Implementation Requirements:**
1. Add CI step in `.github/workflows/ci.yml` for each package:
   ```yaml
   - name: Audit npm dependencies (frontend)
     working-directory: frontend
     run: npm audit --audit-level=high
   - name: Audit npm dependencies (backend)
     working-directory: backend
     run: npm audit --audit-level=high
   ```
2. Create `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/frontend"
       schedule: { interval: "weekly" }
       open-pull-requests-limit: 5
     - package-ecosystem: "npm"
       directory: "/backend"
       schedule: { interval: "weekly" }
       open-pull-requests-limit: 5
     - package-ecosystem: "cargo"
       directory: "/contracts/finchippay-contract"
       schedule: { interval: "weekly" }
       open-pull-requests-limit: 3
   ```
3. Add `cargo-audit` to the contract CI job:
   ```yaml
   - name: Install cargo-audit
     run: cargo install cargo-audit
   - name: Audit Rust dependencies
     working-directory: contracts/finchippay-contract
     run: cargo audit
   ```
4. Create `SECURITY.md` with the vulnerability reporting and management process.
5. Add a `.github/workflows/security-audit.yml` that runs weekly (cron) in addition to on PRs.

**Expected Architecture:**

```
.github/
├── workflows/
│   ├── ci.yml                (+ npm audit steps)
│   └── security-audit.yml    (NEW: weekly cron)
└── dependabot.yml            (NEW)
SECURITY.md                   (NEW)
```

**Acceptance Criteria:**
- [ ] `npm audit --audit-level=high` runs in CI for both frontend and backend.
- [ ] CI fails on high or critical vulnerabilities.
- [ ] Dependabot is configured for all three package ecosystems.
- [ ] `cargo audit` runs for the contract.
- [ ] `SECURITY.md` documents the vulnerability process.
- [ ] Weekly security audit workflow runs on schedule.

---

### Issue #44 — Contract Verification on Stellar Expert / Stellarchain

**Labels:** `devops` `contract` `verification` `transparency`

**Summary:** Automate the on-chain verification of deployed `FinchippayContract` WASM on Stellar block explorers (Stellar Expert, Stellarchain) so users can independently verify the contract code.

**Background:** The contract WASM is deployed to Stellar testnet/mainnet, and the `upgrade()` function supports hot-patching. The current `scripts/deploy-contract.sh` deploys but doesn't verify on explorers. Verified contracts show a green checkmark and the source code on explorers, building user trust.

**Problem Statement:** Without on-chain verification, users cannot independently confirm that the deployed WASM matches the published source code. This is a trust barrier for adoption.

**Objectives:**
1. Integrate with Stellar Expert's verification API to upload source + metadata after deployment.
2. Automate this in the contract deploy workflow (from Issue #7).
3. Add a verification badge to `README.md`.
4. Document how users can independently verify the contract.

**Scope:**
- **In scope:** Stellar Expert verification, CI integration, README badge, documentation.
- **Out of scope:** multi-explorer verification, formal verification proofs.

**Detailed Implementation Requirements:**
1. Research Stellar Expert's verification API (or Stellarchain's).
2. Add a verification step to `.github/workflows/contract-deploy.yml`:
   ```yaml
   - name: Verify contract on Stellar Expert
     run: |
       curl -X POST https://api.stellar.expert/explorer/$NETWORK/contract/$CONTRACT_ID/verify \
         -F "wasm=@target/wasm32-unknown-unknown/release/finchippay_contract.wasm" \
         -F "source=@contracts/finchippay-contract/src/lib.rs" \
         -F "cargo_toml=@contracts/finchippay-contract/Cargo.toml"
   ```
3. Add the `CONTRACT_EXPLORER_VERIFY` env var to toggle verification.
4. Update `scripts/deploy-contract.sh` to include a `--verify` flag.
5. Add a verification status badge to `README.md`:
   ```markdown
   [![Contract Verified](https://img.shields.io/badge/contract-verified-brightgreen)](https://stellar.expert/...)
   ```
6. Create `docs/contract-verification.md` with step-by-step instructions for independent verification.

**Expected Architecture:**

```
.github/workflows/
└── contract-deploy.yml       (+ verification step)
scripts/
└── deploy-contract.sh        (+ --verify flag)
docs/
└── contract-verification.md  (NEW)
README.md                     (+ verification badge)
```

**Acceptance Criteria:**
- [ ] Deployed contract is verified on Stellar Expert after CI deployment.
- [ ] Verification is automatic (no manual steps after deployment).
- [ ] README shows a contract verification badge.
- [ ] `docs/contract-verification.md` enables independent verification.
- [ ] `--verify` flag on deploy script works locally.

---

### Issue #45 — Load Testing with k6

**Labels:** `devops` `testing` `performance` `load-test`

**Summary:** Create a k6 load testing suite for the backend API to establish baseline performance metrics, identify bottlenecks, and set SLAs.

**Background:** The project has a basic load test script (`scripts/load-test.js`) but it is not integrated into CI and doesn't measure against specific targets. The backend has rate limiting (100 req/15 min global, 20 req/min strict), caching (LRU), and Horizon proxying.

**Problem Statement:** Without systematic load testing, there are no baseline performance numbers and no way to detect performance regressions. Production readiness requires documented throughput and latency SLAs.

**Objectives:**
1. Install k6 and create test scripts for key API endpoints.
2. Test: health check, account balance, payment history, analytics, auth challenge.
3. Establish baseline metrics: RPS (requests per second), p50/p95/p99 latency, error rate.
4. Add a CI job that runs load tests and fails on regression (>20% degradation).
5. Document SLAs in a performance runbook.

**Scope:**
- **In scope:** k6 test scripts, CI integration, baseline metrics, regression detection, SLA docs.
- **Out of scope:** frontend load testing, contract RPC load testing, distributed load generation.

**Detailed Implementation Requirements:**
1. Install k6 (add to CI runner setup or use `grafana/k6` Docker image).
2. Create `scripts/load-test/` directory:
   - `scripts/load-test/health.js` — test `/health` and `/api/health` at 200 RPS.
   - `scripts/load-test/accounts.js` — test `/api/accounts/:pk` and `/api/accounts/:pk/balance`.
   - `scripts/load-test/payments.js` — test `/api/payments/:pk` with pagination.
   - `scripts/load-test/analytics.js` — test `/api/analytics/:pk/summary`.
   - `scripts/load-test/auth.js` — test SEP-0010 challenge flow.
3. Configure k6 with:
   ```js
   export const options = {
     stages: [
       { duration: "30s", target: 10 },   // warm-up
       { duration: "1m", target: 50 },    // ramp up
       { duration: "2m", target: 50 },    // steady state
       { duration: "30s", target: 0 },    // cool down
     ],
     thresholds: {
       http_req_duration: ["p(95)<500"],  // 95% of requests <500ms
       http_req_failed: ["rate<0.01"],     // <1% error rate
     },
   };
   ```
4. Add CI job in `.github/workflows/ci.yml`:
   ```yaml
   load-test:
     runs-on: ubuntu-latest
     services:
       backend: { image: finchippay-backend, ports: ["4000:4000"] }
     steps:
       - uses: actions/checkout@v4
       - run: docker compose up -d backend
       - run: k6 run scripts/load-test/health.js
       - run: k6 run scripts/load-test/accounts.js
   ```
5. Publish k6 results as a CI artifact (JSON summary).
6. Document SLAs in `docs/performance.md`:
   - Health endpoint: p99 < 50ms, ≥ 500 RPS.
   - Account balance: p95 < 300ms, ≥ 50 RPS.
   - Payment history: p95 < 500ms, ≥ 20 RPS.

**Expected Architecture:**

```
scripts/load-test/
├── health.js                 (NEW)
├── accounts.js               (NEW)
├── payments.js               (NEW)
├── analytics.js              (NEW)
└── auth.js                   (NEW)
docs/
└── performance.md            (NEW)
.github/workflows/
└── ci.yml                    (+ load-test job)
```

**Acceptance Criteria:**
- [ ] k6 test scripts cover health, accounts, payments, analytics, and auth endpoints.
- [ ] Baseline metrics are documented in `docs/performance.md`.
- [ ] CI job runs load tests and compares against baselines.
- [ ] >20% degradation in p95 latency triggers a CI warning.
- [ ] Error rate exceeds 1% triggers a CI failure.
- [ ] k6 results summary is available as a CI artifact.

---

### Issue #46 — Canary Deployment Workflow for Vercel

**Labels:** `devops` `deployment` `vercel` `canary`

**Summary:** Implement a canary deployment strategy for the frontend on Vercel, routing a small percentage of traffic to the new deployment before full rollout.

**Background:** The `.github/workflows/vercel-deploy.yml` deploys the frontend to Vercel on every push to master. There is no gradual rollout — all users get the new version immediately. If a bug slips through, all users are affected simultaneously.

**Problem Statement:** Immediate full-rollout deployments risk widespread user impact from undetected bugs. A canary deployment limits blast radius by routing only a fraction of users to the new version.

**Objectives:**
1. Configure Vercel's deployment to use a two-step process: preview deploy → promote to production.
2. Add an automated canary phase where 10% of traffic goes to the new deployment for 15 minutes.
3. Monitor error rate (via Sentry) during the canary phase.
4. Auto-promote if error rate is stable; auto-rollback if error rate spikes.
5. Add a manual approval gate for production promotion.

**Scope:**
- **In scope:** Vercel deployment pipeline, traffic splitting, Sentry integration, auto-promote/rollback.
- **Out of scope:** backend canary (requires load balancer), contract canary (immutable).

**Detailed Implementation Requirements:**
1. Update `.github/workflows/vercel-deploy.yml`:
   - Step 1: Deploy to Vercel preview (Vercel CLI `vercel deploy`).
   - Step 2: Create a Vercel alias that routes 10% of traffic to the preview deployment (if Vercel supports this, otherwise use their Edge Config for percentage-based routing).
   - Step 3: Wait 15 minutes, monitor Sentry for error rate changes.
   - Step 4: If error rate is stable (increase < 50%), promote to production (`vercel promote`).
   - Step 5: If error rate spikes, rollback (remove alias, keep production on previous deployment).
2. Add a `vercel.json` or `vercel.json` update for traffic splitting configuration.
3. Create a helper script `scripts/canary-check.js` that queries the Sentry API for error rate comparison.
4. Add environment variables: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
5. Add a manual approval step using GitHub Environments:
   ```yaml
   environment:
     name: production
     url: https://finchippay.vercel.app
   ```

**Expected Architecture:**

```
.github/workflows/
└── vercel-deploy.yml         (updated: canary stages)
scripts/
└── canary-check.js           (NEW: Sentry error rate check)
```

**Acceptance Criteria:**
- [ ] Deployments go through preview → canary (10%) → production stages.
- [ ] Sentry error rate is monitored during the canary phase.
- [ ] Auto-promotion occurs if error rate is stable.
- [ ] Auto-rollback occurs if error rate spikes >50%.
- [ ] Manual approval is required for production promotion (configurable).
- [ ] Deployment status is reported in the PR or commit status.

---

## CROSS-CUTTING (Issues #47–#50)

---

### Issue #47 — Error Standardisation with Error Codes

**Labels:** `cross-cutting` `errors` `api` `consistency`

**Summary:** Standardise all error responses across the backend and frontend with a unified error code system, machine-readable error types, and consistent HTTP status codes.

**Background:** Error responses vary across the codebase. The backend API returns inconsistent shapes: some use `{ error: "message" }`, others `{ success: false, error: "message" }`. The contract has `ContractError` with numeric codes (1–17), but the frontend has ad-hoc error messages in each component. There is no shared error taxonomy.

**Problem Statement:** Inconsistent error handling makes debugging difficult for developers and provides a poor experience for users who see raw error messages or generic "Something went wrong" in some places.

**Objectives:**
1. Define a shared error code enumeration used by backend, frontend, and contract.
2. Standardise all API error responses to the shape: `{ error: { code: string, message: string, details?: any } }`.
3. Map all backend errors to standardized codes.
4. Create a frontend `ErrorDisplay` component that renders errors consistently.
5. Add error code documentation.

**Scope:**
- **In scope:** error code enumeration, API response standardization, frontend error display, documentation.
- **Out of scope:** contract error code changes (already clean), Sentry error grouping overhaul.

**Detailed Implementation Requirements:**
1. Create `shared/errorCodes.js` (or `.ts`) with the canonical error code registry:
   ```js
   module.exports = {
     // Auth errors (AUTH_*)
     AUTH_MISSING_TOKEN: { code: "AUTH_MISSING_TOKEN", httpStatus: 401, message: "Authentication token is required." },
     AUTH_EXPIRED_TOKEN: { code: "AUTH_EXPIRED_TOKEN", httpStatus: 401, message: "Token has expired. Please re-authenticate." },
     AUTH_INVALID_TOKEN: { code: "AUTH_INVALID_TOKEN", httpStatus: 401, message: "Token is invalid." },
     
     // Validation errors (VAL_*)
     VAL_INVALID_PUBLIC_KEY: { code: "VAL_INVALID_PUBLIC_KEY", httpStatus: 400, message: "Invalid Stellar public key format." },
     VAL_INVALID_AMOUNT: { code: "VAL_INVALID_AMOUNT", httpStatus: 400, message: "Amount must be a positive number." },
     VAL_MISSING_FIELD: { code: "VAL_MISSING_FIELD", httpStatus: 400, message: "Required field is missing." },
     
     // Resource errors (RES_*)
     RES_NOT_FOUND: { code: "RES_NOT_FOUND", httpStatus: 404, message: "The requested resource was not found." },
     RES_CONFLICT: { code: "RES_CONFLICT", httpStatus: 409, message: "Resource already exists." },
     
     // Rate limiting (RATE_*)
     RATE_LIMITED_GLOBAL: { code: "RATE_LIMITED_GLOBAL", httpStatus: 429, message: "Too many requests. Please try again later." },
     RATE_LIMITED_USER: { code: "RATE_LIMITED_USER", httpStatus: 429, message: "Too many requests from this account." },
     
     // Contract errors (CONTRACT_*) — mapped from ContractError codes
     CONTRACT_UNAUTHORIZED: { code: "CONTRACT_UNAUTHORIZED", httpStatus: 403, message: "You are not authorized for this action." },
     CONTRACT_PAUSED: { code: "CONTRACT_PAUSED", httpStatus: 503, message: "Contract is temporarily paused." },
     // ... all 17 contract errors
     
     // Server errors (SRV_*)
     SRV_INTERNAL: { code: "SRV_INTERNAL", httpStatus: 500, message: "An internal server error occurred." },
     SRV_HORIZON_UNAVAILABLE: { code: "SRV_HORIZON_UNAVAILABLE", httpStatus: 502, message: "Stellar Horizon is temporarily unavailable." },
   };
   ```
2. Update `backend/src/server.js` to add a global error handler that formats all errors using the code registry.
3. Update all controllers to throw/return errors using the standardized codes.
4. Create `frontend/components/ErrorDisplay.tsx`:
   - Accepts `errorCode: string` and optional `details`.
   - Renders error message with appropriate styling (warning, error, info).
   - Optionally shows a "Details" expandable section for `details`.
   - Supports `onRetry` callback for retryable errors.
5. Create `frontend/lib/errorHandler.ts`:
   - `parseApiError(response: Response): StandardError` — extracts error code and message from API responses.
   - `getContractErrorMessage(contractErrorCode: number): StandardError` — maps contract error codes.
6. Add error handling documentation to `docs/api.md`.
7. Add unit tests verifying that each error code maps correctly.

**Expected Architecture:**

```
shared/
└── errorCodes.js             (NEW: canonical registry)
backend/src/
├── server.js                 (updated: global error handler)
├── middleware/               (updated: use standardized errors)
└── controllers/              (updated: use standardized errors)
frontend/
├── lib/
│   └── errorHandler.ts       (NEW)
└── components/
    └── ErrorDisplay.tsx      (NEW)
```

**Acceptance Criteria:**
- [ ] All API errors follow the `{ error: { code, message, details? } }` shape.
- [ ] Frontend `ErrorDisplay` renders consistent error messages.
- [ ] Contract errors are mapped to user-friendly messages.
- [ ] Error codes are documented in `docs/api.md`.
- [ ] No raw error strings exposed to users in the UI.

---

### Issue #48 — Feature Flags System

**Labels:** `cross-cutting` `feature-flags` `configuration` `devops`

**Summary:** Implement a feature flag system that allows toggling features on/off without deploying code, supporting gradual rollouts, A/B testing, and kill switches.

**Background:** The application has a growing feature set (escrow, streaming, multi-sig, trading, tips, AI assistant). There is currently no way to disable a feature without a code deploy. The `ROADMAP.md` mentions ideas that could benefit from feature-flagged rollout.

**Problem Statement:** Without feature flags, rolling back a problematic feature requires a full redeploy, and there is no way to test features with a subset of users (beta testing).

**Objectives:**
1. Choose a feature flag provider (LaunchDarkly, Flagsmith, or a simple self-hosted approach).
2. Create a `FeatureFlagProvider` context in the frontend.
3. Add feature flag checks to the backend middleware.
4. Flag key features: AI payment assistant, streaming payments, multi-sig, trading, new UI components.
5. Support gradual rollout (percentage-based) and user-targeted flags.
6. Add a `/api/features` endpoint that returns enabled features for the current user.

**Scope:**
- **In scope:** feature flag infrastructure, flag checks in frontend and backend, percentage rollouts.
- **Out of scope:** A/B test result analysis, flag audit logs, flag expiration/scheduling.

**Detailed Implementation Requirements:**
1. For simplicity (OSS-friendly), implement a self-hosted feature flag system:
   - `backend/src/config/features.js` — reads flags from `FEATURE_FLAGS` env var (JSON).
   - `backend/src/middleware/features.js` — middleware that injects `req.features`.
   - `GET /api/features` — returns enabled features for the authenticated user.
2. Feature flag structure:
   ```json
   {
     "streaming_payments": { "enabled": true, "rollout": 100 },
     "ai_payment_assistant": { "enabled": true, "rollout": 50 },
     "multi_sig_payments": { "enabled": true, "rollout": 100 },
     "new_dashboard_charts": { "enabled": false, "rollout": 0 },
     "trading_page": { "enabled": true, "rollout": 100 },
     "ledger_wallet": { "enabled": false, "rollout": 0 }
   }
   ```
3. Rollout logic: `isEnabled(flag, userPublicKey?)`:
   - If `enabled: false` → return false.
   - If `rollout: 100` → return true.
   - If `rollout: N` → hash the user's public key and check if hash % 100 < N (deterministic per-user).
4. Create `frontend/lib/FeatureFlags.tsx`:
   ```tsx
   const FeatureFlagsContext = createContext<Record<string, boolean>>({});
   export function FeatureFlagProvider({ children }) { ... }
   export function useFeatureFlag(name: string): boolean;
   export function FeatureGate({ flag, children, fallback }) { ... }
   ```
5. Wrap pages/components with `FeatureGate`:
   ```tsx
   <FeatureGate flag="streaming_payments" fallback={<ComingSoon />}>
     <StreamingPayments />
   </FeatureGate>
   ```
6. Add backend feature flag checks to route registration (skip registering routes for disabled features).
7. Add `FRONTEND_FEATURE_FLAGS` env var (mirrors backend) for client-side checks without an API call on page load.
8. Create `frontend/__tests__/FeatureFlags.test.tsx`.

**Expected Architecture:**

```
backend/src/
├── config/
│   └── features.js           (NEW)
├── middleware/
│   └── features.js           (NEW)
└── server.js                 (updated: skip disabled routes)

frontend/
└── lib/
    └── FeatureFlags.tsx      (NEW)
```

**Acceptance Criteria:**
- [ ] Features can be toggled on/off via `FEATURE_FLAGS` env var without code deploy.
- [ ] Percentage-based rollouts deterministically assign users based on public key hash.
- [ ] `FeatureGate` shows fallback when a feature is disabled.
- [ ] `/api/features` returns the feature flag state for the current user.
- [ ] Disabled features' routes are not registered on the backend.
- [ ] Tests verify flag toggling and rollout logic.

---

### Issue #49 — SDK / Client Library Generation

**Labels:** `cross-cutting` `sdk` `api` `developer-experience`

**Summary:** Auto-generate a TypeScript SDK/client library from the OpenAPI specification, enabling third-party developers to integrate with Finchippay's backend API.

**Background:** The backend has a Swagger/OpenAPI 3.0 spec (`backend/src/swagger.js`, served at `/api/docs.json`). This is a machine-readable description of all 27 API endpoints. However, there is no generated client library — developers must hand-write HTTP calls.

**Problem Statement:** Third-party developers integrating with Finchippay's API must manually construct HTTP requests, handle auth, and parse responses. A generated SDK reduces integration time from hours to minutes.

**Objectives:**
1. Use `openapi-generator` or `openapi-typescript` to generate a TypeScript client.
2. Create an `npm` package `@finchippay/sdk` with typed API methods.
3. Publish the SDK to npm (or include it as a workspace package).
4. Add SDK usage examples to the documentation.

**Scope:**
- **In scope:** TypeScript SDK generation, typed API methods, npm packaging, docs.
- **Out of scope:** multi-language SDKs (Python, Go, etc.), real-time SDK features.

**Detailed Implementation Requirements:**
1. Add `openapi-typescript` and `openapi-fetch` to the root or frontend dev dependencies:
   ```bash
   npm install -D openapi-typescript
   ```
2. Create a script `scripts/generate-sdk.sh`:
   ```bash
   # Start backend, fetch OpenAPI spec, generate SDK
   npx openapi-typescript http://localhost:4000/api/docs.json -o sdk/src/types.ts
   ```
3. Create `sdk/` directory as an npm workspace:
   ```
   sdk/
   ├── package.json           (name: @finchippay/sdk)
   ├── tsconfig.json
   ├── src/
   │   ├── index.ts           (main export)
   │   ├── types.ts           (auto-generated from OpenAPI)
   │   └── client.ts          (wraps openapi-fetch with auth)
   └── README.md              (SDK usage docs)
   ```
4. The SDK client should:
   - Accept a `baseUrl` and optional `authToken`.
   - Provide typed methods: `sdk.accounts.getBalance(publicKey)`, `sdk.payments.getHistory(publicKey, { limit, cursor })`, etc.
   - Handle SEP-0010 auth automatically (store token, attach to requests).
   - Return typed responses matching the API contracts.
5. Add `npm run generate:sdk` script that regenerates types when the API changes.
6. Add SDK to the CI build to ensure it stays in sync.
7. Document SDK usage in `docs/sdk.md` with examples.
8. Refactor the frontend to use the SDK internally (dogfooding).

**Expected Architecture:**

```
sdk/                           (NEW: npm workspace)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types.ts              (auto-generated)
│   └── client.ts
└── README.md
scripts/
└── generate-sdk.sh           (NEW)
docs/
└── sdk.md                    (NEW)
```

**Acceptance Criteria:**
- [ ] `npm run generate:sdk` produces a typed TypeScript client from the OpenAPI spec.
- [ ] SDK package builds and exports typed methods for all API endpoints.
- [ ] SDK README contains usage examples for common operations.
- [ ] Frontend optionally uses the SDK for API calls.
- [ ] SDK types are regenerated in CI and checked for changes.
- [ ] `docs/sdk.md` provides integration guidance for third-party developers.

---

### Issue #50 — Structured Logging with Correlation IDs

**Labels:** `cross-cutting` `logging` `observability` `devops`

**Summary:** Implement structured JSON logging across all services with correlation IDs that propagate through the entire request chain (frontend → backend → Horizon/Soroban RPC).

**Background:** The backend uses Pino for structured logging (`backend/src/utils/logger.js`) with Stellar secret key redaction. The frontend uses `console.log` ad-hoc. There is no correlation ID to trace a single user action across frontend and backend logs. In a production incident, correlating logs is manual and error-prone.

**Problem Statement:** Without correlation IDs, debugging production issues that span frontend and backend requires time-consuming log correlation by timestamp and user. A correlation ID (traceparent) already exists in the OpenTelemetry context (Issue #20) but is not included in application logs.

**Objectives:**
1. Add request ID generation middleware that creates a unique `X-Request-ID` for each incoming request.
2. Include the request ID in all backend log lines.
3. Generate correlation IDs in the frontend for user-initiated actions and include them in API requests.
4. Include the correlation ID in Horizon and Soroban RPC calls.
5. Add a `correlationId` field to Sentry events.

**Scope:**
- **In scope:** request ID middleware, log enrichment, frontend correlation ID generation, Horizon/RPC propagation, Sentry integration.
- **Out of scope:** log aggregation platform (e.g., ELK, Loki), log retention policies.

**Detailed Implementation Requirements:**
1. Create `backend/src/middleware/requestId.js`:
   - Generates a UUID v4 for each incoming request.
   - Sets `X-Request-ID` response header.
   - Attaches `req.id` to the request object.
   - If `X-Request-ID` is present in the request, reuse it (for upstream correlation).
2. Update `backend/src/utils/logger.js`:
   - Create a child logger per request: `req.log = logger.child({ requestId: req.id })`.
   - All subsequent log calls use `req.log.info(...)` instead of `logger.info(...)`.
3. Add a middleware that injects `req.log` into `req` for all route handlers.
4. Update `backend/src/services/stellarService.js`:
   - Include `X-Request-ID` header in Horizon API calls (if Horizon supports it) or log it alongside each Horizon call.
5. Create `frontend/lib/correlation.ts`:
   ```ts
   let sessionId = crypto.randomUUID();
   export function getSessionId(): string { return sessionId; }
   export function createActionId(): string { return crypto.randomUUID(); }
   export function withCorrelation(fetch: typeof window.fetch): typeof window.fetch {
     return (input, init) => {
       const headers = new Headers(init?.headers);
       headers.set("X-Request-ID", createActionId());
       headers.set("X-Session-ID", sessionId);
       return fetch(input, { ...init, headers });
     };
   }
   ```
6. Override the global `fetch` in the frontend to automatically include correlation headers.
7. Add `correlationId` to Sentry events (both frontend `sentry.client.config.ts` and backend `sentry.server.config.ts`).
8. Document the correlation ID format and propagation in `docs/logging.md`.

**Expected Architecture:**

```
backend/src/
├── middleware/
│   └── requestId.js          (NEW)
├── utils/
│   └── logger.js             (updated: child loggers)
└── services/
    └── stellarService.js     (updated: correlation in Horizon calls)

frontend/lib/
└── correlation.ts            (NEW)

docs/
└── logging.md                (NEW)
```

**Acceptance Criteria:**
- [ ] Every backend request has a unique `X-Request-ID`.
- [ ] All backend log lines include the `requestId` field.
- [ ] Frontend API requests include `X-Request-ID` and `X-Session-ID` headers.
- [ ] Horizon and Soroban RPC calls log the correlation ID.
- [ ] Sentry events include the correlation ID for cross-referencing.
- [ ] `X-Request-ID` is returned in the response headers.
- [ ] Correlation IDs are documented in `docs/logging.md`.

---

## Summary

| # | Category | Title |
|---|----------|-------|
| 1 | Contract | Gas Profiling & Optimisation for FinchippayContract |
| 2 | Contract | Property-Based Fuzz Testing for Streaming Payment Arithmetic |
| 3 | Backend | Contract Event Indexer Service |
| 4 | Contract | Vesting Schedule Contract Extension |
| 5 | Contract | Merkle-Tree Airdrop Contract Extension |
| 6 | Contract | Admin Multi-Sig for Contract Governance |
| 7 | DevOps | Contract Deployment & Verification Automation |
| 8 | Contract | Contract State Export / Migration Tool |
| 9 | Backend | Migrate In-Memory Storage to SQLite/PostgreSQL |
| 10 | Backend | Refresh Token Rotation for SEP-0010 Sessions |
| 11 | Backend | Redis Caching Layer for Horizon Queries |
| 12 | Backend | Webhook Retry with Dead Letter Queue |
| 13 | Backend | Rate Limiting by Authenticated Identity |
| 14 | Backend | Database-Backed Turrets with Price Feed Fallbacks |
| 15 | Backend | Stellar Anchor Integration (SEP-24) |
| 16 | Backend | KYC Integration via SEP-12 |
| 17 | Backend | GraphQL API Layer |
| 18 | Backend | Input Validation with Zod Schemas |
| 19 | Backend | Scheduled Transaction Execution (Cron-Based) |
| 20 | Backend | OpenTelemetry Distributed Tracing |
| 21 | Frontend | Soroban RPC Client Abstraction Layer |
| 22 | Frontend | Dark Mode with System Preference Detection |
| 23 | Frontend | Accessibility (a11y) Audit & Remediation |
| 24 | Frontend | Offline Transaction Queue with Background Sync |
| 25 | Frontend | Multi-Account Management |
| 26 | Frontend | CSV Export of Transaction History |
| 27 | Frontend | Advanced Analytics Dashboard with Date Range Filtering |
| 28 | Frontend | Network Fee Estimator |
| 29 | Frontend | Transaction Simulation Before Signing |
| 30 | Frontend | Ledger Hardware Wallet Support |
| 31 | Frontend | NFT Receipt Gallery |
| 32 | Frontend | Push Notification Webhooks via Web Push API |
| 33 | Frontend | Mobile-Responsive PWA Improvements |
| 34 | Frontend | Complete i18n Translation Coverage |
| 35 | Frontend | Real-Time Balance via Server-Sent Events (SSE) |
| 36 | Frontend | Address Book Import/Export (CSV & vCard) |
| 37 | Frontend | Token List Browser with Asset Discovery |
| 38 | Frontend | RTL Language Support (Arabic, Hebrew) |
| 39 | QA | End-to-End Test Coverage: Escrow Flow |
| 40 | QA | End-to-End Test Coverage: Multi-Sig Flow |
| 41 | DevOps | Lighthouse CI Performance Budget |
| 42 | DevOps | Bundle Size Monitoring |
| 43 | DevOps | Dependency Vulnerability Scanning |
| 44 | DevOps | Contract Verification on Stellar Explorer |
| 45 | DevOps | Load Testing with k6 |
| 46 | DevOps | Canary Deployment Workflow for Vercel |
| 47 | Cross-Cutting | Error Standardisation with Error Codes |
| 48 | Cross-Cutting | Feature Flags System |
| 49 | Cross-Cutting | SDK / Client Library Generation |
| 50 | Cross-Cutting | Structured Logging with Correlation IDs |
