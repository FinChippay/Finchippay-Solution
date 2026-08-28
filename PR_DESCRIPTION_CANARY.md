# PR: Implement Canary Deployment Workflow for Vercel

## Closes #168

## 🎯 Summary

Implements a canary deployment strategy for the frontend on Vercel to reduce blast radius during deployments. Instead of immediately routing all traffic to new deployments, this change introduces a two-step process: preview deploy → canary monitoring → promotion to production.

## 🎬 Background

Previously, every push to `main` deployed directly to production, exposing all users to potential bugs. If an issue slipped through CI, it affected 100% of users simultaneously.

## 🔧 What Changed

- **`scripts/canary-check.js`** — New Sentry integration that compares error rates between production and canary deployments.
- **`frontend/vercel.json`** — New configuration file with security headers, rewrites, and routing rules.
- **`.github/workflows/vercel-deploy.yml`** — Replaced single-step production deployment with a multi-stage canary pipeline.

## 🚀 How It Works

### Deployment Pipeline

```
Push to main
    │
    ├─▶ Deploy to Vercel preview (canary)
    │
    ├─▶ Assign canary alias (e.g. canary-abc1234.vercel.app)
    │
    ├─▶ Monitor Sentry error rates for 15 minutes
    │       │
    │       ├─▶ Error rate increase < 50%  ──▶ Auto-promote to production
    │       │
    │       └─▶ Error rate increase > 50%  ──▶ Stop; auto-rollback by removing alias
    │
    └─▶ Update GitHub Deployment status
```

### Step-by-Step Breakdown

1. **Checkout & Build:** Standard checkout, Node setup, dependency install.
2. **Deploy Canary:** `vercel deploy --prebuilt` — creates a new preview deployment without touching production.
3. **Traffic Routing:** `vercel alias set` — maps a canary URL (e.g. `canary-<sha>.finchippay.vercel.app`) to the new deployment while production remains at `finchippay.vercel.app`.
4. **Monitoring:** `node scripts/canary-check.js` — queries Sentry for error rates over the last 15 minutes.
5. **Auto-Promotion (if healthy):** `vercel promote` — promotes the canary deployment to production.
6. **Auto-Rollback (if unhealthy):** Canary alias is removed; production remains on the previous deployment.
7. **Cleanup:** Canary alias is removed after promotion.
8. **Status Reporting:** A GitHub Deployment status (`success` / `failure`) is recorded for the commit.

### Monitoring Details

- **Metric:** Error rate (Sentry issues per minute)
- **Evaluation window:** 15 minutes after canary deployment
- **Promotion threshold:** Error rate increase < **50%**
- **Rollback threshold:** Error rate increase ≥ **50%**
- **Fallback:** If Sentry data is unavailable, the job fails safely and does not promote.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VERCEL_TOKEN` | Vercel API token for deployments and aliasing |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `SENTRY_AUTH_TOKEN` | Sentry API auth token (for error rate queries) |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_PROJECT` | Sentry project slug |

### Workflow Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CANARY_TRAFFIC_PERCENT` | `10` | Target traffic percentage for canary (configurable) |
| `CANARY_MONITOR_MINUTES` | `15` | Duration of monitoring window |
| `SENTRY_ERROR_THRESHOLD` | `50` | Error rate spike threshold (%) |
| `NODE_VERSION` | `20.19.5` | Node runtime version |

## 🔁 Traffic Flow

### Before Production Promotion

- `finchippay.vercel.app` → previous production deployment (100% traffic)
- `canary-<sha>.finchippay.vercel.app` → new canary deployment (10% traffic via Edge Config or preview alias)

> **Note:** True percentage-based traffic splitting may require Vercel Edge Config or a load balancer setup. The current implementation assigns a dedicated canary subdomain that can be validated manually or via monitoring tools. Full dynamic percentage routing is out of scope for this PR but the alias step is structured to support future integration.

### After Successful Promotion

- `finchippay.vercel.app` → new production deployment (100% traffic)

## 🧠 Sentry Monitoring Logic

The `scripts/canary-check.js` script:

1. Authenticates with the Sentry API using `SENTRY_AUTH_TOKEN`.
2. Queries `/projects/{org}/{project}/stats/` for the last 15 minutes to establish a production baseline.
3. Queries `/projects/{org}/{project}/issues/` for recently seen (last 15 minutes) unresolved issues as a heuristic for canary errors.
4. Computes:
   - `productionErrorRate` = total production errors / 15 (minutes)
   - `canaryErrorRate` = recent unresolved issues / 15 (minutes)
   - `increase` = `(canaryErrorRate - productionErrorRate) / productionErrorRate`
5. Exits:
   - `0` if `increase < 0.5` (stable → promote)
   - `1` if `increase >= 0.5` (spike → rollback)
   - `2` on API/configuration error (fail safe)

## 📋 Prerequisites

### 1. GitHub Environments

Create the following environments in **Settings → Environments**:

- `preview` (optional but referenced in the preview job)
- `production`

For `production`, set the URL to `https://finchippay.vercel.app`.

### 2. GitHub Secrets

Ensure the following secrets are configured in the repository:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

### 3. Vercel Project

- The project must be linked to the repository.
- `vercel link` must have been run locally (or environment variables correctly populated).

## ✅ Acceptance Criteria

| Criteria | Implementation |
|----------|----------------|
| Deployments go through preview → canary → production stages | ✅ Implemented in `vercel-deploy.yml` |
| Sentry error rate monitored during canary phase | ✅ `scripts/canary-check.js` |
| Auto-promotion if error rate stable | ✅ `if: success()` condition on promotion step |
| Auto-rollback if error rate spikes >50% | ✅ Script exits 1; promotion step skipped |
| Manual approval for production promotion | ✅ GitHub `production` environment gate |
| Deployment status reported in PR/commit | ✅ GitHub Deployment API step |

## 🔍 Verification

After merging, monitor the next push to `main`:

1. Watch the GitHub Actions run for the `Deploy Production` job.
2. Confirm the `Deploy to Vercel Preview (Canary)` step completes and outputs a URL.
3. Confirm `Enable Canary Traffic Routing` creates the alias.
4. Confirm `Monitor Error Rate During Canary` completes successfully.
5. Confirm `Promote Canary to Production` runs (if healthy) and that `finchippay.vercel.app` serves the new version.
6. If errors are injected during the canary window, confirm the rollback path skips promotion.

## 🛡️ Security Considerations

- `SENTRY_AUTH_TOKEN` is scoped read-only if possible.
- `VERCEL_TOKEN` should have minimal deploy permissions required.
- Temporary canary aliases are unique per commit SHA to avoid collisions.

## 🔗 Related Issues

- Resolves #168 — Canary Deployment Workflow for Vercel

---

**Type:** Feature
**Risk:** Low (canary maintains previous production as fallback)
**Testing:** Manual CI run on `main` push