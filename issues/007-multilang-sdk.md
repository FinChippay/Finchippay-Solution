# Issue #7 — Multi-Language SDK Generation (Python, Go, Rust)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `sdk` `api` `developer-experience` `help wanted`

> This is an sdk issue for the GrantFox FWC26 campaign (Stellar Wave). Generate Python, Go, and Rust client libraries from the backend's OpenAPI spec so non-TS developers can integrate Finchippay.

## Requirements and Context

The backend exposes a Swagger/OpenAPI 3.0 spec at `/api/docs.json` (`backend/src/swagger.js`), and the TypeScript SDK lives in `sdk/` (`client.ts`, `types.ts`, `index.ts`). The roadmap lists "Multi-language SDKs (Python, Go, Rust) with generated bindings" as open. A generated, typed client in each language removes hours of hand-written HTTP for integrators.

## Objectives
1. Add OpenAPI-based generation for Python, Go, and Rust clients.
2. Wrap each generated client with a thin hand-written layer for SEP-0010 auth and error handling.
3. Add usage examples (README + one runnable example per language).
4. Add a CI job that regenerates and typechecks/compiles each SDK so bindings can't drift.

## Suggested Execution
1. Fork and branch: `git checkout -b feat/multilang-sdk`.
2. Use `openapi-generator-cli` (or per-language generators) against `backend/src/swagger.js` output to scaffold `sdk/python`, `sdk/go`, `sdk/rust`.
3. Add auth/error wrappers and a `README.md` with a working example in each language.
4. Add a CI step (`.github/workflows/sdk-check.yml` or a new job) that regenerates and builds all SDKs.
5. Open a PR with `Closes #N`.

## Acceptance Criteria
- [ ] Python, Go, and Rust clients are generated from the OpenAPI spec and build/run.
- [ ] Each SDK provides typed methods for the core endpoints (accounts, payments, analytics, auth).
- [ ] Each SDK handles SEP-0010 auth and returns structured errors.
- [ ] A CI job regenerates and compiles all SDKs, failing on drift.
- [ ] README examples runnable with a local backend (`npm run dev`).

## Guidelines
- Generated code is reproducible (generator config committed); hand-written wrappers are idiomatic per language.
- No secrets or tokens committed; use env vars/args for auth.
- Document regeneration commands in the SDK README.

## Timeframe
96 hours
