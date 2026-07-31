# Issue #26 — API Versioning Strategy Implementation

**Labels:** `backend` `enhancement` `architecture` `api`

## Summary
Implement a robust API versioning strategy using URL-prefix versioning (v1, v2) with backward compatibility, version negotiation, deprecation headers, and migration guides.

## Background
The backend API currently has no versioning — all routes are at `/api/payments`, `/api/webhooks`, etc. The `docs/api.md` documents the current API but there's no mechanism to introduce breaking changes without affecting existing clients.

## Problem Statement
As the API evolves, breaking changes will need to be introduced. Without versioning, existing clients (merchant integrations, SDK users) will break on deployment. This blocks the project from reaching production maturity.

## Objectives
1. Implement URL-prefix versioning (`/api/v1/payments`).
2. Add version negotiation via `Accept-Version` header.
3. Implement deprecation warnings via response headers.
4. Create the existing API as v1.
5. Add a version migration guide.

## Scope
- **In scope:** URL versioning, header negotiation, deprecation headers, v1 freeze.
- **Out of scope:** content-type versioning, GraphQL.

## Detailed Implementation Requirements

1. **Version middleware:** Create `backend/src/middleware/apiVersion.js`:
   - Extract version from URL prefix (`/api/v1/...`, `/api/v2/...`) or `Accept-Version` header.
   - Default to latest version if not specified.
   - Set `req.apiVersion` for downstream use.
   - Validate version is supported.
   - Add response headers: `X-API-Version`, `X-API-Deprecated` (if using deprecated version), `Sunset` (if version is scheduled for removal).

2. **Route restructuring:** Refactor all routes into versioned directories:
   - `backend/src/routes/v1/payments.js`, `v1/webhooks.js`, `v1/accounts.js`, etc.
   - Current routes become v1 without changes.
   - `server.js` mounts `/api/v1/...` for all routes.
   - `/api/...` (unversioned) redirects to `/api/v1/...` with deprecation header.

3. **Version registry:** Create `backend/src/config/apiVersions.js`:
   - List of supported versions with metadata: `{ version, releaseDate, deprecationDate, sunsetDate, status (active/deprecated/sunset) }`.
   - `getLatestVersion()` — returns newest active version.
   - `isVersionDeprecated(version)` — checks if version is deprecated.
   - `getDeprecationHeaders(version)` — returns appropriate warning headers.

4. **Migration guide:** Create `docs/api-migration-v1-v2.md`:
   - Document all v1 endpoints and their v2 equivalents (initially same).
   - Migration checklist for clients.
   - Example: upgrading from SDK v1 to v2.

5. **SDK update:** Update `sdk/src/client.ts` to use versioned endpoints:
   - Default to v1.
   - Accept `apiVersion` option in constructor.
   - Handle `X-API-Version` and `X-API-Deprecated` response headers.
   - Log deprecation warnings in development.

6. **Swagger update:** Update `backend/src/swagger.js`:
   - Serve versioned OpenAPI specs: `/api/v1/docs`, `/api/v2/docs`.
   - Each version has its own spec document.
   - Use `servers` field to indicate base URL.

7. **Tests:** Test version negotiation, header parsing, deprecation headers, fallback to latest, invalid version handling.

## Expected Architecture

```
backend/
├── src/
│   ├── middleware/
│   │   └── apiVersion.js        (NEW)
│   ├── config/
│   │   └── apiVersions.js       (NEW)
│   ├── routes/
│   │   └── v1/                  (NEW: moved from routes/)
│   │       ├── payments.js
│   │       ├── webhooks.js
│   │       ├── accounts.js
│   │       └── ...
│   ├── server.js                (UPDATE)
│   └── swagger.js               (UPDATE)
├── docs/
│   └── api-migration-v1-v2.md   (NEW)
└── __tests__/
    └── apiVersion.test.js       (NEW)

sdk/
├── src/
│   └── client.ts                (UPDATE: versioned endpoints)
```

## Acceptance Criteria
- [ ] `/api/v1/...` routes serve identical responses to current `/api/...` routes.
- [ ] `Accept-Version: 1` header selects v1 without URL prefix.
- [ ] `X-API-Version: 1` header present on all responses.
- [ ] Deprecated versions receive `X-API-Deprecated: true` and `Sunset` headers.
- [ ] Invalid version returns 400 with supported versions list.
- [ ] SDK accepts `apiVersion` option and uses versioned URLs.
- [ ] Swagger docs served per-version.
- [ ] All existing tests pass.
