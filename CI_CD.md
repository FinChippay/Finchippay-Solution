# CI/CD Pipeline Documentation — Finchippay-Solution

Comprehensive reference for every automated workflow in the Finchippay-Solution CI/CD pipeline (15 workflows total).

---

## Table of Contents

- [Pipeline Overview](#pipeline-overview)
- [Quick Reference](#quick-reference)
- [Workflow Details](#workflow-details)
  - [Continuous Integration (CI)](#continuous-integration-ci)
  - [Docker & Container](#docker--container)
  - [Deployment](#deployment)
  - [Security & Compliance](#security--compliance)
  - [Release & Distribution](#release--distribution)
  - [Automation & Maintenance](#automation--maintenance)
- [Required Secrets](#required-secrets)
- [Troubleshooting](#troubleshooting)
- [Pipeline Conventions](#pipeline-conventions)
- [Adding a New Workflow](#adding-a-new-workflow)

---

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          PULL REQUEST (→ main)                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐               │
│  │  CI  │  │ CodeQL   │  │ SDK     │  │ Contract     │               │
│  │(13j) │  │ Security │  │ Drift   │  │ Bindings     │               │
│  └──┬───┘  └──────────┘  └─────────┘  └──────────────┘               │
│     │                                                                 │
│     ├── frontend (lint, i18n, type-check, unit, build)               │
│     ├── visual-regression (Chromatic)                                 │
│     ├── backend (lint, format, unit, integration, migrations)         │
│     ├── contracts (check, test, build WASM)                           │
│     ├── contract-fuzz (10 libFuzzer targets)                          │
│     ├── contract-bindings (drift detection)                           │
│     ├── compose (validate Docker Compose)                             │
│     ├── e2e (Playwright)                                              │
│     ├── lighthouse (Lighthouse + Axe a11y)                            │
│     ├── error-docs (drift check)                                      │
│     ├── validate (config + secret scan)                               │
│     ├── sbom (generate + Grype scan)                                  │
│     └── load-test (workflow_dispatch only)                            │
│                                                                       │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌───────────────┐      │
│  │ Benchmark│  │ Vercel     │  │Terraform │  │ Kubernetes    │      │
│  │          │  │ Preview    │  │ Plan     │  │ Lint+Template │      │
│  └──────────┘  └────────────┘  └──────────┘  └───────────────┘      │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐                           │
│  │ Greptile AI      │  │ Renovate         │                           │
│  │ Review (label)   │  │ Auto-Approve     │                           │
│  └──────────────────┘  └──────────────────┘                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                          PUSH TO main                                 │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌────────────┐  ┌───────────┐  ┌──────────────┐      │
│  │ Docker   │  │ Vercel     │  │ Terraform │  │ Kubernetes   │      │
│  │ Publish  │  │ Production │  │ Apply     │  │ Deploy       │      │
│  └──────────┘  └────────────┘  └───────────┘  └──────────────┘      │
│  ┌──────────┐  ┌────────────┐  ┌───────────┐                         │
│  │ Contract │  │ CodeQL     │  │ SDK Check │                         │
│  │ Deploy   │  │ Scan       │  │           │                         │
│  └──────────┘  └────────────┘  └───────────┘                         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                          VERSION TAG (v*.*.*)                         │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌────────────┐  ┌───────────┐                         │
│  │ Docker   │  │ Release    │  │ Canary    │                         │
│  │ Publish  │  │ (SBOMs)    │  │ Deploy    │                         │
│  └──────────┘  └────────────┘  └───────────┘                         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                          SCHEDULED (weekly)                           │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌────────────┐  ┌───────────┐                         │
│  │ Security │  │ SBOM Scan  │  │ CodeQL    │                         │
│  │ Audit    │  │ (Mon 8 AM) │  │ (Mon 2 AM)│                         │
│  └──────────┘  └────────────┘  └───────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

| # | Workflow | File | Triggers | Key Actions |
|---|----------|------|----------|-------------|
| 1 | **CI** | `ci.yml` | PR → main, push main/develop, manual | 13 jobs: frontend, backend, contracts, fuzz, e2e, SBOM, etc. |
| 2 | **Docker Publish** | `docker-publish.yml` | Push main, version tags | Build → Trivy scan → Push to ghcr.io |
| 3 | **Vercel Deploy** | `vercel-deploy.yml` | PR → main, push main | Preview on PR, blue-green production with health gate |
| 4 | **Canary Deploy** | `canary-deploy.yml` | Manual, release published | Gradual traffic shift (10% → 50% → 100%) |
| 5 | **Release** | `release.yml` | Version tags (`v*.*.*`) | GitHub Release + SBOM assets |
| 6 | **Contract Deploy** | `contract-deploy.yml` | Push master, manual | Build → Deploy → Verify Soroban contract to testnet |
| 7 | **Security Audit** | `security-audit.yml` | Weekly Mon 8 AM, manual | npm audit + cargo audit |
| 8 | **SBOM Scan** | `sbom-scan.yml` | Weekly Mon 8 AM, manual | Generate SBOMs → Grype scan → Create issue on critical |
| 9 | **CodeQL** | `codeql.yml` | PR → main, push main/develop, weekly Mon 2 AM | Security analysis (JS/TS + Rust + custom queries) |
| 10 | **Benchmark** | `benchmark.yml` | PR → main, manual | Performance regression detection |
| 11 | **SDK Check** | `sdk-check.yml` | PR → main, push main | SDK type drift detection |
| 12 | **Renovate** | `renovate-approve.yml` | PR from renovate/dependabot | Auto-approve dependency patches |
| 13 | **Terraform** | `terraform.yml` | PR (terraform/**), push main, manual | fmt → validate → Plan → PR comment → Apply (dev/staging/prod, prod gated) |
| 14 | **Kubernetes** | `kubernetes-deploy.yml` | PR (k8s/**), push main, manual | Build 3 images → Scan → Push → Helm deploy |
| 15 | **Greptile** | `greptile-review.yml`, `greptile-label.yml` | PR → main/develop, issue opened, manual | Config validation + issue context + manual trigger; auto-labels PRs |

---

## Workflow Details

### Continuous Integration (CI)

#### 1. CI (`ci.yml`)

**Triggers:** `pull_request` → main, `push` → main/develop, `workflow_dispatch`

The central pipeline that gates every PR. Contains 13 parallel jobs:

| Job | What it does | Matrix | Blocks merge? |
|-----|-------------|--------|:---:|
| **frontend** | Lint → i18n check → type-check → unit tests → Storybook build → Next.js build | Node 22, 24 | Node 22 only |
| **visual-regression** | Chromatic Storybook visual diff | — | ✅ |
| **backend** | Format → lint → migrate → error-docs check → unit + integration tests | Node 22, 24 | Node 22 only |
| **contracts** | `cargo check` → `cargo test` → integration tests → WASM build | stable, nightly | stable only |
| **contract-fuzz** | 10 libFuzzer targets (60s each), upload crash artifacts | — | ⚠️ (warnings) |
| **contract-bindings** | Generate Soroban bindings → git diff check for drift | — | ✅ |
| **compose** | Validate `docker-compose.yml` and `docker-compose.prod.yml` | — | ✅ |
| **e2e** | Start backend → run Playwright → upload report | — | ✅ |
| **lighthouse** | Lighthouse performance audit + Axe accessibility scan | — | ✅ |
| **error-docs** | Regenerate error code docs → `--check` mode | — | ✅ |
| **validate** | Check required files exist, validate JSON, scan for hardcoded secrets | — | ✅ |
| **sbom** | Syft SBOMs (SPDX + CycloneDX) for all 3 components → Grype scan (fail on HIGH) | — | ✅ |
| **load-test** | k6 scenarios (dashboard, payment-burst, analytics, sustained-load) | — | Manual only |

**Artifacts:** `fuzz-artifacts`, `playwright-report`, `k6-results`, `sboms`

**Node 24 note:** Node 24 runs as a **canary** — `continue-on-error: true` so it never blocks PRs. It surfaces future compatibility issues early.

#### 10. Benchmark (`benchmark.yml`)

**Triggers:** `pull_request` → main, `workflow_dispatch`

- Runs performance smoke tests for frontend and backend
- Generates `benchmarks/current.json`
- Compares against `benchmarks/base.json` and writes `summary.md`
- Uses `scripts/compare-benchmarks.js`

#### 11. SDK Check (`sdk-check.yml`)

**Triggers:** `pull_request` → main, `push` → main

- Runs `npm run check:sdk` from the repo root
- Ensures the generated SDK types in `sdk/` haven't drifted from the OpenAPI spec
- Prevents API contract breakages from going unnoticed

### Docker & Container

#### 2. Docker Publish (`docker-publish.yml`)

**Triggers:** `push` → main, `push` tag `v*.*.*`

```
Build backend → Trivy scan (CRITICAL,HIGH → fail) → Push ghcr.io/finchippay/finchippay-backend
Build frontend → Trivy scan (CRITICAL,HIGH → fail) → Push ghcr.io/finchippay/finchippay-frontend
Generate image SBOMs → Upload artifacts
```

**Tags produced:**
- `sha-<short-sha>` — every push
- `main` — latest main
- `v1.2.3` — version tag

**Permissions needed:** `packages: write`, `security-events: write` (SARIF upload)

### Deployment

#### 3. Vercel Deploy (`vercel-deploy.yml`)

**Triggers:** `pull_request` → main, `push` → main

**Preview (on PR):**
1. `setup-node` → `npm ci` → `npm run build:sdk` → `vercel build`
2. `vercel deploy --prebuilt` → comment PR with preview URL
3. Uses `NEXT_PUBLIC_SENTRY_DSN` for error tracking

**Production (on push to main):**
1. Build SDK → `vercel build --prod`
2. Deploy to staging → **health gate** (`GET /api/health`, 12 retries over 60s)
3. If healthy: `vercel promote` to production
4. If unhealthy: **auto-rollback** — previous deployment stays active, failure notification posted
5. Update GitHub Deployment Status

**Key fix:** Next.js `output: "export"` is **disabled** on Vercel (set only in Docker via `ENV NEXT_OUTPUT=export`), so Vercel gets full SSR/ISR/API route support including `pages/api/health.ts`.

#### 4. Canary Deploy (`canary-deploy.yml`)

**Triggers:** `workflow_dispatch`, `release → published`

- Runs `scripts/canary-deploy.sh` with configurable traffic weights
- Defaults: 10% → 50% → 100% with 5-minute monitoring between stages
- Supports frontend, backend, or both targets
- Posts PR comment with final status

#### 13. Terraform (`terraform.yml`)

**Triggers:** `pull_request` (terraform/** paths), `push` → main, `workflow_dispatch`

| Trigger | Action | Environment |
|---------|--------|-------------|
| PR | `terraform fmt → init → validate → plan` → post as PR comment | dev |
| Push to main | `terraform init → plan → apply -auto-approve` | prod |
| Manual — plan | `terraform plan` only | dev, staging, or prod |
| Manual — apply | `terraform plan → apply -auto-approve` | dev, staging, or prod |
| Manual — destroy | `terraform plan -destroy → apply` | dev, staging, or prod |

**Required secrets:** `AWS_ROLE_ARN` (OIDC role), `TF_STATE_BUCKET`, `TF_STATE_LOCK_TABLE`  
**Optional secrets:** `TF_VAR_allowed_origins`

**Safety:** Production apply requires the `production` GitHub Environment approval gate. Plan artifacts are uploaded and retained for 7 days.

#### 14. Kubernetes Deploy (`kubernetes-deploy.yml`)

**Triggers:** `push` → main, `pull_request` (k8s paths), `workflow_dispatch`

**On PR:**
- Lint Kubernetes manifests with `kubeconform`
- Lint Helm chart with `helm lint`
- Render Helm template → validate with `kubeconform`

**On push to main / manual:**
1. **Build, Scan & Push** (matrix: backend, frontend, nginx):
   - Build image → Trivy scan → Upload SARIF → Push to ghcr.io
   - Tagged as `sha-<short-sha>` + `latest` (on main)
2. **Configure kubeconfig** from `KUBE_CONFIG` secret
3. **Deploy with Helm:** `helm upgrade --install --atomic --wait`
4. **Verify:** `kubectl rollout status` for all 3 deployments
5. **Post deployment summary** to associated PR

**Images published:** `ghcr.io/finchippay/finchippay-backend`, `finchippay-frontend`, `finchippay-nginx`

### Security & Compliance

#### 7. Security Audit (`security-audit.yml`)

**Triggers:** Weekly Monday 8 AM UTC, `workflow_dispatch`

| Job | Scope | Tool |
|-----|-------|------|
| npm-audit-frontend | `frontend/` | `npm audit --audit-level=high` |
| npm-audit-backend | `backend/` | `npm audit --audit-level=high` |
| cargo-audit | `contracts/` | `cargo audit` |

Runs are **non-blocking** (failures create issues, don't block PRs). The CI pipeline also runs audits on every PR.

#### 8. SBOM Scan (`sbom-scan.yml`)

**Triggers:** Weekly Monday 8 AM UTC, `workflow_dispatch`

1. Install Syft + Grype
2. Generate SPDX + CycloneDX SBOMs for frontend, backend, contracts
3. Scan all SBOMs with Grype
4. **If CRITICAL found:** create/update a tracking issue with full vulnerability report
5. Upload SBOM artifacts (retained 90 days)
6. Fail the workflow if CRITICAL vulnerabilities exist

#### 9. CodeQL (`codeql.yml`)

**Triggers:** `pull_request` → main, `push` → main/develop, weekly Monday 2 AM UTC

- Two-language matrix: `javascript-typescript` + `rust`
- Uses **`security-extended` + `security-and-quality`** built-in suites
- **PLUS custom query packs:**
  - `.github/codeql/javascript/` — hardcoded Stellar keys, sensitive data in localStorage, missing webhook signature verification
  - `.github/codeql/rust/` — missing checked arithmetic, unbounded loops, raw panic! instead of ContractError
- Results uploaded to GitHub Security tab

### Release & Distribution

#### 5. Release (`release.yml`)

**Triggers:** Version tag (`v*.*.*`)

```
Generate SBOMs (6 files: SPDX + CycloneDX × 3 components)
    ↓
Create GitHub Release with auto-generated release notes (conventional commits)
    ↓
Attach all 6 SBOMs as release assets
    ↓
Upload SBOM bundle artifact (retained 365 days)
```

**Output:** A release like `v1.2.3` with attached `frontend.spdx.json`, `backend.cdx.json`, etc.

#### 6. Contract Deploy (`contract-deploy.yml`)

**Triggers:** `push` → master, `workflow_dispatch`

1. Build WASM (`cargo build --target wasm32v1-none --release`)
2. Compute local SHA-256 hash
3. Upload WASM artifact
4. Install WASM on-chain via Stellar CLI
5. **Verify:** compare local hash with on-chain hash (fail on mismatch)
6. Deploy contract → get Contract ID
7. Initialize contract (`initialize --admin <address>`)
8. Post deployment summary comment on associated PR
9. Upload deployment outputs artifact

**Required secret:** `STELLAR_DEPLOYER_SECRET`

### Automation & Maintenance

#### 12. Renovate Auto-Approve (`renovate-approve.yml`)

**Triggers:** `pull_request` from `renovate[bot]` or `dependabot[bot]`

- Auto-approves patch and pin dependency updates
- Posts automated review message
- Only runs for bot-authored PRs (gated on `github.actor`)

#### 15. Greptile AI Review (`greptile-review.yml` + `greptile-label.yml`)

Two workflows handle the Greptile integration:

**`greptile-label.yml` — PR labeling (auto-review trigger)**

- **Triggers:** `pull_request_target` → main/develop (types: `opened`, `ready_for_review`, `reopened`, `synchronize`)
- Adds the `needs-review` label (creating it if missing) so the Greptile App picks up the PR for AI review
- Posts a Greptile review context comment on open/ready/reopen (skipped on `synchronize` to avoid comment spam)
- Uses `pull_request_target` because fork PRs get a **read-only** `GITHUB_TOKEN` on `pull_request` — the old `label-pr` job failed with `Resource not accessible by integration`. `pull_request_target` runs in the base-repo context with write permissions, so fork PRs get labeled too.
- **Security:** API-only — never checks out or executes PR code
- **Note:** only triggers when the workflow file is on the default branch (`main`)

**`greptile-review.yml` — validation, issue context, manual trigger**

- **Triggers:** `pull_request` → main/develop, `issues` opened, `workflow_dispatch`
- **On PR:** Validates the Greptile configuration (`.greptile/config.json`, `rules.md`, `files.json`) as a status check
- **On issue:** Posts usage instructions (`@greptileai` commands)
- **Manual (`workflow_dispatch`):** Can trigger review on a specific PR or a full-repo review

**Configuration:** `.greptile/config.json` (16 custom rules across security, code quality, infrastructure), `.greptile/rules.md`, `.greptile/files.json`

**Merge gate:** Branch protection on `main` requires the **Greptile** status check to pass.

---

## Required Secrets

### GitHub Repository Secrets

| Secret | Used By | Required? | Purpose |
|--------|---------|:---:|---------|
| `GITHUB_TOKEN` | All | ✅ | Auto-provided; used for ghcr.io auth, PR comments, API calls |
| `VERCEL_TOKEN` | `vercel-deploy` | ✅ | Vercel API token for deploy CLI |
| `VERCEL_ORG_ID` | `vercel-deploy` | ✅ | Vercel organization ID |
| `VERCEL_PROJECT_ID` | `vercel-deploy` | ✅ | Vercel project ID |
| `NEXT_PUBLIC_SENTRY_DSN` | `vercel-deploy` | ❌ | Sentry DSN for frontend error tracking |
| `AWS_ROLE_ARN` | `terraform` | ✅ | IAM role to assume via OIDC for Terraform plan/apply |
| `TF_STATE_BUCKET` | `terraform` | ✅ | S3 bucket holding Terraform state |
| `TF_STATE_LOCK_TABLE` | `terraform` | ✅ | DynamoDB table for Terraform state locking |
| `TF_VAR_allowed_origins` | `terraform` | ❌ | CORS origins for the deployed app |
| `KUBE_CONFIG` | `kubernetes-deploy` | ✅ | Base64-encoded kubeconfig |
| `JWT_SECRET` | `kubernetes-deploy` | ❌ | JWT signing secret for backend |
| `DB_URL` | `kubernetes-deploy` | ❌ | Database connection string |
| `STELLAR_DEPLOYER_SECRET` | `contract-deploy` | ✅ | Stellar secret key for contract deployment |
| `CHROMATIC_PROJECT_TOKEN` | `ci` (visual-regression) | ❌ | Chromatic project token; skipped if unset |
| `ANTHROPIC_API_KEY` | `ci` (integration tests) | ❌ | Anthropic API key for AI payment parsing tests |
| `AWS_ACCESS_KEY_ID` | `canary-deploy` | ❌ | AWS credentials for ECS canary |
| `AWS_SECRET_ACCESS_KEY` | `canary-deploy` | ❌ | AWS credentials for ECS canary |
| `AWS_REGION` | `canary-deploy` | ❌ | AWS region |
| `ECS_CLUSTER` | `canary-deploy` | ❌ | ECS cluster name |
| `ECS_SERVICE` | `canary-deploy` | ❌ | ECS service name |
| `ALB_LISTENER_ARN` | `canary-deploy` | ❌ | ALB listener ARN |
| `HEALTH_CHECK_URL` | `canary-deploy` | ❌ | Health check URL |

### GitHub Environments

| Environment | Required Approvers | Used By |
|-------------|-------------------|---------|
| `production` | Manual approval gate | `vercel-deploy`, `terraform`, `kubernetes-deploy`, `canary-deploy` |
| `preview` | None | `vercel-deploy` (preview) |
| `testnet` | None | `contract-deploy` |

---

## Troubleshooting

### Common Failures

#### CI: `error-docs` job fails

**Symptom:** `scripts/generate-error-codes-doc.js --check` exits non-zero

**Cause:** Error codes in `shared/errorCodes.js` were modified but the docs weren't regenerated.

**Fix:**
```bash
node scripts/generate-error-codes-doc.js
git add docs/error-codes.md
git commit -m "docs: update error code docs after changes"
```

#### CI: `contract-bindings` job fails

**Symptom:** `git diff --exit-code frontend/lib/contract-bindings/` fails

**Cause:** Contract interface changed but the generated TypeScript bindings weren't committed.

**Fix:**
```bash
bash scripts/gen-contract-bindings.sh
git add frontend/lib/contract-bindings/
git commit -m "chore: regenerate contract bindings"
```

#### CI: `sbom` job fails on Grype scan

**Symptom:** `grype ... --fail-on high` exits non-zero

**Cause:** A HIGH or CRITICAL vulnerability was found in one of the components.

**Fix:**
1. Check the workflow run logs for the specific CVE
2. Update the affected dependency: `npm update <package>` or `cargo update`
3. If the vulnerability has no fix, add a `.grype.yaml` ignore file with a justification comment
4. Re-run the workflow

#### Vercel: Health check fails (12 retries → rollback)

**Symptom:** Deployment succeeds but `/api/health` returns non-200

**Cause:**
- The `pages/api/health.ts` endpoint is missing or broken
- Vercel build produced a static export (NEXT_OUTPUT=export was accidentally set)
- The backend dependency isn't available (Vercel only deploys frontend)

**Fix:**
1. Verify `NEXT_OUTPUT` is NOT set in the Vercel build environment
2. Check that `frontend/pages/api/health.ts` exists and exports a handler
3. Verify the build log shows API routes being compiled, not static export
4. Check the staging URL directly: `curl https://<deploy-url>/api/health`

#### Vercel: `vercel build` fails with SDK import errors

**Symptom:** `Cannot find module '@finchippay/sdk'`

**Cause:** The SDK wasn't built before `vercel build`. The `@finchippay/sdk` workspace package has TypeScript source that needs `tsc` compilation.

**Fix:**
1. Verify `npm run build:sdk` executed successfully in the workflow logs
2. Check that `sdk/package.json` includes `typescript` in devDependencies
3. Verify the SDK's `tsconfig.json` is valid: `npx tsc -p sdk/tsconfig.json --noEmit`

#### Docker: Trivy scan blocks push

**Symptom:** `trivy-action` exits with code 1

**Cause:** A CRITICAL or HIGH vulnerability exists in the container image.

**Fix:**
1. Check the Trivy SARIF report in the Security tab
2. Update the base image or affected packages
3. If it's a false positive or accepted risk, add a `.trivyignore` file:
   ```
   # Accepted: no fix available, low exploitability
   CVE-2024-XXXX
   ```

#### Terraform: Init fails

**Symptom:** `terraform init` fails with authentication errors

**Cause:** Missing or invalid DigitalOcean credentials.

**Fix:**
1. Verify `DIGITALOCEAN_TOKEN` is set in GitHub Secrets
2. Verify `DIGITALOCEAN_SPACES_KEY` and `DIGITALOCEAN_SPACES_SECRET` are valid
3. Check that the Spaces bucket exists for the remote state backend
4. Run `terraform init` locally to isolate the issue:
   ```bash
   cd terraform
   DIGITALOCEAN_TOKEN=<token> terraform init
   ```

#### Kubernetes: Helm deploy fails

**Symptom:** `helm upgrade --install` times out or `kubectl rollout status` fails

**Cause:**
- Invalid `KUBE_CONFIG` secret (not base64-encoded, or expired cert)
- Container images not pushed to ghcr.io (check build-and-push job)
- Insufficient cluster resources
- Image pull failure (ghcr.io auth)

**Fix:**
1. Verify `KUBE_CONFIG` is a valid base64-encoded kubeconfig: `echo "$KUBE_CONFIG" | base64 -d | kubectl --kubeconfig=/dev/stdin cluster-info`
2. Check that images pushed successfully: `docker pull ghcr.io/finchippay/finchippay-backend:sha-<sha>`
3. Check pod events: `kubectl describe pod -n finchippay`
4. Verify ghcr.io package permissions in GitHub repo settings

#### Contract Deploy: WASM hash mismatch

**Symptom:** `Local and on-chain WASM hashes do not match!`

**Cause:** The locally-built WASM differs from what was installed on-chain. Usually caused by non-deterministic builds or different Rust versions.

**Fix:**
1. Clean build: `cargo clean && cargo build --target wasm32v1-none --release`
2. Verify the same Rust toolchain is used locally and in CI (`rust-toolchain.toml`)
3. Check for filesystem timestamps or non-deterministic code in the contract

#### Greptile: Review not appearing on PR

**Symptom:** PR is opened but no Greptile review appears within minutes.

**Cause:**
- The `needs-review` label wasn't added (check `greptile-label` workflow logs)
- PR author is in the `excludeAuthors` list
- PR branch matches `excludeBranches` pattern
- Greptile GitHub App isn't installed or lost permissions

**Fix:**
1. Check the `greptile-label.yml` workflow run logs
2. Verify `needs-review` label exists on the PR
3. Check `.greptile/config.json` filtering rules
4. Comment `@greptileai` on the PR to manually trigger a re-review
5. Verify the Greptile App is still installed: GitHub → Settings → GitHub Apps

### General Debugging

**Re-running a failed workflow:**

Only the specific failed job, not the entire workflow:
```bash
gh run rerun <run-id> --failed
```

**Checking workflow logs locally:**
```bash
gh run view <run-id> --log
gh run view <run-id> --log --job <job-id>
```

**Validating workflow YAML locally:**
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/<file>'))"
```

**Checking secrets are set:**
```bash
gh secret list
```

---

## Pipeline Conventions

### Action Versioning
- **Always use pinned major versions:** `actions/checkout@v4` (NOT `@main`, `@master`, or `@latest`)
- Exceptions: `chromaui/action@latest` (Chromatic-specific), `softprops/action-gh-release@v2`

### Permissions
- Workflows declare minimum required permissions using top-level `permissions:` block
- `packages: write` only on Docker-publishing workflows
- `pull-requests: write` and `issues: write` only on commenting workflows
- `security-events: write` on scanning workflows (SARIF upload)

### Caching
- **npm:** `setup-node@v4` with `cache: "npm"` and `cache-dependency-path` pointing to the correct `package-lock.json`
- **cargo:** `actions/cache@v4` with paths `~/.cargo/registry`, `~/.cargo/git`, and `target/`
- **Docker:** `type=gha` cache backend via `docker/build-push-action`

### Matrix Strategy
- **Node.js:** `[22, 24]` where 24 is `continue-on-error: true` (canary)
- **Rust:** `[stable, nightly]` where nightly is `continue-on-error: true` (canary)
- **Kubernetes components:** `[backend, frontend, nginx]` with per-component context/dockerfile/image

### Secret Handling
- Never hardcode secrets in workflow files
- Use `${{ secrets.SECRET_NAME }}` syntax
- For optional secrets that might not be set: `${{ secrets.OPTIONAL_SECRET || '' }}`
- Environment variables set in `env:` blocks use `${{ secrets.SECRET }}` at the workflow/job level

### Artifact Retention
| Artifact | Retention |
|----------|-----------|
| SBOMs | 30 days (CI), 90 days (weekly), 365 days (releases) |
| Playwright reports | 30 days |
| Fuzz artifacts | 30 days |
| k6 results | 30 days |
| Terraform plans | 7 days |
| Contract WASM | 90 days |
| Terraform outputs | 90 days |

### Branch Targeting
- **`main`** — Production branch; all PRs target this
- **`develop`** — Integration branch; CI runs on push but not deployment
- **`master`** — Legacy branch; used only by `contract-deploy.yml`

---

## Adding a New Workflow

### Template

```yaml
# .github/workflows/<name>.yml
# <One-line description of what this workflow does>

name: <Display Name>

on:
  # Choose one or more triggers:
  pull_request:
    branches: [main]
    paths:
      - "<relevant/path/**>"
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      # optional manual inputs

permissions:
  contents: read
  # Add only what's needed

jobs:
  <job-name>:
    name: <Human-readable name>
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "npm"
          cache-dependency-path: <path>/package-lock.json

      # ... job steps
```

### Checklist

- [ ] Add workflow file to `.github/workflows/`
- [ ] Declare minimum `permissions`
- [ ] Use pinned action versions (`@v4`, not `@main`)
- [ ] Add `cache` to `setup-node` with correct `cache-dependency-path`
- [ ] If pushing to ghcr.io: add `packages: write` permission
- [ ] If uploading SARIF: add `security-events: write` permission
- [ ] If commenting on PRs: add `pull-requests: write` permission
- [ ] **Validate YAML:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/<file>'))" && echo "VALID"`
- [ ] Update this document (`CI_CD.md`) with the new workflow
- [ ] Update the quick reference table
- [ ] Add required secrets to the secrets matrix
- [ ] Test with a real PR before merging to `main`
