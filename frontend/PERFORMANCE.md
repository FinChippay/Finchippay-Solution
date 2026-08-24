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


## Bundle Size Optimization

### Dynamic Imports

Large dependencies are lazy-loaded with `next/dynamic`:

```tsx
const TradeForm = dynamic(() => import('@/components/TradeForm'), {
  loading: () => <TradeFormSkeleton />,
  ssr: false, // Stellar SDK uses browser APIs
});
```

### Tree Shaking

Import only what you need from `@stellar/stellar-sdk`:

```typescript
// Good: tree-shakeable
import { Asset, TransactionBuilder } from '@stellar/stellar-sdk';

// Avoid: imports entire SDK
import * as StellarSdk from '@stellar/stellar-sdk';
```

### Image Optimization

Use `next/image` for all static assets. For dynamic content (NFT receipts,
avatars), use the `unoptimized` prop with an explicit `width`/`height` to
avoid layout shift.

### Caching Strategy

API responses are cached with `stale-while-revalidate` via the service worker:
- Balance queries: 30 second TTL
- Transaction history: 2 minute TTL
- Exchange rates: 5 minute TTL
- Contract state: 1 minute TTL

### Route-level code-splitting inventory

| Route / interaction | Deferred module | Loading strategy |
| --- | --- | --- |
| Dashboard | Payment-stat charts and portfolio widget (`recharts`) | `next/dynamic`, client-only, skeleton fallback |
| Portfolio | Allocation and price charts (`recharts`) | `next/dynamic`, client-only after a wallet connects |
| Trade | `TradeForm` (Stellar transaction helpers) | `next/dynamic`, client-only when the Trade tab is displayed |
| Transaction receipt / PDF export | `jspdf` and `jspdf-autotable` | Native `import()` only after the download button is pressed |

### Bundle analysis and budgets

Run `npm run analyze` from `frontend/` to generate the `@next/bundle-analyzer`
report. The script uses Next's webpack build because the analyzer does not emit
reports for Turbopack builds. Capture the report artifact in CI and investigate any route whose first-load
JavaScript increases by more than **15%** versus the base branch. The dashboard,
portfolio, trade, and transactions routes must keep charting and PDF libraries out
of their initial route chunks; these libraries belong only to their deferred chunks.

Before merging a bundle-affecting change, run `npm run build`, `npm run type-check`,
and a Lighthouse comparison against the base branch. The change is acceptable only
when the Performance score meets the thresholds above and Total Blocking Time does
not regress.
