# Issue #29 — Health Check and Readiness Probe Enhancement

**Labels:** `backend` `enhancement` `devops` `monitoring`

## Summary
Enhance the health check system with comprehensive readiness, liveness, and dependency probes that enable Kubernetes auto-healing, blue-green deployments, and operational insight.

## Background
The backend has `healthService.js` and a `GET /api/health` endpoint exposed via `backend/src/routes/health.js`. However, the health check is basic (returns OK if the server is running) and doesn't check dependencies like PostgreSQL, Redis, Horizon, or Soroban RPC.

## Problem Statement
In production (Kubernetes), the platform needs proper liveness probes (is the app running?) and readiness probes (is the app ready to serve traffic?). Without these, Kubernetes cannot auto-heal or perform zero-downtime deployments.

## Objectives
1. Implement comprehensive health checks for all dependencies.
2. Add separate liveness and readiness probe endpoints.
3. Add dependency status page for operators.
4. Add Kubernetes probe configuration.
5. Write tests for all health check scenarios.

## Scope
- **In scope:** liveness/readiness probes, dependency checks, K8s config.
- **Out of scope:** self-healing, automated recovery beyond K8s restart.

## Detailed Implementation Requirements

1. **Health service enhancement:** Update `backend/src/services/healthService.js`:
   - `checkPostgres()` — ping database, measure latency.
   - `checkRedis()` — PING Redis, measure latency.
   - `checkHorizon()` — call Horizon root endpoint, check response time < 5s.
   - `checkSorobanRpc()` — call Soroban RPC health endpoint.
   - `checkDiskSpace()` — check available disk space (< 90% usage).
   - `checkMemoryUsage()` — check process memory (< 500MB RSS).
   - `checkEventLoop()` — check event loop lag (< 100ms).
   - Each check returns: `{ status: 'healthy'|'degraded'|'unhealthy', latency: number, message: string }`.
   - Configurable thresholds via env vars.

2. **Liveness endpoint:** `GET /api/health/live`:
   - Returns 200 if the process is running and can respond.
   - Only checks: process health, event loop lag.
   - Used by Kubernetes liveness probe.
   - Response: `{ status: 'alive', uptime: seconds }`.

3. **Readiness endpoint:** `GET /api/health/ready`:
   - Returns 200 only if all critical dependencies are healthy.
   - Critical: PostgreSQL, Redis, Horizon.
   - Non-critical (degraded but ready): Soroban RPC, disk space.
   - Used by Kubernetes readiness probe.
   - Response: `{ status: 'ready'|'not_ready', checks: {...}, summary: 'all_healthy'|'degraded'|'critical_failure' }`.

4. **Startup probe:** `GET /api/health/started`:
   - Returns 200 once the server has completed initialization.
   - Checks: migrations ran, executor started, indexer started.
   - Used by Kubernetes startup probe.
   - Response: `{ status: 'started', initDuration: ms }`.

5. **Dependency status page:** Create `GET /api/health/dependencies`:
   - Returns detailed status of every dependency with latency and last checked timestamp.
   - Admin-only (requires `requireAdmin` middleware).
   - Useful for debugging and operations.

6. **Kubernetes probe configuration:** Update `kubernetes/backend/deployment.yaml`:
   ```yaml
   livenessProbe:
     httpGet:
       path: /api/health/live
       port: 4000
     initialDelaySeconds: 30
     periodSeconds: 15
   readinessProbe:
     httpGet:
       path: /api/health/ready
       port: 4000
     initialDelaySeconds: 10
     periodSeconds: 10
   startupProbe:
     httpGet:
       path: /api/health/started
       port: 4000
     initialDelaySeconds: 5
     periodSeconds: 5
     failureThreshold: 30
   ```

7. **Graceful shutdown:** Update `backend/src/server.js`:
   - On SIGTERM/SIGINT, mark health as not ready, drain connections (wait 10s), then exit.
   - Kubernetes SIGTERM → readiness fails → service stops routing → process exits.

8. **Tests:** Test liveness (always passes while running), readiness (passes/fails based on dependencies), startup timing, dependency status format.

## Expected Architecture

```
backend/
├── src/
│   ├── services/
│   │   └── healthService.js        (UPDATE: comprehensive checks)
│   ├── routes/
│   │   └── health.js               (UPDATE: liveness, readiness, startup)
│   └── server.js                   (UPDATE: graceful shutdown)
├── kubernetes/
│   └── backend/
│       └── deployment.yaml         (UPDATE: probes)
└── __tests__/
    └── health.test.js              (UPDATE)
```

## Acceptance Criteria
- [ ] `GET /api/health/live` returns 200 when process is running.
- [ ] `GET /api/health/ready` returns 200 only when PostgreSQL, Redis, and Horizon are healthy.
- [ ] `GET /api/health/started` returns 200 after initialization is complete.
- [ ] `GET /api/health/dependencies` returns detailed status for all dependencies.
- [ ] Graceful shutdown: readiness fails, connections drain, process exits.
- [ ] Kubernetes deployment.yaml has liveness, readiness, and startup probes.
- [ ] All existing tests pass.
