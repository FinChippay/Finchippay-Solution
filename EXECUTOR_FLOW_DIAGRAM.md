# Scheduled Transaction Executor - Flow Diagrams

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Finchippay Backend                        │
└─────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
                ▼                ▼                ▼
        ┌──────────────┐  ┌──────────────┐ ┌──────────────┐
        │   Express    │  │   Executor   │ │  Webhook     │
        │   Routes     │  │   Service    │ │  Service     │
        └──────────────┘  └──────────────┘ └──────────────┘
                │                │                │
                └────────────────┼────────────────┘
                                 ▼
                    ┌─────────────────────────────┐
                    │   Knex Database Layer       │
                    └─────────────────────────────┘
                                 ▼
        ┌────────────────────────────────────────┐
        │  SQLite (dev) / PostgreSQL (prod)      │
        ├────────────────────────────────────────┤
        │  scheduled_transactions                │
        │  scheduled_txn_executions (NEW)        │
        │  pending_executions                    │
        └────────────────────────────────────────┘
```

## Executor Polling Loop

```
┌──────────────────────────────────────────────────────────────────┐
│                  Server Startup                                  │
├──────────────────────────────────────────────────────────────────┤
│  1. Run migrations (including 011_scheduled_txn_executions)      │
│  2. Load active schedules from DB                               │
│  3. START SCHEDULED EXECUTOR                                     │
│     - Runs immediately (first cycle)                             │
│     - Then every 60 seconds (configurable)                       │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────────┐
         │  Executor Cycle (Every 60 seconds)     │
         └────────────────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                │                            │
                ▼                            ▼
         ┌──────────────────┐       ┌──────────────────┐
         │  DUE TRANSACTIONS │       │ PENDING RETRIES  │
         │  (New executions) │       │ (Failed, retry)  │
         └──────────────────┘       └──────────────────┘
                │                            │
                │                            │
    ┌───────────▼──────────────┐   ┌─────────▼──────────────┐
    │ Query transactions:      │   │ Query executions:      │
    │ - status = 'active'      │   │ - status = 'pending'   │
    │ - next_run_at in         │   │ - attempt < MAX_RETRIES│
    │   [now-60s, now+60s]     │   │ - next_retry_at <= now │
    └────────────┬─────────────┘   └────────────┬──────────┘
                 │                              │
                 ▼                              ▼
      ┌──────────────────────┐      ┌─────────────────────┐
      │ For each schedule:   │      │ For each execution: │
      │ executeDueTransaction│      │ handleRetry         │
      └──────────────────────┘      └─────────────────────┘
                 │                              │
                 │                              │
                 └──────────────┬───────────────┘
                                │
                ┌───────────────▼──────────────┐
                │   Log execution results     │
                │   to scheduled_txn_         │
                │   executions table          │
                └────────────────────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │  Cycle Complete        │
                    │  Wait 60 seconds...    │
                    └────────────────────────┘
```

## Due Transaction Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│  Execute Due Transaction (schedule)                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │ Build unsigned XDR            │
            │ (using buildUnsignedPaymentXDR)
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │ Attempt to submit to Horizon  │
            │ (server.submitTransaction)    │
            └───────────────────────────────┘
                            │
                ┌───────────┴────────────┐
                │                        │
                ▼ SUCCESS                ▼ FAILURE
        ┌──────────────────┐    ┌──────────────────┐
        │ Log execution:   │    │ Parse error      │
        │ status: submitted│    │ Check if retryable
        │ hash: tx_hash    │    └──────────────────┘
        │ resolved_at: now │                │
        └──────────────────┘                │
                │               ┌───────────┴─────────────┐
                │               │                         │
                ▼               ▼ RETRYABLE              ▼ PERMANENT
        ┌──────────────────┐  ┌────────────────┐  ┌──────────────┐
        │ Update schedule: │  │ Log execution: │  │ Log execution│
        │ next_run_at = at │  │ status: pending│  │ status: failed
        │ (for next cycle) │  │ attempt: 1     │  │ resolved_at  │
        └──────────────────┘  │ next_retry_at: │  └──────────────┘
                │             │ now + 5 min    │         │
                │             └────────────────┘         │
                │                    │                   │
                ▼                     ▼                   ▼
        ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
        │ COMPLETED        │ │ QUEUED FOR RETRY │ │ MARK FAILED      │
        │                  │ │ (Polled in 5 min)│ │ + NOTIFY OWNER   │
        └──────────────────┘ └──────────────────┘ └──────────────────┘
```

## Retry Mechanism Flow

```
┌─────────────────────────────────────────────────────────┐
│  Pending Execution (Retry Logic)                        │
├─────────────────────────────────────────────────────────┤
│  From scheduled_txn_executions:                         │
│  - status = 'pending'                                   │
│  - attempt_number = N (< MAX_RETRIES)                   │
│  - next_retry_at <= now                                 │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │ Re-attempt submission         │
            │ (same as due transaction)     │
            └───────────────────────────────┘
                            │
                ┌───────────┴────────────┐
                │                        │
                ▼ SUCCESS                ▼ FAILURE
        ┌──────────────────┐    ┌──────────────────┐
        │ Mark submitted   │    │ Attempt+1 < MAX? │
        │ hash: tx_hash    │    └──────────────────┘
        │ resolved_at: now │                │
        └──────────────────┘                │
                │               ┌───────────┴────────┐
                ▼               │                    │
        ┌──────────────────┐    ▼ YES               ▼ NO (FINAL)
        │ Success on retry │  ┌────────┐    ┌──────────────┐
        │ Continue normal  │  │ Queue  │    │ Mark: failed │
        │ schedule cycle   │  │ next   │    │ Send webhook │
        └──────────────────┘  │ retry  │    │ notification │
                              │ (5min) │    └──────────────┘
                              └────────┘              │
                                │                     ▼
                                ▼              ┌──────────────────┐
                          ┌──────────────┐    │ FINAL FAILURE    │
                          │ QUEUED AGAIN │    │ Notify owner via  │
                          │ (Polled 5min)│    │ webhook service   │
                          └──────────────┘    └──────────────────┘
```

## Error Classification Decision Tree

```
                    Submission Failed
                            │
                            ▼
                   ┌─────────────────┐
                   │ Parse error     │
                   │ from Horizon    │
                   └────────┬────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │                                        │
        ▼ Known Permanent Error                  ▼ Other / Retryable
   ┌────────────────────┐              ┌─────────────────────┐
   │ tx_failed          │              │ NETWORK_ERROR       │
   │ tx_duplicate       │              │ TIMEOUT             │
   │ op_underfunded     │              │ INSUFFICIENT_BALANCE│
   │ op_malformed       │              │ Connection refused  │
   │ etc...             │              │ etc...              │
   └────────────────────┘              └─────────────────────┘
        │                                      │
        ▼                                      ▼
   ┌────────────────────┐         ┌────────────────────┐
   │ FAIL IMMEDIATELY   │         │ QUEUE FOR RETRY    │
   │ Mark: failed       │         │ Queue for attempt  │
   │ Notify owner       │         │ N+1 in 5 minutes   │
   │ Status → failed    │         │ (if N < MAX_RETRIES│
   │                    │         │  attempt again)    │
   └────────────────────┘         └────────────────────┘
```

## Manual Execute-Now Flow

```
┌──────────────────────────────────────────────┐
│  POST /api/scheduled-txns/:id/execute-now    │
│  Request body: (empty or additional params)  │
└──────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ scheduledExecutor.executeNow( │
        │   scheduleId                  │
        │ )                             │
        └───────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ Look up schedule by ID        │
        │ (404 if not found)            │
        └───────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ Build & submit XDR            │
        │ (same as normal execution)    │
        └───────────────────────────────┘
                        │
        ┌───────────────┴──────────────┐
        │                              │
        ▼ SUCCESS                      ▼ FAILURE
    ┌───────────────┐        ┌──────────────────┐
    │ status: 200   │        │ status: 202      │
    │ success: true │        │ Queued for retry │
    │ hash: tx_hash │        │ (or permanent fail│
    │ executionId   │        │  depends on error)
    └───────────────┘        └──────────────────┘
```

## Execution History Query Flow

```
┌─────────────────────────────────────────────────────┐
│  GET /api/scheduled-txns/:id/executions             │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ scheduledExecutor.getExecution│
        │ History(scheduleId)           │
        └───────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ Query DB:                     │
        │ SELECT * FROM                 │
        │ scheduled_txn_executions      │
        │ WHERE schedule_id = :id       │
        │ ORDER BY executed_at DESC     │
        └───────────────────────────────┘
                        │
                        ▼
    ┌───────────────────────────────────────┐
    │ Response 200 OK                       │
    ├───────────────────────────────────────┤
    │ {                                     │
    │   "scheduleId": "uuid",               │
    │   "executions": [                     │
    │     {                                 │
    │       "id": "uuid",                   │
    │       "status": "submitted",          │
    │       "attempt_number": 1,            │
    │       "submitted_hash": "abc123...",  │
    │       "error_code": null,             │
    │       "executed_at": "2026-07-27...", │
    │       "resolved_at": "2026-07-27..."  │
    │     },                                │
    │     { /* more executions */ }         │
    │   ]                                   │
    │ }                                     │
    └───────────────────────────────────────┘
```

## Database State Transitions

### For Scheduled Transactions

```
┌─────────────┐  (user creates)  ┌─────────────┐
│   created   │ ──────────────→  │   active    │
└─────────────┘                  └─────────────┘
                                       ▲  │
                                       │  │ (all retries fail)
                                       │  ▼
                                       │ ┌─────────────┐
                                       │ │   failed    │
                                       │ └─────────────┘
                                       │
                                 (user pauses/resumes)
```

### For Scheduled Transaction Executions

```
                            ┌─────────────┐
                            │  submitted  │ (immediate success)
                            └─────────────┘
                                   ▲
                                   │
          ┌────────────────────────┘
          │
   ┌──────▼────────┐
   │ New Execution │
   └──────┬────────┘
          │
          │ (attempt to submit)
          ▼
   ┌──────────────┐
   │  pending     │ ─(next_retry_at)→ (retry loop)
   └──────┬───────┘
          │
          │ (attempt < MAX_RETRIES)
          │ (retryable error)
          ▼
   ┌──────────────┐
   │  pending     │ ─(attempt again in 5 min)→ [loop]
   │  attempt: 2  │
   └──────┬───────┘
          │
          │ (attempt == MAX_RETRIES) OR (permanent error)
          ▼
   ┌──────────────┐
   │   failed     │ → (webhook notification sent)
   │  attempt: 3  │
   └──────────────┘
```

## Notification Flow on Final Failure

```
┌──────────────────────────────────┐
│ Final Failure Detected           │
│ (either permanent error OR       │
│  attempt_number == MAX_RETRIES)  │
└──────────────────────────────────┘
                │
                ▼
    ┌────────────────────────┐
    │ Update execution:      │
    │ status = "failed"      │
    │ resolved_at = now      │
    └────────────────────────┘
                │
                ▼
    ┌────────────────────────┐
    │ Update schedule:       │
    │ status = "failed"      │
    └────────────────────────┘
                │
                ▼
    ┌────────────────────────────┐
    │ Send webhook notification: │
    ├────────────────────────────┤
    │ event: scheduled_          │
    │   transaction.failed       │
    │ scheduleId: uuid           │
    │ executionId: uuid          │
    │ attemptNumber: 3           │
    │ maxRetries: 3              │
    │ errorCode: TIMEOUT         │
    │ errorMessage: "..."        │
    │ recipient: GBAA...         │
    │ amount: 100.0              │
    │ asset: XLM                 │
    └────────────────────────────┘
                │
                ▼
    ┌────────────────────────────┐
    │ webhookService.deliverAll  │
    │ (sends to all registered   │
    │  webhooks for owner)       │
    └────────────────────────────┘
                │
    ┌───────────┴────────────┐
    │                        │
    ▼ Delivered              ▼ Failed
┌─────────┐         ┌──────────────┐
│ Logged  │         │ Retry queued │
│ Success │         │ (webhookSvc) │
└─────────┘         └──────────────┘
```

## Performance Characteristics

```
┌──────────────────────────────────────────────────┐
│ Executor Cycle Performance                       │
├──────────────────────────────────────────────────┤
│ Interval:           60 seconds (default)         │
│ Due transaction Q:   O(1) indexed query          │
│ Pending retries Q:   O(1) indexed query          │
│ Per transaction:     ~100-200ms (network call)   │
│ Per retry:          ~100-200ms (network call)    │
│ Cycle timeout:      None (runs independently)    │
│ Max batch size:     50 retries/cycle             │
│                     (unlimited due txns)         │
│ DB writes/cycle:    ~2-100 (depends on load)     │
│ Webhook sends:      Parallel, allSettled         │
└──────────────────────────────────────────────────┘
```

## Monitoring & Observability

```
┌────────────────────────────────────────────┐
│ Structured Logging (Pino)                  │
├────────────────────────────────────────────┤
│ Debug:  Execution cycle start/detail       │
│ Info:   Transactions processed, success    │
│ Warn:   Retryable failures, edge cases     │
│ Error:  Permanent failures, exceptions     │
│                                            │
│ All logs include:                          │
│ - Correlation ID (from ALS)                │
│ - Timestamp (ISO 8601)                     │
│ - Service: "finchippay-backend"            │
│ - Redacted: secrets, private keys          │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Key Metrics to Monitor                     │
├────────────────────────────────────────────┤
│ ✓ Executor cycles completed/failed         │
│ ✓ Transactions executed (success/fail)     │
│ ✓ Retry attempts/successes                 │
│ ✓ Final failures/notifications sent        │
│ ✓ Execution history table growth           │
│ ✓ Cycle duration (should be < 60s)         │
│ ✓ Webhook delivery success rate            │
└────────────────────────────────────────────┘
```
