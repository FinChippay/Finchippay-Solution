# Finchippay Code Quality Guidelines

## Project Overview

Finchippay is a Stellar-based payment solution with zero-knowledge cryptography. The monorepo contains:

- **frontend/** — Next.js 14 (Pages Router), React 18, TypeScript, Tailwind CSS
- **backend/** — Node.js/Express, PostgreSQL/SQLite via Knex.js, Redis, Zod validation
- **sdk/** — @finchippay/sdk TypeScript client library
- **contracts/finchippay-contract/** — Rust Soroban smart contracts
- **terraform/** — DigitalOcean infrastructure as code
- **kubernetes/** — K8s manifests + Helm charts

## Architecture Principles

### Error Handling
- Backend: Use `shared/errorCodes.js` for all error responses. Every async route must have try/catch.
- Frontend: Wrap data-fetching in try/catch. Display user-friendly error states, not raw stack traces.
- Contracts: Use `ContractError` enum variants, never `panic!()`.

### Validation
- Backend: All request bodies validated with Zod schemas before processing.
- Frontend: Form inputs validated client-side with proper error messages.
- Contracts: Validate all function arguments; check authorization for state-changing operations.

### Security
- **Stellar keys**: Never hardcode. Always from env vars or secure key storage.
- **SQL injection**: Parameterized queries only via Knex.js query builder.
- **XSS**: React's JSX auto-escapes, but be careful with dangerouslySetInnerHTML.
- **Rate limiting**: All auth and payment endpoints must be rate-limited.
- **CORS**: Backend uses the ALLOWED_ORIGINS env var; never use `*` in production.

### Testing
- Unit tests: Jest for JS/TS, `cargo test` for Rust.
- Integration tests: Supertest for backend API, Playwright for E2E.
- Contract fuzz testing: cargo-fuzz with libFuzzer.
- Coverage: Aim for >80% on new code paths.

### CI/CD
- All PRs must pass CI (lint, type-check, test, build) before merge.
- Vercel deploys preview environments on PRs.
- Docker images published to ghcr.io on main pushes.
- Terraform plan runs on PR, apply on main merge.

## Common Patterns

### Backend API Route
```js
// ✅ Correct
router.post('/payments', validate(createPaymentSchema), async (req, res) => {
  try {
    const result = await paymentService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
```

### Frontend Data Fetching
```tsx
// ✅ Correct
const { data, error, isLoading } = useSWR('/api/payments', fetcher);
if (isLoading) return <LoadingSpinner />;
if (error) return <ErrorState message={error.message} />;
```

### Soroban Contract Method
```rust
// ✅ Correct
pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), ContractError> {
    from.require_auth();
    if amount <= 0 { return Err(ContractError::InvalidAmount); }
    // ... checked arithmetic ...
    Ok(())
}
```

## Prohibited Patterns
- ❌ `console.log` in production code (use pino logger)
- ❌ `any` type in TypeScript without justification comment
- ❌ Raw SQL string concatenation
- ❌ Hardcoded secrets, keys, or tokens
- ❌ `panic!()` in Soroban contracts (use ContractError)
- ❌ Inline styles in JSX (use Tailwind classes or CSS modules)
- ❌ Skipping error handling with empty catch blocks
- ❌ Direct DOM manipulation (use React state/refs)
