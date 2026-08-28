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
