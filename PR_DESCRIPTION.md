# Bug: Wallet disconnect does not clear JWT token — stale auth persists across sessions

**Closes #89**

## Problem

The application uses two separate JWT token storage mechanisms that were not synchronized:

1. **In-memory token** (`frontend/lib/wallet.ts`): A module-level `jwtToken` variable managed by `setJwtToken()`/`getJwtToken()` — used during the SEP-0010 auth flow.
2. **LocalStorage token** (`frontend/lib/auth.ts`): Persisted under `finchippay_auth_token` — used by API calls to set the `Authorization: Bearer <token>` header.

When a user disconnected their Freighter wallet:
- `useWallet.tsx` called `wallet.disconnectWallet()` which cleared only the **in-memory** token
- The **localStorage** token (`finchippay_auth_token`) was never cleared
- Subsequent API requests continued including the stale `Authorization` header
- No redirect to the landing page occurred

## Solution

### 1. Sync localStorage on auth (`frontend/lib/wallet.ts`)
- `performSEP0010Auth()` now persists the JWT to localStorage via `auth.setJwtToken(token)` after storing it in memory
- `disconnectWallet()` now clears localStorage via `auth.clearJwtToken()` in addition to clearing the in-memory token

### 2. Redirect on disconnect (`frontend/lib/useWallet.tsx`)
- Added `useRouter` from `next/router`
- `disconnectWallet()` now calls `router.push("/")` to redirect the user to the landing page after disconnecting
- `router` is included in the `useMemo` dependency array

### 3. Updated unit tests (`frontend/__tests__/wallet.test.ts`)
- Added mock for `@/lib/auth`
- New test: `disconnectWallet clears localStorage auth token` — verifies `clearJwtToken()` is called
- New test: `persists JWT token to localStorage on successful auth` — verifies `setJwtToken()` is called with the correct token

### 4. Added E2E test (`frontend/e2e/wallet-connect.spec.ts`)
- New scenario 4: "disconnect wallet clears JWT token and redirects to landing page"
- Verifies: connect wallet → disconnect via navbar → confirm → redirect to `/` → connect button visible

## Files Changed

| File | Change |
|------|--------|
| `frontend/lib/wallet.ts` | Synced localStorage JWT with auth.ts on both `performSEP0010Auth()` and `disconnectWallet()` |
| `frontend/lib/useWallet.tsx` | Added `router.push("/")` redirect on disconnect |
| `frontend/__tests__/wallet.test.ts` | Added mock for auth.ts + 2 new tests for localStorage integration |
| `frontend/e2e/wallet-connect.spec.ts` | Added E2E test for disconnect → redirect → unconnected state |

## Testing

- **Unit tests**: All 31 `wallet.test.ts` tests pass (3 new assertions)
- **Lint**: ESLint passes with no errors
- **Type-check**: TypeScript `tsc --noEmit` passes with no errors
- **E2E**: New disconnect scenario added to Playwright test suite

## Security Impact

- Stale JWT tokens are now properly cleared on wallet disconnect
- API calls after disconnect will not carry an `Authorization` header (prevents session confusion)
- The fix is backward compatible — existing auth flows continue to work unchanged
