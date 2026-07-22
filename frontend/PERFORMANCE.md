# Performance Budgets
## Lighthouse Thresholds
| Category | Minimum Score |
|----------|--------------|
| Performance | 80 |
| Accessibility | 90 |
| Best Practices | 90 |
| SEO | 90 |
## Metric Budgets
| Metric | Limit |
|--------|-------|
| First Contentful Paint | 2000ms |
| Largest Contentful Paint | 3500ms |
| Total Blocking Time | 300ms |
| Cumulative Layout Shift | 0.1 |
## Running Locally
npm run lhci
## CI
Lighthouse CI runs on every PR via .github/workflows/ci.yml. PRs failing budget thresholds are blocked from merging.

