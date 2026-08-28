# Issue #4 — Multi-Network Switching (Testnet ↔ Mainnet) per Session

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `network` `ux` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add a per-session network switcher so users can flip between Stellar testnet and mainnet without rebuilding or editing env vars.

## Requirements and Context

Network configuration is currently baked in at build time via `frontend/lib/stellarConfig.ts` and `NEXT_PUBLIC_*` env vars. The roadmap lists "Multi-network switching (testnet ↔ mainnet) per-session" as a mainnet-readiness item. Users need to switch networks from the UI, with clear visual indication of the active network.

## Objectives
1. Introduce a `NetworkProvider` context (`testnet` | `mainnet`) supplying the active network passphrase, Horizon URL, and Soroban RPC URL.
2. Add a network switcher to the Navbar with a prominent "testnet/mainnet" indicator.
3. Route all wallet, SDK, and contract calls through the active network config (no hardcoded `NEXT_PUBLIC_*` reads in components).
4. Persist the selection per session (and warn before signing mainnet transactions).

## Suggested Execution
1. Fork and branch: `git checkout -b feat/network-switcher`.
2. Create `frontend/lib/NetworkContext.tsx` and refactor `stellarConfig.ts` into a per-network resolver.
3. Replace direct env-var reads in `frontend/lib/soroban.ts`, `wallet.ts`, `stellar.ts`, and `sdk-instance.ts` with context-driven values.
4. Add the switcher to `frontend/components/Navbar.tsx` with a clear active-network badge.
5. Add tests for network resolution and the switcher; run `npm run lint && npm run type-check && npm test`.

## Acceptance Criteria
- [ ] Users can switch between testnet and mainnet from the Navbar without a rebuild.
- [ ] The active network is always visible (badge/color) and persisted for the session.
- [ ] Wallet connect, payments, Soroban contract calls, and SDK calls all use the active network's passphrase/RPC URLs.
- [ ] A confirmation prompt appears before signing on mainnet.
- [ ] Unit tests cover network resolution and switching; `npm run lint`, `npm run type-check`, and `npm test` pass.

## Guidelines
- TypeScript strict (no `any`); `npm run type-check` clean.
- Follow existing context/hook patterns (`useWallet`, `ThemeContext`).
- WCAG 2.1 AA: network state conveyed by more than color; touch target ≥44px.

## Timeframe
72 hours
