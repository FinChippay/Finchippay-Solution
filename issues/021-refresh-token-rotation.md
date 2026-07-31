# Issue #21 — Refresh Token Rotation for SEP-0010 Sessions

**Labels:** `backend` `security` `auth` `enhancement`

## Summary
Implement refresh token rotation for SEP-0010 JWT authentication, replacing the current single-token approach with an access token + refresh token pattern that improves security and allows session management.

## Background
The backend uses SEP-0010 JWT authentication (`backend/src/middleware/auth.js`) with a single `JWT_SECRET`. Tokens have an expiry but there's no refresh mechanism — users must re-authenticate when tokens expire. The `getJwtToken` function in `frontend/lib/auth.ts` stores the token simply.

## Problem Statement
Current JWT implementation has no refresh mechanism — expired tokens force re-authentication. There's no token revocation, no rotation, and no way to manage active sessions. This is a security risk and poor UX.

## Objectives
1. Implement access token + refresh token pattern.
2. Add refresh token rotation (new refresh token issued with each refresh).
3. Add token revocation endpoint.
4. Add session management (view/revoke active sessions).
5. Update frontend auth flow to use refresh tokens.

## Scope
- **In scope:** refresh token rotation, revocation, session management, frontend integration.
- **Out of scope:** OAuth2 provider integration, social login.

## Detailed Implementation Requirements

1. **Token pair generation:** Create `backend/src/services/tokenService.js`:
   - `generateTokenPair(publicKey)` returns `{ accessToken, refreshToken, expiresIn }`.
   - Access token: short-lived (15 minutes), signed with `JWT_SECRET`.
   - Refresh token: longer-lived (7 days), stored as SHA-256 hash in database.
   - Refresh tokens are single-use: each refresh generates a new pair and invalidates the old refresh token (rotation).

2. **Database migration:** Create `backend/migrations/018_refresh_tokens.js`:
   ```sql
   CREATE TABLE refresh_tokens (
     id SERIAL PRIMARY KEY,
     public_key VARCHAR(56) NOT NULL,
     token_hash VARCHAR(64) NOT NULL UNIQUE,
     device_info TEXT,
     ip_address INET,
     expires_at TIMESTAMPTZ NOT NULL,
     revoked BOOLEAN DEFAULT FALSE,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     last_used_at TIMESTAMPTZ
   );
   CREATE INDEX idx_refresh_tokens_public_key ON refresh_tokens(public_key);
   CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
   ```

3. **API endpoints:**
   - `POST /api/auth/refresh` — body: `{ refreshToken }`. Validates hash, checks not revoked/expired, issues new pair, invalidates old token. Returns `{ accessToken, refreshToken, expiresIn }`.
   - `POST /api/auth/revoke` — body: `{ refreshToken }` (all sessions) or `{ sessionId }` (specific session). Revokes the token in database.
   - `GET /api/auth/sessions` — returns list of active sessions for authenticated user (public key + device info + last used time + created time).

4. **Auth middleware update:** Update `backend/src/middleware/auth.js`:
   - Add `verifyRefreshToken` function for refresh endpoint.
   - Add automatic cleanup of expired tokens (triggered on read or periodic job).

5. **Frontend integration:** Update `frontend/lib/auth.ts`:
   - Store refresh token in localStorage (or httpOnly cookie via backend).
   - Intercept 401 responses: attempt token refresh before showing login prompt.
   - If refresh also fails, clear auth state and redirect to connect wallet.
   - Add `getAccessToken()` that auto-refreshes if token is expired.
   - Add `revokeSession(sessionId)` function.

6. **Security measures:**
   - Refresh token rotation: old token is invalidated on each refresh.
   - Replay detection: if a revoked refresh token is used, revoke all tokens for that user (potential token theft).
   - Rate limit refresh endpoint (5 req/min per IP).
   - Log all refresh and revoke events.

7. **Tests:** Test token pair generation, refresh rotation, revocation, replay detection, session listing, expired token cleanup.

## Expected Architecture

```
backend/
├── migrations/
│   └── 018_refresh_tokens.js      (NEW)
├── src/services/
│   └── tokenService.js             (NEW)
├── src/middleware/
│   └── auth.js                     (UPDATE)
├── src/routes/
│   └── auth.js                     (UPDATE: refresh, revoke endpoints)
└── __tests__/
    └── tokenService.test.js        (NEW)

frontend/
├── lib/
│   └── auth.ts                     (UPDATE: auto-refresh flow)
└── components/
    └── SessionManager.tsx          (NEW: view/revoke sessions)
```

## Acceptance Criteria
- [ ] Access tokens expire after 15 minutes; refresh tokens expire after 7 days.
- [ ] Refresh token rotation works — each refresh produces a new pair and invalidates the old one.
- [ ] Replay detection: using an already-revoked refresh token revokes all user sessions.
- [ ] `GET /api/auth/sessions` returns active sessions with device info and timestamps.
- [ ] Frontend auto-refreshes on 401 without user disruption.
- [ ] Session revocation works for individual and all sessions.
- [ ] Rate limiting on refresh endpoint.
- [ ] All existing tests pass.
