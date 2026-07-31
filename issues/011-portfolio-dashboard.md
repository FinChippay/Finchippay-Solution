# Issue #11 — Portfolio Dashboard with Real-Time P&L Tracking

**Labels:** `frontend` `feature` `dashboard` `portfolio`

## Summary
Build a comprehensive portfolio dashboard that shows users their real-time token holdings, value in USD, P&L tracking, historical performance, and asset allocation visualisation.

## Background
The current dashboard (`frontend/pages/dashboard.tsx`) shows XLM balance, USDC balance, and a basic spending chart. The `PortfolioAllocation` and `PortfolioOverview` components exist in `frontend/components/` but are not integrated into the main dashboard. There's no P&L tracking or aggregate portfolio value.

## Problem Statement
Users cannot see their total portfolio value across all assets, track performance over time, or understand their asset allocation — critical features for a payment/wallet app.

## Objectives
1. Integrate `PortfolioOverview` and `PortfolioAllocation` into the dashboard.
2. Add real-time price feeds for all held assets.
3. Implement P&L calculation (7d, 30d, all-time).
4. Add historical portfolio value chart.
5. Write tests and Storybook stories.

## Scope
- **In scope:** portfolio widget integration, price feeds, P&L, historical chart.
- **Out of scope:** DeFi yield tracking, cross-chain portfolio.

## Detailed Implementation Requirements

1. **Price feed enhancement:** Update `frontend/lib/portfolio.ts` to fetch prices for all held tokens from CoinGecko API. Map Stellar asset codes to CoinGecko IDs. Cache prices in localStorage with 5-minute TTL.

2. **PortfolioOverview integration:** Render `PortfolioOverview` as the first section in the dashboard after the wallet card. It should show:
   - Total portfolio value in USD
   - 24h change (absolute and percentage)
   - 7d P&L
   - Asset count

3. **PortfolioAllocation integration:** Render `PortfolioAllocation` in a new "Allocation" section showing a donut/treemap chart of asset distribution by USD value.

4. **P&L calculation:** For each asset, track balance snapshots over time. Use indexDB (via `idb-keyval` or localStorage) to store daily balance snapshots. Compute P&L as `(current_value - average_cost_basis) × holdings`.

5. **Historical chart:** Add a "Portfolio Value Over Time" chart using recharts (already a dependency). Show line chart of daily portfolio values for the last 30 days with tooltips.

6. **Refresh mechanism:** Add a "Refresh Prices" button and auto-refresh every 60 seconds when the dashboard is active.

7. **Tests:** Update `frontend/__tests__/portfolio.test.ts`. Test `PortfolioAllocation` component rendering, `PortfolioOverview` P&L calculation, price cache logic.

8. **Error handling:** Graceful degradation when price feeds are unavailable — show balances in XLM with a "prices unavailable" indicator.

## Expected Architecture

```
frontend/
├── components/
│   ├── PortfolioOverview.tsx      (UPDATE: add P&L, 24h change)
│   └── PortfolioAllocation.tsx    (UPDATE: add historical chart toggle)
├── lib/
│   └── portfolio.ts              (UPDATE: add price feed, P&L calc)
├── pages/
│   └── dashboard.tsx             (UPDATE: integrate portfolio widgets)
└── __tests__/
    ├── PortfolioAllocation.test.tsx (UPDATE)
    └── portfolio.test.ts           (UPDATE)
```

## Acceptance Criteria
- [ ] PortfolioOverview shows total USD value with 24h change.
- [ ] PortfolioAllocation shows interactive asset distribution chart.
- [ ] Price feeds update automatically with 60s refresh.
- [ ] P&L calculated correctly for 7d and 30d periods.
- [ ] Wallet SSR test (`wallet-ssr.test.ts`) passes (no SSR issues).
- [ ] All existing tests continue to pass.
- [ ] Price feed failure shows graceful degradation.
- [ ] Storybook stories updated for portfolio components.
