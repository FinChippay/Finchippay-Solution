# Contributing to Finchippay-Solution

Thank you for your interest in contributing to **Finchippay-Solution**!

## Getting Started

1. Fork the repository at https://github.com/FinChippay/Finchippay-Solution
2. Clone your fork: `git clone https://github.com/<your-handle>/Finchippay-Solution.git`
3. Set up your local environment: `bash scripts/setup-dev.sh`
4. Create a feature branch: `git checkout -b feature/your-feature`

## Development Workflow

### Running locally

```bash
# Backend
cd backend && cp .env.example .env && npm install && npm run dev

# Frontend (new terminal)
cd frontend && cp .env.example .env && npm install && npm run dev

# Smart contract
cd contracts/finchippay-contract && cargo test
```

### Before opening a PR

| Check | Command |
|---|---|
| Backend lint | `cd backend && npm run lint` |
| Backend tests | `cd backend && npm test` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend type-check | `cd frontend && npm run type-check` |
| Frontend unit tests | `cd frontend && npm test` |
| Contract tests | `cd contracts/finchippay-contract && cargo test` |
| SBOM / vuln scan (optional) | `make sbom-scan` (requires [syft](https://github.com/anchore/syft) + [grype](https://github.com/anchore/grype)) |
| Error code docs | `npm run docs:errors` |

All checks must pass before a PR will be merged.

## Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add streaming payment support
fix: handle zero-balance account on dashboard
docs: update API reference for /api/tips
test: add escrow cancel edge-case tests
chore: bump soroban-sdk to 21.0.0
```

## Pull Request Guidelines

- Keep PRs focused — one feature or bug-fix per PR.
- Add or update tests for any new behaviour.
- Update relevant docs and the CHANGELOG under `[Unreleased]`.
- Reference any related GitHub issues with `Closes #<issue>`.

## Code Style

- **Rust (Soroban)**: `rustfmt` default style; `clippy` with `--deny warnings`. All arithmetic must use `checked_*` methods. Every mutating contract function must authenticate the caller with `require_auth()`. New features must include tests and consider bounds/limits to prevent griefing.
- **TypeScript/JavaScript**: Prettier + ESLint (configs in repo root). Never log or commit Stellar secret keys. Use regex redaction (`S[A-Z2-7]{55}`) before any logging.
- **Error codes**: When you add, remove, or rename a code in `shared/errorCodes.js`, regenerate the documentation so it cannot drift from the source of truth:

  ```bash
  npm run docs:errors
  ```

  CI runs `npm run docs:errors:check` and fails if the committed `docs/error-codes.md` does not match the current catalogue.
- **CSS**: Tailwind utility classes; avoid custom CSS unless necessary.

## Reporting Issues

Please use the GitHub issue templates:
- [Bug report](https://github.com/FinChippay/Finchippay-Solution/issues/new?template=bug_report.md)
- [Feature request](https://github.com/FinChippay/Finchippay-Solution/issues/new?template=feature_request.md)

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).

## CI Pipeline

All PRs are gated by 13 CI jobs: frontend (lint, i18n, type-check, unit, build), backend (format, lint, unit, integration, migrations), contracts (check, test, WASM build, bindings drift), fuzz (10 libFuzzer targets), E2E (Playwright), accessibility (Axe + Lighthouse), error docs (drift check), SBOM (Grype scan), and config validation. See CI_CD.md for details.

## Internationalization (i18n)

Finchippay supports 12 languages. Translations live in `frontend/public/locales/`
as JSON files keyed by namespace (`common`, `errors`, `onboarding`).

### Adding a New Language

1. Copy `frontend/public/locales/en/` to `frontend/public/locales/<lang>/`
2. Translate all string values (keys must remain unchanged)
3. Add the language code to `frontend/next.config.mjs` under `i18n.locales`
4. Run `npm run i18n:scan` in the frontend to validate no keys are missing

### Translation Guidelines

- Use ICU MessageFormat for plurals: `"items": "{count, plural, one {# item} other {# items}}"`
- Never concatenate strings for UI; use full sentence templates
- Interpolation variables use `{{variable}}` syntax
- Monetary amounts always display in the user's locale with proper decimal separators

### CI Validation

Every PR runs `i18next-scanner` to detect missing or unused translation keys.
The CI job fails if any key is referenced in code but not present in all
supported locale files.

## Database Migrations

Migrations use Knex and must be cross-dialect compatible (SQLite for dev/test,
PostgreSQL for production).

### Rules

1. Use `knex.schema.alterTable()` with `columnInfo()` for additive changes —
   never raw `ALTER TABLE` SQL that only works on one dialect.
2. Index creation uses `CREATE INDEX IF NOT EXISTS` (supported by both SQLite
   and PostgreSQL).
3. Every migration must have a corresponding `down` function for rollback.
4. Seed files in `backend/seeds/` are development-only and never run in CI.
5. Check migration status before deployment: `npm run migrate:status`

### Testing Migrations

```bash
# Test against SQLite (default dev database)
cd backend && npm run migrate && npm run migrate:rollback && npm run migrate

# Test against PostgreSQL (CI simulation)
DATABASE_CLIENT=pg npm run migrate
```
