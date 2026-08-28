# Issue #10 — Raise Test Coverage to 80%+ Across Components

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `testing` `coverage` `good first issue`

> This is a testing issue for the GrantFox FWC26 campaign (Stellar Wave). Raise the frontend test coverage to the project's stated 80% lines / 70% branches / 75% functions threshold and enforce it in CI.

## Requirements and Context

The roadmap sets coverage thresholds of 80% lines / 70% branches / 75% functions ("Increase test coverage to 80%+ across all components" is still open). The frontend has many components with thin or missing unit coverage. This is an ideal first contribution: mechanical, well-bounded, and easy to review incrementally.

## Objectives
1. Identify the lowest-coverage components from the existing Jest coverage report.
2. Add focused unit tests for uncovered branches in `frontend/components/` and `frontend/lib/`.
3. Enable/verify the coverage thresholds in the Jest config and CI.
4. Document how to run the coverage report locally.

## Suggested Execution
1. Fork and branch: `git checkout -b test/coverage-80`.
2. Run `npm test -- --coverage` in `frontend/` and list the least-covered files.
3. Add tests until the 80/70/75 thresholds pass; prioritise lib utilities and form validation.
4. Confirm thresholds are enforced in CI (`.github/workflows/ci-core.yml` or Jest config).
5. Open a PR with `Closes #N`; include a before/after coverage snippet.

## Acceptance Criteria
- [ ] `npm test -- --coverage` reports ≥80% lines, ≥70% branches, ≥75% functions for the frontend.
- [ ] Coverage thresholds are enforced in CI so a drop fails the build.
- [ ] New tests are meaningful (assert behaviour, not snapshots-only) and pass.
- [ ] `npm run lint` and `npm run type-check` pass.

## Guidelines
- Follow existing test conventions in `frontend/__tests__/`.
- Don't lower thresholds or add `/* istanbul ignore */` to pass — exceptions need a documented rationale.
- Keep PRs scoped to coverage only (no unrelated refactors).

## Timeframe
48 hours
