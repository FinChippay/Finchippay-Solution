# Issue #16 — Advanced Transaction Filters and Full-Text Search

**Labels:** `frontend` `feature` `search` `transactions`

## Summary
Build an advanced transaction search and filter system with full-text search across transaction memos, addresses, and amounts, combined with multi-criteria filtering.

## Background
The frontend has a `TransactionSearchBar` component, `transactionSearch.ts` and `transactionSearchIndex.ts` libraries that build a client-side search index. The `TransactionList` component supports basic filtering. However, search is limited to client-side prefix matching and doesn't leverage the backend for full-text search across all transaction history.

## Problem Statement
Users with hundreds or thousands of transactions cannot efficiently find specific transactions without scrolling through pages. There's no way to search by memo content, filter by date range and asset type simultaneously, or search across multiple accounts.

## Objectives
1. Build a full-text search system with backend support (PostgreSQL full-text search).
2. Add multi-criteria filtering (date range, asset type, amount range, direction).
3. Build an advanced search UI with saved searches.
4. Add keyboard shortcuts for power users.
5. Write tests and update e2e tests.

## Scope
- **In scope:** full-text search, multi-criteria filters, backend search API, saved searches.
- **Out of scope:** regex search, search across all users (admin feature).

## Detailed Implementation Requirements

1. **Backend search API:** Create `backend/src/services/transactionSearchService.js`:
   - `POST /api/transactions/:publicKey/search` with body: `{ query, filters: { dateFrom, dateTo, assetType, minAmount, maxAmount, direction }, cursor, limit }`.
   - Use PostgreSQL full-text search (`to_tsvector`/`to_tsquery`) on memo text.
   - Filter by date range on `created_at`, amount range on payment amount, asset type, direction.
   - Return paginated results with total count.

2. **Database migration:** Create `backend/migrations/016_transaction_search.js`:
   - Create `transaction_search` materialised view or use existing payment tables.
   - Add GIN index for full-text search on memo column.
   - Support incremental refresh.

3. **Frontend search interface:** Create `frontend/components/AdvancedTransactionSearch.tsx`:
   - Search input with debounce (300ms).
   - Expandable filter panel: date range picker, asset type multi-select, amount range slider, direction toggle.
   - Saved searches dropdown (stored in localStorage).
   - Results view with highlighting of matched terms.
   - Clear all filters button.

4. **Transaction list integration:** Update `frontend/components/TransactionList.tsx`:
   - Integrate `AdvancedTransactionSearch` above the list.
   - Replace client-side search with backend search API when query/filters are active.
   - Show loading state during search.
   - Show result count and "X results found" text.

5. **Saved searches:** Allow users to save named search queries. Store in localStorage with key `finchippay:saved-searches`. Each saved search: `{ id, name, query, filters, createdAt }`.

6. **Keyboard shortcuts:** `Ctrl+F` or `/` to focus search, `Escape` to clear, `Ctrl+Shift+F` for advanced filters.

7. **Tests:** Add backend tests for search API, frontend tests for AdvancedTransactionSearch, update e2e tests in `frontend/e2e/transactions.spec.ts`.

## Expected Architecture

```
frontend/
├── components/
│   ├── TransactionSearchBar.tsx      (UPDATE: integrate advanced)
│   ├── AdvancedTransactionSearch.tsx (NEW)
│   └── TransactionList.tsx           (UPDATE: backend search)
├── __tests__/
│   └── TransactionSearchBar.test.tsx (UPDATE)
└── e2e/
    └── transactions.spec.ts         (UPDATE)

backend/
├── migrations/
│   └── 016_transaction_search.js    (NEW)
├── src/services/
│   └── transactionSearchService.js  (NEW)
├── src/routes/
│   └── payments.js                  (UPDATE: add search endpoint)
└── __tests__/
    └── transactionSearch.test.js    (NEW)
```

## Acceptance Criteria
- [ ] Backend search API supports full-text search on memos with PostgreSQL.
- [ ] Filters: date range, asset type, amount range, direction all work in combination.
- [ ] Search results highlight matched terms.
- [ ] Saved searches persist and can be loaded.
- [ ] Keyboard shortcuts work (Ctrl+F, Escape, Ctrl+Shift+F).
- [ ] Pagination works for large result sets.
- [ ] All existing tests pass.
