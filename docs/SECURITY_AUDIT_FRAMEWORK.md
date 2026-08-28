# 🔐 Security Audit Framework

> **Finchippay Solution — Smart Contract & Infrastructure Security Audit Checklist**

This document defines the security audit framework for all Finchippay smart contracts and backend infrastructure. It is based on industry standards including the **Stellar Smart Contract Security Guidelines**, **OWASP Top 10**, and best practices from leading Stellar ecosystem audits.

---

## 1. Audit Scope

### 1.1 Smart Contract Audit Checklist

#### Authentication & Authorization
- [ ] Every mutating entrypoint calls `require_auth()` on the invoking address
- [ ] No hardcoded admin keys — all admin roles are configurable via `set_admin()`
- [ ] Multi-signature thresholds are enforced at the contract level
- [ ] Emergency pause/resume is protected by a separate role (`pauser`)
- [ ] No `unchecked` blocks without explicit justification

#### Arithmetic Safety
- [ ] All arithmetic uses `checked_add`, `checked_sub`, `checked_mul`, `checked_div`
- [ ] No silent overflow/underflow paths
- [ ] Bounds checking on all user-supplied numeric inputs
- [ ] Batch sizes are capped (e.g., `MAX_BATCH_SIZE = 50`)
- [ ] Escrow amounts and stream rates have reasonable maximums

#### Storage & State
- [ ] Storage TTL is managed — `bump()` calls on all accessed entries
- [ ] No stale reads from expired storage
- [ ] Storage layout versioning for upgradeability
- [ ] All state transitions are validated (e.g., escrow: `Pending → Released | Cancelled`)
- [ ] No state corruption paths in error conditions

#### Token Interactions
- [ ] All token transfers verify success via `require_transfer_succeeded()`
- [ ] Token amounts are validated against contract balances
- [ ] No phantom deposit vulnerabilities
- [ ] Allowance checks before `transfer_from`

#### Events & Indexing
- [ ] All state changes emit structured events
- [ ] Event payloads contain sufficient data for off-chain indexing
- [ ] No sensitive data in events (private keys, PII)

#### Gas & Resources
- [ ] No unbounded loops — all iterations are capped
- [ ] Worst-case gas usage is documented
- [ ] Resource limits are tested under maximum batch sizes

### 1.2 Backend API Security Checklist

#### Authentication
- [ ] JWT tokens use RS256 or HS256 with proper secret management
- [ ] Token expiration is enforced (access: 15 min, refresh: 7 days)
- [ ] Refresh token rotation prevents replay attacks
- [ ] Rate limiting on auth endpoints (login, register, refresh)

#### Authorization
- [ ] Admin endpoints require explicit admin role verification
- [ ] Resource ownership is validated before mutations (user can only modify their own data)
- [ ] No IDOR (Insecure Direct Object Reference) vulnerabilities

#### Input Validation
- [ ] All request bodies validated against Zod schemas or JSON Schema
- [ ] Stellar addresses validated (G... format, 56 chars)
- [ ] SQL injection prevention via parameterized queries (Knex)
- [ ] XSS prevention via output encoding and Content-Security-Policy headers

#### Cryptography
- [ ] No custom cryptographic implementations
- [ ] Encryption keys managed via environment variables (never committed)
- [ ] Webhook payloads signed with HMAC-SHA256
- [ ] Sensitive data encrypted at rest

#### Infrastructure
- [ ] HTTPS enforced via HSTS headers
- [ ] CORS restricted to known origins
- [ ] Rate limiting on all public endpoints
- [ ] DDoS protection via Cloudflare or equivalent
- [ ] Secrets rotated on a regular schedule

### 1.3 Frontend Security Checklist

#### Wallet Integration
- [ ] Freighter wallet integration uses official SDK
- [ ] Transaction signing is always user-initiated
- [ ] No private key storage in localStorage or sessionStorage
- [ ] Wallet connection state is encrypted

#### Client-Side Security
- [ ] Content-Security-Policy headers prevent XSS
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] CSRF tokens on state-changing requests
- [ ] HTTPS-only cookies with `Secure` and `HttpOnly` flags

---

## 2. Audit Process

### 2.1 Internal Audit (Performed by Core Team)

- **Frequency**: Every release cycle
- **Scope**: All items in Section 1
- **Output**: Internal audit report in `docs/audits/internal-YYYY-MM.md`
- **Sign-off**: Requires approval from 2 core maintainers

### 2.2 External Audit (Third-Party)

- **Frequency**: Before every major version bump (MAJOR.MINOR)
- **Provider**: Registered blockchain security firm
- **Scope**: Smart contract + critical backend paths
- **Output**: Published report in `docs/audits/external-YYYY-MM-{firm}.pdf`
- **Remediation**: All HIGH/CRITICAL findings must be resolved before deployment

### 2.3 Bug Bounty Program

| Severity | Reward Range | Response Time |
|---|---|---|
| **Critical** | $5,000 – $25,000 | 24 hours |
| **High** | $1,000 – $5,000 | 48 hours |
| **Medium** | $250 – $1,000 | 1 week |
| **Low** | $50 – $250 | 2 weeks |

Report via: `security@finchippay.dev` (PGP key in SECURITY.md)

---

## 3. Automated Security Checks

| Tool | Purpose | Frequency |
|---|---|---|
| **cargo audit** | Rust dependency vulnerabilities | Every PR |
| **npm audit** | JavaScript dependency vulnerabilities | Every PR |
| **CodeQL** | Static analysis (hardcoded keys, injection) | Every PR |
| **Trivy** | Container image scanning | Every Docker build |
| **SBOM** | Software Bill of Materials generation | Every release |
| **Semgrep** | Custom security rules | Every PR |
| **Fuzz testing** | Property-based contract testing | Every PR |

---

## 4. Incident Response

### 4.1 Severity Classification

| Severity | Definition | Example |
|---|---|---|
| **Critical** | Direct loss of user funds, irreversible | Unauthorized token transfer, key leak |
| **High** | Potential loss of funds with complex exploit | Missing auth check, reentrancy |
| **Medium** | Service disruption, data leak | Rate limit bypass, info disclosure |
| **Low** | Minor issues, cosmetic | Missing event, gas inefficiency |

### 4.2 Response Protocol

1. **Detection** — Automated monitoring or user report
2. **Triage** — Security Council assesses severity (within 1 hour for critical)
3. **Containment** — Pause affected contracts, revoke compromised keys
4. **Remediation** — Patch, test, deploy fix
5. **Post-Mortem** — Public incident report within 72 hours

---

*Last updated: August 8, 2026*

## Soroban Contract Audit Checklist

### Authentication
- [ ] Every mutating entrypoint calls `require_auth()` on the authorizing party
- [ ] Admin functions are gated by multi-sig threshold (not single key)
- [ ] Pauser role is separate from admin (least privilege)

### Arithmetic
- [ ] All arithmetic uses `checked_add`/`checked_sub`/`checked_mul`
- [ ] No raw `+`/`-`/`*` operators on storage values
- [ ] Overflow/underflow panics are explicit and descriptive

### Storage
- [ ] All persistent entries have TTL management (bump on read/write)
- [ ] New entries start at MIN_TTL_LEDGERS floor
- [ ] Admin can sweep cold entries via bump_all_ttls
- [ ] Storage layout version is validated on upgrade

### Bounds
- [ ] Escrow release ledgers are capped (MAX_ESCROW_LEDGERS)
- [ ] Stream deposit/rate has upper bounds (MAX_STREAM_DEPOSIT, MAX_STREAM_RATE)
- [ ] Batch sizes are capped (MAX_BATCH_SIZE)
- [ ] Multi-sig signer count is capped (MAX_MULTISIG_SIGNERS)
- [ ] Minimum amounts enforced to prevent dust attacks

### Events
- [ ] Value-transferring operations emit events
- [ ] Events include relevant addresses and amounts for indexing
- [ ] Migration from deprecated `publish()` to `#[contractevent]` completed
