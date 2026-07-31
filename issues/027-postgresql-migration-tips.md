# Issue #27 — Migration of Tips/Username Storage to PostgreSQL

**Labels:** `backend` `enhancement` `database` `migration`

## Summary
Migrate the currently in-memory tips and username storage to PostgreSQL, ensuring data persistence across server restarts and enabling query capabilities for analytics.

## Background
The ROADMAP.md lists "Migrate tips/username storage from in-memory to SQLite/PostgreSQL" as in-progress. Currently, `tipsService.js` and `usernameService.js` use in-memory data structures. The database `knexfile.js` already configures PostgreSQL connections. The `seeds/` directory has seed data for tips and usernames.

## Problem Statement
In-memory storage means tips data and username registrations are lost on server restart. This is unacceptable for production. The project already has PostgreSQL configured but doesn't use it for these services.

## Objectives
1. Create PostgreSQL tables for tips and usernames.
2. Update `tipsService.js` to use database queries.
3. Update `usernameService.js` to use database queries.
4. Migrate existing in-memory data (if any) to PostgreSQL.
5. Add database indexes for query performance.

## Scope
- **In scope:** database migration for tips and usernames.
- **Out of scope:** caching layer (can be added later).

## Detailed Implementation Requirements

1. **Database migration:** Create `backend/migrations/024_tips_persistent.js`:
   ```sql
   CREATE TABLE tips (
     id SERIAL PRIMARY KEY,
     from_addr VARCHAR(56) NOT NULL,
     to_addr VARCHAR(56) NOT NULL,
     amount_stroops BIGINT NOT NULL,
     token_code VARCHAR(12) NOT NULL DEFAULT 'XLM',
     ledger_sequence INTEGER NOT NULL,
     memo TEXT,
     transaction_hash VARCHAR(64),
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   CREATE INDEX idx_tips_from ON tips(from_addr);
   CREATE INDEX idx_tips_to ON tips(to_addr);
   CREATE INDEX idx_tips_created ON tips(created_at);
   CREATE INDEX idx_tips_from_to ON tips(from_addr, to_addr);
   ```

2. **Migration for usernames:** Create `backend/migrations/025_usernames_persistent.js`:
   ```sql
   CREATE TABLE usernames (
     id SERIAL PRIMARY KEY,
     username VARCHAR(30) NOT NULL UNIQUE,
     public_key VARCHAR(56) NOT NULL UNIQUE,
     display_name VARCHAR(100),
     avatar_url TEXT,
     bio TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   CREATE INDEX idx_usernames_public_key ON usernames(public_key);
   CREATE INDEX idx_usernames_lookup ON usernames(username);
   ```

3. **Update `tipsService.js`:**
   - Replace `Map<Address, i128[]>` in-memory storage with PostgreSQL queries.
   - Methods: `recordTip(from, to, amount, token, ledger, memo, txHash)`, `getTipsByAddress(addr, limit, offset)`, `getTipTotal(addr)`, `getTipCount(addr)`.
   - Use Knex query builder for all database interactions.
   - Return data in same format as current in-memory to avoid breaking controllers.

4. **Update `usernameService.js`:**
   - Replace in-memory `Map<username, publicKey>` with PostgreSQL queries.
   - Methods: `registerUsername(username, publicKey, displayName, ...)`, `resolveUsername(username)`, `resolvePublicKey(publicKey)`, `updateProfile(publicKey, updates)`, `checkAvailability(username)`.

5. **Data migration:** Create a one-time script `scripts/migrate-tips-to-db.js` that:
   - Reads existing in-memory data (if any process still has it).
   - Not strictly necessary for production since in-memory is dev-only.
   - Can be run as part of deployment to populate initial data.

6. **Caching consideration:** Add a simple LRU cache wrapper (using `cacheService.js`) with 60-second TTL for frequently accessed data (tip totals, username resolution).

7. **Tests:** Update existing tests for tips and username services. Test CRUD operations, duplicate username handling, data consistency.

## Expected Architecture

```
backend/
├── migrations/
│   ├── 024_tips_persistent.js     (NEW)
│   └── 025_usernames_persistent.js (NEW)
├── src/services/
│   ├── tipsService.js             (UPDATE: DB queries)
│   └── usernameService.js         (UPDATE: DB queries)
├── scripts/
│   └── migrate-tips-to-db.js      (NEW)
└── __tests__/
    ├── tips.test.js               (UPDATE)
    └── username.test.js           (UPDATE)
```

## Acceptance Criteria
- [ ] Tips are stored in PostgreSQL and persist across server restarts.
- [ ] Usernames are stored in PostgreSQL and persist across server restarts.
- [ ] `tipsService.js` and `usernameService.js` use Knex query builder.
- [ ] Duplicate username registration returns appropriate error.
- [ ] Tip queries support pagination (limit/offset).
- [ ] Cache layer reduces database load for frequent queries.
- [ ] All existing tests pass.
