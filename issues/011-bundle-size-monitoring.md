# Issue #11 — Bundle Size Monitoring

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `devops` `performance` `bundle-size` `ci`

> This is a devops issue for the GrantFox FWC26 campaign (Stellar Wave). Add automated bundle-size budgets to CI so PRs can't silently regress the frontend's JS payload.

## Requirements and Context

The frontend has grown many large pages/components and uses dynamic imports, but there is no `size-limit`/`bundlesize` check (`.size-limit.js` does not exist). Bundle creep degrades load time, especially on mobile. A CI budget makes regressions visible at review time.

## Objectives
1. Add `size-limit` (or `@size-limit/preset-app`) as a dev dependency.
2. Define per-page and total-JS budgets in a `frontend/.size-limit.js` config.
3. Add a CI step that runs the size check and fails on overages.
4. Document the budgets and how to update them deliberately.

## Suggested Execution
1. Fork and branch: `git checkout -b feat/bundle-size-budget`.
2. Add `size-limit` + a `"size": "size-limit"` script in `frontend/package.json`.
3. Create `frontend/.size-limit.js` with budgets for `_app`, `dashboard`, `escrow`, and total JS.
4. Add a `size` step to the frontend CI job (`.github/workflows/ci-core.yml`).
5. Document budgets in `frontend/PERFORMANCE.md`; open a PR with `Closes #N`.

## Acceptance Criteria
- [ ] `npm run size` measures the production build against the configured budgets.
- [ ] CI fails when any budget is exceeded.
- [ ] Budgets are initialised to current sizes with a small headroom (documented baseline).
- [ ] `frontend/PERFORMANCE.md` documents the budgets and the process to change them.

## Guidelines
- Budgets are a baseline, not a ceiling to hit — document how to raise them responsibly.
- No new runtime dependencies beyond the size-limit tooling.

## Timeframe
48 hours
