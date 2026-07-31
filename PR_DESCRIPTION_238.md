## Summary

Adds privacy-preserving rate-limit observability with Prometheus counters, a rolling admin analytics endpoint, and ready-to-import Grafana panels. Client IPs are represented only by HMAC-SHA256 hashes, while a fail-closed Stellar account allowlist protects the stats endpoint.

## Type of change

- [x] Bug fix
- [x] New feature
- [x] Documentation update
- [ ] Refactor / chore
- [ ] Smart contract change

## Related issue

Closes #238

## Changes

- Instrument global, strict, and sensitive limiters with allowed/blocked decision metrics while preserving their existing limits, headers, and 429 bodies.
- Register `rate_limit_hits_total`, `rate_limit_breaches_total`, and `rate_limit_bypassed_total` in the existing Prometheus registry.
- Hash client addresses with HMAC-SHA256 before storing or exposing them, normalize dynamic route labels, and bound the in-memory event history.
- Add admin-only `GET /api/admin/rate-limit-stats` with top 10 limited client hashes, per-route decision rates, and 24-hour breach history.
- Require both a valid JWT and membership in the `ADMIN_PUBLIC_KEYS` allowlist for the analytics endpoint.
- Require a strong, stable IP-hash salt during production environment validation.
- Add five rate-limit Grafana panels plus the rate-limiting operations runbook and environment examples.
- Remove pre-existing merge-label residue from the backend package manifests so npm can parse the locked dependency tree.

## Testing

- [ ] Tested locally on Testnet
- [x] Added/updated unit tests
- [ ] Manually tested UI flow

Validated locally:

- `npm.cmd test -- --runInBand --runTestsByPath __tests__\rateLimitMetrics.test.js __tests__\validateEnv.test.js` — 38 tests passed.
- ESLint passed for all changed backend source modules.
- Node syntax checks passed for all new and directly modified standalone modules.
- Backend package manifests and `docs/grafana-dashboard.json` parse as valid JSON.
- `git diff --check` passed.

The complete upstream backend suite cannot currently start because `master` already contains unresolved merge-label residue across unrelated routes, controllers, and services. This PR removes the package-manifest residue needed to install dependencies but intentionally does not rewrite those unrelated source files.

## Screenshots (if UI change)

N/A — backend observability and provisioned Grafana dashboard JSON only.

## Checklist

- [x] My code follows the project style
- [x] I've updated docs if needed
- [x] No console errors or warnings in the focused test suite
- [x] I've rebased on latest `master`
