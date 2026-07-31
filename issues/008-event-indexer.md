# Issue #8 — Soroban Event Indexer & Query Service

**Labels:** `backend` `contract` `indexer` `new-service`

## Summary
Build a standalone event indexer that listens to Soroban events emitted by `FinchippayContract` and stores them in a queryable PostgreSQL database, then expose new API endpoints for querying contract events.

## Background
The contract emits structured Soroban events for every state change (tip, stream_open, escrow_create, multisig_executed, etc.) as seen in `contracts/finchippay-contract/src/lib.rs`. Currently, the backend only queries Horizon for basic payment history — it has no visibility into contract-level activity like streaming claims, escrow releases, multi-sig approvals, or vesting events.

## Problem Statement
Users interacting with the Soroban contract have no way to view their streaming, escrow, or multi-sig activity in the dashboard because the backend does not index contract events. A partial `fetchContractEventCount` exists in `frontend/pages/dashboard.tsx` but relies on a non-existent backend endpoint.

## Objectives
1. Create a new backend service `eventIndexer.js` that polls Soroban RPC for new events.
2. Add PostgreSQL migration for the event store.
3. Expose new API endpoints for querying events.
4. Integrate with the dashboard to display contract activity.

## Scope
- **In scope:** event indexer service, DB schema, API routes, basic dashboard integration.
- **Out of scope:** real-time WebSocket push, historical backfill beyond most recent 7 days.

## Detailed Implementation Requirements

1. **Database migration:** Create `backend/migrations/012_contract_events.js` with schema:
   ```sql
   CREATE TABLE contract_events (
     id SERIAL PRIMARY KEY,
     event_type VARCHAR(128) NOT NULL,
     contract_id VARCHAR(64) NOT NULL,
     ledger_sequence INTEGER NOT NULL,
     emitted_at TIMESTAMPTZ NOT NULL,
     from_addr VARCHAR(64),
     to_addr VARCHAR(64),
     amount_raw VARCHAR(64),
     payload JSONB NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   CREATE INDEX idx_events_type_ledger ON contract_events(event_type, ledger_sequence);
   CREATE INDEX idx_events_from ON contract_events(from_addr);
   CREATE INDEX idx_events_to ON contract_events(to_addr);
   CREATE INDEX idx_events_payload ON contract_events USING GIN(payload);
   ```

2. **Event parser:** Create `backend/src/services/eventParser.js` that understands event topics emitted by FinchippayContract. Map each event type to structured fields:
   - `"tip"` → `{ from, to, amount }`
   - `"stream_open"` → `{ payer, recipient, rate, deposited }`
   - `"stream_claim"` → `{ stream_id, recipient, amount }`
   - `"escrow_create"` → `{ from, to, amount, release_ledger }`
   - `"multisig_executed"` → `{ proposer, recipient, amount }`
   - `"vesting_claim"` → `{ vesting_id, beneficiary, amount }`
   - etc.

3. **Indexer service:** Create `backend/src/services/eventIndexer.js`:
   - Poll Soroban RPC (`SOROBAN_RPC_URL` env var) every 30 seconds using `GET /events` with cursor-based pagination.
   - Track `last_processed_ledger` in a small `indexer_state` table.
   - Parse and insert events in batches of 100.
   - Handle RPC timeouts with exponential backoff (reuse pattern from `stellarService.js` `withTimeoutAndRetry`).
   - Log metrics: events indexed per cycle, processing time.

4. **API routes:** Create `backend/src/routes/events.js`:
   - `GET /api/events/:publicKey` — paginated events where user is from_addr or to_addr.
   - `GET /api/events/:publicKey/stats` — aggregate counts by event type.
   - `GET /api/events/:publicKey/:eventType` — filter by event type.

5. **Controller:** Create `backend/src/controllers/eventController.js`. Support `?limit=`, `?cursor=`, `?since=` query params.

6. **Dashboard integration:** Wire the existing `fetchContractEventCount` in `frontend/pages/dashboard.tsx` to the new endpoint. Display event counts in a new "Contract Activity" card.

## Expected Architecture

```
backend/
├── migrations/
│   └── 012_contract_events.js    (NEW)
├── src/
│   ├── services/
│   │   ├── eventIndexer.js        (NEW)
│   │   └── eventParser.js         (NEW)
│   ├── routes/
│   │   └── events.js              (NEW)
│   ├── controllers/
│   │   └── eventController.js     (NEW)
│   └── server.js                  (register new routes + start indexer)
```

## Acceptance Criteria
- [ ] Indexer polls Soroban RPC and inserts events into PostgreSQL.
- [ ] `GET /api/events/:publicKey` returns events filtered by participant address with cursor pagination.
- [ ] `GET /api/events/:publicKey/stats` returns per-type event counts.
- [ ] Indexer resumes from the last processed ledger after server restart.
- [ ] Integration test in `backend/__tests__/integration-eventIndexer.test.js` verifies the polling loop.
- [ ] Dashboard shows a "Contract Activity" card with event counts.
- [ ] All existing backend tests pass.
