## Summary

Closes #XYZ - Removes insecure `localStorage` persistence of `finchippay_refresh_token` and relies strictly on the backend-issued `httpOnly` cookie for session resilience. 

## Type of change

- [x] Security fix (non-breaking change which fixes an issue)
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactor / chore

## Related issue

Fixes High Severity vulnerability: "performSEP0010Auth stores finchippay_refresh_token in localStorage in addition to the httpOnly cookie set by the backend."

## What this fixes / the gap

The `finchippay_refresh_token` was being redundantly stored in the browser's `localStorage` during the SEP-0010 authentication flow. This bypassed the security protections of the `httpOnly` cookie set by the backend, exposing the 7-day refresh token to potential XSS attacks and enabling persistent session hijacking.

## The fix and why this approach

- **Removed `localStorage` token storage:** Removed the `localStorage.setItem` for `finchippay_refresh_token` in `performSEP0010Auth`.
- **Introduced non-sensitive auth hint:** Replaced the token storage in `frontend/lib/auth.ts` with a non-sensitive boolean flag (`finchippay_has_session = 'true'`). This allows the frontend to know it *should* attempt a token refresh without exposing the token payload itself.
- **Enabled Cross-Origin Cookies (`credentials: "include"`):** 
  - Updated `performRefresh`, `revokeSession`, and `revokeAllSessions` in `frontend/lib/auth.ts` to omit the refresh token from their JSON body payloads and instead include `credentials: "include"`, relying on the browser to send the `httpOnly` cookie.
  - Updated `disconnectWallet` in `frontend/lib/wallet.ts` to utilize `credentials: "include"` when calling `/api/auth/logout`.
  - Updated `verifyChallenge` and `getChallenge` in `frontend/lib/sdk-instance.ts` to include `credentials: "include"` so the `Set-Cookie` directives from the backend are properly saved by the browser.

## Changes

- `frontend/lib/wallet.ts`: Removed token storage, updated `disconnectWallet` fetch options.
- `frontend/lib/auth.ts`: Refactored `getRefreshToken`/`setRefreshToken` to use a boolean flag; removed token from JSON body of refresh/revoke requests; added `credentials: "include"`.
- `frontend/lib/sdk-instance.ts`: Added `credentials: "include"` to SDK fetch wrappers.

## Testing

- [x] Verified `localStorage` no longer contains the refresh token upon login.
- [x] Verified automated refresh cycle succeeds via the `httpOnly` cookie.
- [x] Verified `logout` successfully clears the `httpOnly` cookies from the browser.

## Checklist

- [x] My code follows the project style
- [ ] I've updated docs if needed
- [x] No console errors or warnings
- [x] I've rebased on latest `main`
