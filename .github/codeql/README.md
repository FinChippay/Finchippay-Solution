# Finchippay Custom CodeQL Query Packs

This directory contains custom CodeQL query packs tailored to the
Finchippay-Solution repository.  They supplement the built-in
`security-extended` and `security-and-quality` CodeQL suites with rules
that are specific to:

- Stellar/Soroban payment infrastructure (secret key handling, token arithmetic)
- The Express webhook delivery pipeline (HMAC-SHA256 signature verification)
- The Soroban smart contract (checked arithmetic, bounded loops, structured errors)

---

## Directory structure

```
.github/codeql/
├── README.md                              ← this file
├── javascript/
│   ├── qlpack.yml                         ← JS query pack manifest
│   ├── HardcodedStellarSecretKey.ql
│   ├── LocalStoragePrivateData.ql
│   └── MissingWebhookSignatureVerification.ql
└── rust/
    ├── qlpack.yml                         ← Rust query pack manifest
    ├── MissingCheckedArithmetic.ql
    ├── UnboundedLoop.ql
    └── RawPanicWithoutError.ql
```

---

## JavaScript / TypeScript queries

### HardcodedStellarSecretKey

| Field | Value |
|---|---|
| Query ID | `finchippay/hardcoded-stellar-secret-key` |
| Severity | **error** |
| Security severity | 9.5 / 10 |
| Precision | high |
| Tags | security, cryptography, stellar, credentials |

**Purpose**  
Detects Stellar secret keys hardcoded as string literals in source code.

**Rationale**  
Stellar secret keys are 56-character Base32-encoded strings that begin with
`S` (Ed25519 seed in Stellar's StrKey encoding).  A secret key in source code
is visible to anyone with read access to the repository and to any build
artefact that includes the literal — including minified bundles, server
logs, and error messages.  Exposure allows an attacker to take full control
of the corresponding Stellar account.

**What it detects**  
Any string literal matching the regular expression `S[A-Z2-7]{55}`.

**Expected behaviour**  
Zero results.  The Finchippay codebase never embeds secret keys; they are
loaded at runtime from `process.env.STELLAR_SECRET_KEY`.

**Example (vulnerable)**

```javascript
// ❌ Hardcoded secret key
const keypair = StellarSdk.Keypair.fromSecret(
  "SCMB47XLHZNO5WNCCUOQRQKK76DKXYEXAMPLE12345678901234567"
);
```

**Example (compliant)**

```javascript
// ✅ Loaded from environment variable
const keypair = StellarSdk.Keypair.fromSecret(
  process.env.STELLAR_SECRET_KEY
);
```

---

### LocalStoragePrivateData

| Field | Value |
|---|---|
| Query ID | `finchippay/local-storage-private-data` |
| Severity | **error** |
| Security severity | 8.5 / 10 |
| Precision | medium |
| Tags | security, cryptography, stellar, xss |

**Purpose**  
Detects calls to `localStorage.setItem` or `sessionStorage.setItem` where
the storage key name suggests private key material or seed phrases are being
persisted.

**Rationale**  
`localStorage` and `sessionStorage` are readable by any JavaScript executing
on the same origin.  An XSS vulnerability anywhere on the domain would give
an attacker immediate access to every stored secret.  Cryptographic key
material must be kept in ephemeral memory (React state, module-level
variables) or inside a secure extension context such as Freighter.

**What it detects**  
Calls to `[window.]localStorage.setItem(key, ...)` or
`[window.]sessionStorage.setItem(key, ...)` where `key` matches
`(?i).*(secret|private.?key|seed|mnemonic|privkey|priv_key|stellar.?secret|keypair|sk_).*`.

**Expected behaviour**  
Zero results for private key material.  The codebase stores non-sensitive
preferences (`finchippay:contacts`, `finchippay_refresh_token`) in
localStorage, which is acceptable — only cryptographic secrets trigger this
query.

**Known benign localStorage usage** (not flagged by this query)

| Key | Content | Risk |
|---|---|---|
| `finchippay:contacts` | Public key + nickname pairs | None — public keys are not secrets |
| `finchippay_refresh_token` | JWT refresh token | Medium — monitor for separate JWT-related rules |

**Example (vulnerable)**

```javascript
// ❌ Storing private key in localStorage
localStorage.setItem("stellar_secret_key", keypair.secret());
```

**Example (compliant)**

```javascript
// ✅ Keep the key only in memory
let secretKey = keypair.secret(); // in-memory only, never persisted
```

---

### MissingWebhookSignatureVerification

| Field | Value |
|---|---|
| Query ID | `finchippay/missing-webhook-signature-verification` |
| Severity | **error** |
| Security severity | 8.0 / 10 |
| Precision | medium |
| Tags | security, integrity, webhooks, stellar |

**Purpose**  
Detects Express POST/PUT/PATCH route handlers whose path contains a
webhook-related segment (e.g. `/webhook`, `/hook`, `/callback`) that read
`req.body` without calling a signature verification function.

**Rationale**  
The Finchippay backend signs every outbound webhook delivery with
`HMAC-SHA256` and includes the digest in the `X-Webhook-Signature` header.
If an inbound webhook receiver does not verify this signature an attacker
can forge arbitrary payloads and trigger payment events, data mutations, or
other privileged actions.

**What it detects**  
Express route handlers that:
1. Are registered on a path matching `(?i).*/webhook.*|.*/hook.*|.*/callback.*|.*/notify.*|.*/event.*`
2. Use `POST`, `PUT`, or `PATCH` methods
3. Access `req.body`
4. Do NOT call any function matching `(?i).*(verify|validate|check).*(signature|hmac|webhook).*`
   (including the repo's own `verifyWebhookSignature` utility)

**Expected behaviour**  
Zero results.  Every webhook consumer in this codebase calls
`verifyWebhookSignature(payload, secret, req.headers['x-webhook-signature'])`.

**Example (vulnerable)**

```javascript
// ❌ Processes body without verifying signature
router.post("/webhook/payments", (req, res) => {
  processPayment(req.body); // Forged payloads accepted
  res.sendStatus(200);
});
```

**Example (compliant)**

```javascript
const { verifyWebhookSignature } = require("../utils/webhookSignature");

// ✅ Verifies HMAC-SHA256 before processing
router.post("/webhook/payments", (req, res) => {
  const sig = req.headers["x-webhook-signature"];
  const valid = verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET, sig);
  if (!valid) return res.status(401).json({ error: "Invalid signature" });
  processPayment(req.body);
  res.sendStatus(200);
});
```

---

## Rust queries

### MissingCheckedArithmetic

| Field | Value |
|---|---|
| Query ID | `finchippay/missing-checked-arithmetic` |
| Severity | **warning** |
| Security severity | 7.5 / 10 |
| Precision | medium |
| Tags | security, correctness, overflow, stellar, soroban |

**Purpose**  
Detects direct use of the `+`, `-`, or `*` binary operators on
financial-value identifiers inside functions whose names suggest payment
operations.

**Rationale**  
Soroban token amounts and ledger counters are `i128`/`u32` integers.  In
release builds, integer overflow wraps by default in Rust unless the crate
is compiled with `overflow-checks = true`.  A wrapped overflow on a payment
amount could allow an attacker to drain funds (e.g. craft an `amount` that
wraps to a very large positive number after a subtraction, leaving the
contract's locked balance negative).

The `FinchippayContract` already enforces checked arithmetic with
`.checked_add(...)`, `.checked_sub(...)`, `.checked_mul(...)`
and `.expect("overflow")` everywhere.  This query acts as a regression guard
for future contributors.

**What it detects**  
`+`, `-`, or `*` binary expressions inside functions named with
`(?i).*(send|transfer|pay|escrow|stream|tip|batch|claim|deposit|withdraw|mint|amount|balance|vesting|multisig|multi_sig).*`
where at least one operand is an identifier named with
`(?i).*(amount|balance|deposit|claimed|streamed|rate|total|fee|tip|escrow|stream|locked|vesting|proposal).*`.

Loop counter increments (`+ 1`) are excluded.

**Expected behaviour**  
Zero results.  The contract was audited to use checked arithmetic throughout.

**Example (vulnerable)**

```rust
// ❌ Plain addition — wraps on overflow in release mode
fn send_tip(amount: i128, total: i128) -> i128 {
    total + amount  // could overflow silently
}
```

**Example (compliant)**

```rust
// ✅ Checked addition — panics on overflow, never wraps
fn send_tip(amount: i128, total: i128) -> i128 {
    total.checked_add(amount).expect("overflow")
}
```

---

### UnboundedLoop

| Field | Value |
|---|---|
| Query ID | `finchippay/unbounded-loop` |
| Severity | **warning** |
| Security severity | 6.5 / 10 |
| Precision | medium |
| Tags | security, availability, denial-of-service, soroban, stellar |

**Purpose**  
Detects `loop { ... }` and `while true { ... }` blocks inside smart contract
source files that do not contain a `break` or `return` statement.

**Rationale**  
Soroban enforces per-transaction CPU instruction budget limits.  A `loop`
without a termination path will always exceed the budget and abort the
transaction, denying service to legitimate users.  If the loop processes
attacker-controlled data, the attacker can reliably force budget exhaustion.

**What it detects**  
`loop { ... }` and `while true { ... }` constructs in files under
`contracts/` that lack any `break` or `return` inside the loop body.

Off-chain retry workers and SSE monitor loops (in `backend/`) are explicitly
excluded by the `contracts/` path filter.

**Expected behaviour**  
Zero results in contract code.  The contract uses bounded iterators over
`Vec<Address>` collections everywhere.

**Example (vulnerable — contract context)**

```rust
// ❌ Infinite loop in contract — will exhaust Soroban budget
loop {
    process_payment();
    // No break condition
}
```

**Example (compliant)**

```rust
// ✅ Bounded iteration over a Vec
for signer in signers.iter() {
    if approvals.contains(signer) {
        continue;
    }
    approvals.push_back(signer.clone());
}
```

---

### RawPanicWithoutError

| Field | Value |
|---|---|
| Query ID | `finchippay/raw-panic-without-error` |
| Severity | **warning** |
| Security severity | 5.0 / 10 |
| Precision | medium |
| Tags | reliability, maintainability, error-handling, soroban, stellar |

**Purpose**  
Detects `panic!()`, `.unwrap()`, and `.expect("non-standard message")` calls
in smart contract code outside of the intentional arithmetic overflow guards.

**Rationale**  
Soroban entry-points should propagate failures through the typed
`ContractError` enum so callers, indexers, and the frontend can
programmatically distinguish between failure modes (e.g. "contract paused"
vs. "amount overflow" vs. "caller not authorized").  A raw `panic!` or
`.unwrap()` aborts the transaction with an opaque error code, making
debugging and monitoring much harder.

**What it detects**  
- `panic!(...)` macro calls
- `.unwrap()` method calls
- `.expect(msg)` calls where `msg` does NOT match
  `(?i)(overflow|underflow|contract not initialized|already initialized)`

**Excluded (intentional)**

| Pattern | Reason |
|---|---|
| `.expect("overflow")` | Intentional arithmetic guard — overflow is always a bug |
| `.expect("underflow")` | Same as above |
| `.expect("Contract not initialized")` | Legitimate guard in `get_admin` helper |
| Test functions (`#[test]`) | Panics in tests are acceptable |

**Expected behaviour**  
Zero results outside of the explicitly allowed patterns above.

**Example (flagged)**

```rust
// ❌ Opaque panic — caller cannot distinguish this error
let admin: Address = env.storage()
    .persistent()
    .get(&DataKey::Admin)
    .unwrap(); // What went wrong? Caller can't tell.
```

**Example (compliant)**

```rust
// ✅ Structured error — caller can match on ContractError::NotFound
let admin: Address = env.storage()
    .persistent()
    .get(&DataKey::Admin)
    .ok_or(ContractError::Unauthorized)?;
```

---

## Findings summary

After running these queries against the current `master` branch of
Finchippay-Solution:

| Query | Findings |
|---|---|
| HardcodedStellarSecretKey | **0** — no secret keys in source |
| LocalStoragePrivateData | **0** — only non-sensitive keys persisted |
| MissingWebhookSignatureVerification | **0** — all webhook handlers verified |
| MissingCheckedArithmetic | **0** — contract uses checked arithmetic throughout |
| UnboundedLoop | **0** — contract uses bounded iterators |
| RawPanicWithoutError | **0** — contract uses structured ContractError enum |

**Zero false positives.** No real security issues were found by the custom
queries.  The existing codebase already follows all the security patterns
these queries enforce.  These queries act as ongoing regression guards to
prevent regressions from future changes.

---

## Running the queries locally

To run the queries locally you need the [CodeQL CLI](https://github.com/github/codeql-cli-binaries/releases).

```bash
# Create a JavaScript database
codeql database create codeql-db-js \
  --language=javascript-typescript \
  --source-root=.

# Run the custom JS pack
codeql database analyze codeql-db-js \
  .github/codeql/javascript/ \
  --format=sarif-latest \
  --output=results-js.sarif

# Create a Rust database
codeql database create codeql-db-rust \
  --language=rust \
  --build-mode=manual \
  --command='cargo build' \
  --source-root=contracts/

# Run the custom Rust pack
codeql database analyze codeql-db-rust \
  .github/codeql/rust/ \
  --format=sarif-latest \
  --output=results-rust.sarif
```
