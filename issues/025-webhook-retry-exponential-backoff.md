# Issue #25 — Webhook Delivery Retry with Exponential Backoff

**Labels:** `backend` `feature` `webhooks` `reliability`

## Summary
Enhance the webhook delivery system with exponential backoff retry, dead letter queue management, delivery priority ordering, and real-time delivery status tracking.

## Background
The backend has `webhookService.js`, `webhookSubscriptionService.js`, and `webhookTopics.js`. The `webhooks.js` route has endpoints for `failures` and `retry`. However, there's no retry with exponential backoff — failed deliveries are not retried at increasing intervals.

## Problem Statement
Webhook consumers (merchants, integrators) can miss events when their endpoints are temporarily unavailable. Without retry with backoff, they must manually replay events via the retry endpoint. This is unreliable for production integrations.

## Objectives
1. Implement retry with exponential backoff (1min → 5min → 15min → 1h → 6h → 24h).
2. Add configurable max retry attempts.
3. Add delivery status tracking (pending, in_flight, delivered, failed).
4. Add delivery priority (newest first).
5. Add tests.

## Scope
- **In scope:** exponential backoff retry, status tracking, priority ordering.
- **Out of scope:** webhook payload signing enhancement (already exists).

## Detailed Implementation Requirements

1. **Retry scheduler:** Update `backend/src/services/webhookService.js`:
   - On delivery failure, schedule retry at: `now + backoff[attempt]`.
   - Backoff schedule: `[60, 300, 900, 3600, 21600, 86400]` (seconds: 1min, 5min, 15min, 1h, 6h, 24h).
   - Max retries: 6 (configurable via `WEBHOOK_MAX_RETRIES` env var).
   - After max retries, move to dead letter queue (DLQ).
   - Use the same polling pattern as `scheduledExecutor.js` for retry scheduling.

2. **Database updates:** Enhance `webhook_deliveries` table (via migration `023_webhook_delivery_retry.js`):
   - Add `retry_attempts` (INTEGER, default 0).
   - Add `next_retry_at` (TIMESTAMPTZ, nullable).
   - Add `last_http_status` (INTEGER, nullable).
   - Add `last_response_body` (TEXT, nullable, truncated to 1KB).
   - Add `delivery_priority` (INTEGER, default 0 — higher = delivered first).

3. **Delivery worker:** Create `backend/src/jobs/webhookDeliveryWorker.js`:
   - Poll every 10 seconds for deliveries where `next_retry_at <= now AND (status = 'pending' OR status = 'failed')`.
   - Order by `delivery_priority DESC, retry_attempts ASC, next_retry_at ASC`.
   - Process up to 50 deliveries per cycle.
   - Update status to `in_flight` while processing, then `delivered` or `failed`.
   - Log delivery attempt with timing.

4. **Dead letter queue:** Enhance `deadDeliveries` existing endpoint:
   - After max retries, mark status as `dead`.
   - Store in `dead_letter_queue` table: original delivery, all retry timestamps, final error.
   - Admin can view DLQ and manually replay.
   - `POST /api/webhooks/:publicKey/retry` replays all dead deliveries with fresh retry schedule.

5. **Delivery status API:** Add endpoints:
   - `GET /api/webhooks/:publicKey/deliveries?status=&page=&limit=` — query delivery history.
   - `GET /api/webhooks/:publicKey/deliveries/:id` — single delivery detail with retry timeline.

6. **Metrics:** Expose Prometheus metrics: `webhook_deliveries_total{status}`, `webhook_retry_count`, `webhook_dlq_size`.

7. **Tests:** Test retry scheduling at each backoff interval, DLQ after max retries, replay from DLQ, delivery query API.

## Acceptance Criteria
- [ ] Failed deliveries are retried at 1min → 5min → 15min → 1h → 6h → 24h intervals.
- [ ] After 6 failed attempts, delivery moves to dead letter queue.
- [ ] Delivery status is tracked: pending → in_flight → delivered/failed/dead.
- [ ] `GET /api/webhooks/:publicKey/deliveries` returns paginated delivery history.
- [ ] Dead letter queue can be replayed via existing retry endpoint.
- [ ] Delivery worker polls every 10 seconds.
- [ ] All existing tests pass.
