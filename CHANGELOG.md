# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses semantic versioning for release sections where a version is known.

## [Unreleased]

### Added

- Architecture diagram showing how the frontend, backend, Horizon, Soroban RPC, Freighter, and `MicroPayContract` interact.
- Freighter setup instructions for new contributors, including testnet account creation and Friendbot funding.
- Soroban contract function reference covering parameters, return values, authorization, events, and error conditions.
- Project changelog.

## [1.0.0] - 2026-06-01

### Added

- Next.js frontend for Stellar payments, dashboard balances, transaction history, contacts, payment requests, creator tip pages, trading, settings, and network statistics.
- Freighter wallet integration for connection, SEP-0010 authentication, transaction signing, and local wallet state management.
- Stellar Horizon integration for account loading, balance lookups, payment history, fee statistics, transaction submission, and live network data.
- Express backend API for accounts, auth, payments, federation, tips, analytics, Turrets automation, scheduled transactions, and webhook support.
- Soroban `MicroPayContract` with admin initialization, admin transfer, tip recording, tip queries, receipt metadata minting, receipt queries, and batch sends.
- Test coverage across frontend Jest suites, backend Jest suites, Playwright end-to-end tests, and Soroban contract tests.
- CI workflow for frontend lint/type-check/test/build, backend lint/test, contract check/test/build, and Playwright E2E.
- Production and development Docker configuration, PWA/offline support, Dependabot configuration, editor settings, and deployment documentation.

### Changed

- Pinned the project runtime to Node.js `20.19.5`.
- Updated Freighter support to the v3 API surface.
- Added storage TTL extension for persistent Soroban contract data.
- Expanded transaction history with filtering, pagination, CSV/JSON export, PDF receipt support, memo search, category labels, and copyable transaction hashes.
- Improved payment UX with confirmation/status modals, send-max safety copy, unfunded-account Friendbot flows, QR code support, and destination scanning.
- Added accessibility and UI quality improvements, including focus management, contrast fixes, icon labels, and consistent cursor states.

### Fixed

- CI blockers across frontend TypeScript, frontend lint, backend lint, backend tests, and package lockfiles.
- Route ordering, wallet callback, FeeBump transaction handling, path payment, health route, and merge-conflict issues found during feature integration.

## [0.1.0] - 2026-03-15

### Added

- Initial Stellar MicroPay codebase for a cross-border micro-payments platform.
- Initial frontend, backend, Stellar SDK, Freighter API, and Soroban contract scaffolding.
- Base project documentation and MIT license.
