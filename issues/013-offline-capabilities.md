# Issue #13 — Offline-First Capabilities Enhancement

**Labels:** `frontend` `feature` `pwa` `offline`

## Summary
Enhance the Progressive Web App capabilities to provide a robust offline experience, including offline transaction queuing, cached account data, and background sync when connectivity returns.

## Background
The app has basic PWA support with `frontend/public/manifest.json`, `frontend/public/sw.js` (service worker), and an `OfflineBanner` component. The `offlineQueue.ts` library exists but has limited functionality. The `useNetworkStatus` hook monitors connectivity.

## Problem Statement
Users in regions with unreliable connectivity cannot reliably use Finchippay. When offline, the app shows a banner but provides no functionality — users cannot prepare transactions, review history, or manage their portfolio.

## Objectives
1. Implement a full offline transaction queue with IndexedDB persistence.
2. Enhance the service worker with strategic caching (app shell, API responses, asset data).
3. Build an offline transaction composer that queues transactions for submission when online.
4. Add background sync for automatic queue processing.
5. Write tests for offline queue and service worker caching.

## Scope
- **In scope:** offline queue, service worker caching, offline composer, background sync.
- **Out of scope:** full offline transaction signing (requires Freighter), offline contract interactions.

## Detailed Implementation Requirements

1. **Offline queue enhancement:** Update `frontend/lib/offlineQueue.ts`:
   - Store pending transactions in IndexedDB (use `idb-keyval` or raw IndexedDB).
   - Each queue entry: `{ id, type, payload, createdAt, status (pending/processing/failed), retryCount }`.
   - Methods: `enqueue(type, payload)`, `dequeue()`, `peek()`, `remove(id)`, `getAll()`, `getFailed()`.
   - Max 3 retries per entry with exponential backoff.

2. **Service worker update:** Enhance `frontend/public/sw.js`:
   - Cache-first strategy for static assets (JS, CSS, images).
   - Network-first with cache fallback for API responses (balance, transactions).
   - Stale-while-revalidate for price feeds.
   - Cache invalidation on new service worker activation.
   - Offline fallback page (`/offline`).

3. **Offline composer:** Create `frontend/components/OfflineTransactionComposer.tsx`:
   - Full send form that works without network.
   - Validates addresses locally (regex).
   - Stores composed transaction in offline queue.
   - Shows queue status and pending count.
   - Background sync registers a `sync` event for automatic processing.

4. **Connectivity-aware UI:**
   - Update `OfflineBanner.tsx` to show pending queue count.
   - Add offline badge to transaction list showing queued items.
   - Show toast when transactions are auto-submitted on reconnection.

5. **Background sync:** Register `sync` event listener in service worker. On `sync` event, process the offline queue in FIFO order. Use the `sync` tag `"process-transaction-queue"`.

6. **Tests:** Create `frontend/__tests__/offlineQueue.test.ts` with tests for enqueue/dequeue, retry logic, persistence across page reloads. Update Playwright e2e tests in `frontend/e2e/offline.spec.ts`.

## Expected Architecture

```
frontend/
├── public/
│   └── sw.js                    (UPDATE: cache strategies, background sync)
├── lib/
│   └── offlineQueue.ts          (UPDATE: IndexedDB, retry, sync)
├── components/
│   ├── OfflineBanner.tsx        (UPDATE: queue count badge)
│   └── OfflineTransactionComposer.tsx (NEW)
├── pages/
│   └── offline.tsx              (NEW: offline fallback page)
├── hooks/
│   └── useNetworkStatus.ts     (UPDATE: queue integration)
└── __tests__/
    └── offlineQueue.test.ts     (NEW)
```

## Acceptance Criteria
- [ ] Transactions composed offline are queued in IndexedDB and survive page reloads.
- [ ] Service worker caches static assets and serves them offline.
- [ ] API responses (balance, transactions) are cached and served offline.
- [ ] Background sync automatically processes queue when online.
- [ ] Failed transactions show in queue with retry status.
- [ ] OfflineBanner shows pending queue count.
- [ ] All existing tests pass.
- [ ] e2e tests cover offline→online transition.
