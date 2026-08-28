## Summary

Adds an interactive token portfolio dashboard (`/portfolio`): total value, 24h change, an allocation donut chart, and per-token price history (7d/30d/90d), backed by a new cached price-history endpoint. Also includes seven small, isolated fixes for pre-existing bugs that were blocking the build and manual QA of this feature.

## Type of change

- [x] Bug fix
- [x] New feature
- [ ] Documentation update
- [ ] Refactor / chore
- [ ] Smart contract change

## Related issue

Closes #362

## Changes

**Backend**
- `backend/src/routes/tokens.js` (NEW) — `GET /api/v1/tokens/:contractId/price-history?range=7d|30d|90d`, Zod-validated.
- `backend/src/services/tokenPriceService.js` (NEW) — maps known assets (native XLM, USDC) to their Soroban contract IDs and CoinGecko ids, fetches price history from CoinGecko, caches for 5 minutes via the existing `cacheService.js`. Unknown contract IDs return an empty result instead of erroring.
- `backend/src/validation/schemas.js` — new `tokenContractIdParamSchema`, `tokenPriceHistoryQuerySchema`.
- `backend/src/server.js` — registers the route at `/api/v1/tokens` (the one endpoint in the API that doesn't follow the existing `/api/<name>` convention, per the issue's literal spec).

**Frontend**
- `lib/portfolio.ts` (NEW) — derives each holding's contract ID from Horizon balances, custom-token / fiat-currency preferences (`localStorage`), and a `fetchTokenPrices()` helper (one CoinGecko call for USD/EUR/GBP + 24h change).
- `components/PortfolioOverview.tsx` (NEW) — total value card, 24h change (green/red), per-token rows.
- `components/PortfolioAllocation.tsx` (NEW) — donut chart with a clickable legend that drives the price chart.
- `components/TokenPriceChart.tsx` (NEW) — line chart with a 7d/30d/90d range selector.
- `pages/portfolio.tsx` — replaced the existing "Coming Soon" scaffold's placeholder content (behind the `new_portfolio` flag from #103) with the real implementation; added the missing "connect your wallet" state.
- `components/Navbar.tsx` — added the "Portfolio" nav link.
- i18n: new `portfolio.*` / `nav.portfolio` keys in all 5 locales (en/es/fr/ar/he).
- Chart tooltips now use the app's `--color-surface` / `--color-text` / `--color-border` CSS variables instead of recharts' fixed white default, so they respect dark/light mode.

**Pre-existing bug fixes** (found while getting this feature to build and testing it manually — each is its own commit, none touch portfolio code):
1. `frontend/components/FeeEstimator.tsx` — component was imported and rendered by `SendPaymentForm.tsx` but never created; broke every build.
2. `frontend/package.json` — `recharts` requires `react-is` as a peer dependency; it was missing, breaking any page using charts.
3. `frontend/utils/format.ts` — `formatDate` was both imported from `intlFormat.ts` and declared locally, a duplicate-identifier compile error.
4. `frontend/lib/stellar.ts` — added the missing `getContractTipCount()` wrapper (`CreatorTipsDashboard.tsx` called it; the underlying contract-client method already existed).
5. `frontend/pages/settings.tsx` — duplicate `signTransactionWithWallet` import broke compilation of `/settings`.
6. `backend/src/server.js` — CORS `allowedHeaders` was missing `traceparent`/`tracestate` (headers the frontend's OpenTelemetry instrumentation attaches to every request), which was silently blocking `/api/features` and the SEP-10 login flow in the browser.
7. `frontend/jest.config.js` / `frontend/jest.config.ts` — merging in `upstream/master` (23 commits this branch was missing) brought a duplicate, incomplete `jest.config.js` that shadowed the working `jest.config.ts` and broke every `.tsx` test suite. Removed the redundant config and aligned `jest.config.ts` with how `upstream/master` now loads `jest.setup.ts`/`@testing-library/jest-dom`.

## Testing

- [x] Tested locally on Testnet
- [x] Added/updated unit tests
- [x] Manually tested UI flow

**Coverage:**
- Backend: `backend/__tests__/tokens.test.js` — 7/7 passing (range validation, unknown contract ID, caching, provider failure).
- Frontend unit: `portfolio.test.ts`, `PortfolioOverview.test.tsx`, `PortfolioAllocation.test.tsx`, `TokenPriceChart.test.tsx` — 27/27 passing.
- Frontend E2E: `e2e/portfolio.spec.ts` (NEW) — 4/4 passing locally, stable across 3 consecutive runs (wallet-not-connected prompt, overview/allocation/chart rendering, invalid contract ID rejected, custom token added).
- Manual: full flow verified in-browser against a funded Stellar testnet account via Freighter — real Horizon balance, real CoinGecko price data, range selector, currency switcher, donut-to-chart selection, Add Token.
- `type-check` and `lint`: clean on every file this PR touches.
- Full existing Jest suite: 431/473 passing. Confirmed via `git stash` that the 42 failing tests already fail on `master`, unrelated to this branch.

## Known limitations (out of scope for this PR)

- Custom tokens added by contract ID show "Price unavailable" unless they're XLM or USDC — there's no way in this codebase yet to resolve an arbitrary Soroban contract to a price feed or to its symbol/name. This was a deliberate scope decision made during planning, not an oversight.
- `npm run build` still fails for the repo as a whole — re-checked after merging `upstream/master` in, still fails at the same pre-existing, unrelated error (`components/HighlightedTransactionRow.tsx:78`, a type comparison with no overlap), part of a larger chain of ~75 pre-existing TypeScript errors (also `components/RecurringPayments.tsx`'s missing `listStreamsByPayer`, etc). None of these files are touched by this PR. Because the E2E CI job serves a production build, it cannot currently run to completion in CI either, even though the new E2E test passes locally against `next dev`.
- `npm run i18n:check` can't run in this environment — `i18next-scanner` was never added as a dependency despite the script referencing it. Locale JSON was instead validated with `JSON.parse` on all 5 files.
- A pre-existing, app-wide Next.js dev-mode hydration warning (reproducible on `master` via the existing `wallet-connect.spec.ts`) renders a click-intercepting error overlay in `next dev` only; it doesn't affect production builds. The new E2E test works around it defensively rather than fixing the root cause.

## Screenshots

Not captured — this PR was built and verified without browser-automation tooling in the session; all UI verification above was done by hand against a live Freighter/testnet session. Happy to attach screenshots on request.

## Checklist

- [x] My code follows the project style
- [x] I've updated docs if needed (i18n strings, this PR description)
- [ ] No console errors or warnings — see "Known limitations": a pre-existing, unrelated hydration warning appears in `next dev` on every page, including this one
- [x] I've rebased on latest `main` — merged `upstream/master` (23 commits) in, resolved a real content conflict in `ar`/`he` locale files, and fixed a Jest config regression that merge introduced
