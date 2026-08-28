## Summary

- Enforce `Content-Type: application/json` on POST/PUT requests, returning `415` instead of silently parsing an empty body.
- Set the global JSON body limit to 100kb and give `/api/turrets` its own 512kb limit for larger txFunction payloads.
- Return a clear `413` error for oversized bodies instead of the default `413` body-parser message going straight to the generic error handler.

## Type of change

- [x] Bug fix

## Related issue

Closes #81

## Changes

- `backend/src/middleware/bodyParsing.js` (new): `requireJsonContentType` middleware — rejects POST/PUT requests whose `Content-Type` doesn't include `application/json` with a `415`.
- `backend/src/server.js`:
  - Replaced the single `express.json({ limit: "10kb" })` with a 100kb global parser, plus a `/api/turrets`-scoped parser at 512kb mounted first (body-parser's `req._body` guard makes the global parser a no-op for requests the turrets parser already handled).
  - Wired in `requireJsonContentType` ahead of both parsers.
  - Extended the JSON body error handler to catch body-parser's `entity.too.large` / `413` error and respond with `{ error: "Request body too large" }`.
- `backend/__tests__/bodyLimits.test.js` (new): covers the 415 (wrong Content-Type) and 413 (oversized body, both the 100kb global limit and the 512kb `/api/turrets` override) rejection cases, plus a positive case confirming `application/json; charset=utf-8` is still accepted.

## Testing

- [x] Added/updated unit tests — `cd backend && npm test` (111 passed, including 5 new)
- [x] `cd backend && npm run lint` — clean

## Checklist

- [x] My code follows the project style
- [x] I've updated docs if needed (n/a — no public docs describe body limits)
- [x] No console errors or warnings
- [x] I've rebased on latest `master`
