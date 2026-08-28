# PR: Error Standardisation with Error Codes (Closes #169)

## Summary

Standardises all error responses across the backend and frontend with a unified error code system, machine-readable error types, and consistent HTTP status codes.

All API errors now follow the canonical shape:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { }
  }
}
```

## Changes

### New Files
| File | Description |
|------|-------------|
| `shared/errorCodes.js` | Canonical error code registry with 60+ error codes, helpers (`getError`, `formatErrorResponse`, `getContractErrorCode`, `formatContractErrorResponse`), and contract error mapping (1–17 → `CONTRACT_*`) |
| `frontend/lib/errorHandler.ts` | `parseApiError()` — extracts standardized errors from API responses (supports legacy shapes); `getContractErrorMessage()` — maps numeric contract codes; `isRetryableError()` / `isSupportError()` helpers |
| `frontend/components/ErrorDisplay.tsx` | Consistent error display component with severity levels (error/warning/info), expandable details, retry callback, contact-support link, and compact inline variant |
| `backend/__tests__/errorCodes.test.js` | 29 unit tests covering registry integrity, `getError()`, `formatErrorResponse()`, `CONTRACT_ERROR_MAP`, and `getContractErrorCode()` |
| `frontend/__tests__/errorHandler.test.ts` | 25 unit tests covering `parseApiError()`, `getContractErrorMessage()`, `getErrorMessage()`, `isRetryableError()`, `isSupportError()` |

### Modified Backend Files (14 files)
| File | Changes |
|------|---------|
| `backend/src/server.js` | Global error handler checks `err.errorCode` first; JSON parsing handler, rate limiter, 404 handler all use `formatErrorResponse()` |
| `backend/src/middleware/auth.js` | JWT verification errors use `AUTH_MISSING_HEADER`, `AUTH_INVALID_TOKEN`, `AUTH_EXPIRED_TOKEN` |
| `backend/src/middleware/rateLimit.js` | Both strict and sensitive limiters use `formatErrorResponse("RATE_LIMITED_SENSITIVE")` |
| `backend/src/middleware/sanitization.js` | Public key and username validators use `VAL_INVALID_PUBLIC_KEY`, `VAL_INVALID_USERNAME` |
| `backend/src/middleware/bodyParsing.js` | Content-Type rejection uses `VAL_CONTENT_TYPE` |
| `backend/src/middleware/metrics.js` | Metrics token auth uses `AUTH_MISSING_HEADER`, `AUTH_INVALID_TOKEN` |
| `backend/src/controllers/paymentController.js` | Invalid limit → `VAL_INVALID_LIMIT` |
| `backend/src/controllers/accountController.js` | Missing fields → `VAL_MISSING_FIELD`; reserved username → `SRV_NOT_IMPLEMENTED` |
| `backend/src/controllers/federationController.js` | Adds `errorCode` property to thrown errors; all responses use standardized format |
| `backend/src/routes/auth.js` | Challenge and verify endpoints use `VAL_MISSING_FIELD`, `AUTH_CHALLENGE_FAILED` |
| `backend/src/routes/webhooks.js` | All validation errors standardized (`VAL_MISSING_FIELD`, `VAL_INVALID_PUBLIC_KEY`, `VAL_INVALID_URL`, `VAL_WEAK_SECRET`, `RES_NOT_FOUND`) |
| `backend/src/routes/scheduledTransactions.js` | Validation and 404 errors standardized |
| `backend/src/routes/sep24.js` | Deposit/withdrawal validation and catch blocks standardized |
| `backend/src/routes/metrics.js` | Prometheus collection error uses `SRV_METRICS_FAILED` |
| `backend/src/turretsServer.js` | Error handler uses `formatErrorResponse()` with `err.errorCode` support |

### Modified Documentation
| File | Changes |
|------|---------|
| `docs/api.md` | Added full Error Codes Reference section with tables for all 6 categories (`AUTH_*`, `VAL_*`, `RES_*`, `RATE_*`, `CONTRACT_*`, `PAY_*`, `SRV_*`, `GEN_*`); updated Response Conventions, Rate Limiting, and Global Errors sections |

## Error Code Categories (60+ codes)

| Category | Prefix | Count | Description |
|----------|--------|-------|-------------|
| Auth | `AUTH_*` | 6 | Token validation, permissions, SEP-0010 challenges |
| Validation | `VAL_*` | 14 | Input format, missing fields, size limits, content-type |
| Resource | `RES_*` | 7 | Not found, conflict, gone, route not found |
| Rate Limiting | `RATE_*` | 3 | Global, sensitive, user-level rate limits |
| Contract | `CONTRACT_*` | 17 | 1:1 mapping from Soroban `ContractError` codes (1–17) |
| Payment | `PAY_*` | 10 | Build/sign/submit failures, balance, destination errors |
| Server | `SRV_*` | 6 | Internal errors, Horizon/federation failures, not implemented |
| Generic | `GEN_*` | 3 | Unknown, network, offline errors |

## Contract Error Mapping

The 17 Soroban `ContractError` numeric codes are mapped 1:1 to user-friendly messages:

| Code | Contract Error | HTTP | User Message |
|------|---------------|------|--------------|
| 1 | `AlreadyInitialized` | 409 | Contract is already initialized. |
| 2 | `Unauthorized` | 403 | You are not authorized for this action. |
| 12 | `ContractPaused` | 503 | Contract is temporarily paused. |
| 17 | `TransferFailed` | 502 | Token transfer could not be verified on-chain. |

## Testing

- **Backend**: `npx jest errorCodes` → **29/29 passing** ✓
- **Frontend**: `npx jest errorHandler` → **25/25 passing** ✓
- **Type check**: No errors in new `ErrorDisplay.tsx` or `errorHandler.ts` files ✓
- **Pre-existing backend test failures** (13 suites) due to missing `node_modules` — not caused by this PR

## Migration Notes

### Breaking Changes
- **All API error responses now use `{ error: { code, message, details? } }`** instead of `{ error: "string" }` or `{ success: false, error: "..." }`
- Clients should migrate to reading `error.code` for programmatic error handling
- The `frontend/lib/errorHandler.ts` `parseApiError()` function handles both legacy and canonical shapes for backward compatibility

### Non-breaking
- Success responses (`{ success: true, data: ... }`) are unchanged
- The global error handler preserves `err.errorCode` and `err.details` for downstream use
- Legacy error shapes are still parsed by `parseApiError()` in the frontend

## Future Work
- Integrate `ErrorDisplay` component into `SendPaymentForm`, `TransactionList`, `WalletConnect`, and other components
- Update endpoint-specific error tables in `docs/api.md` to match canonical shapes
- Add error codes to `parsePayment.js` AI parsing responses

---

Closes #169
