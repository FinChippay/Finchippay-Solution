# Fuzz Testing for FinchippayContract

Coverage-guided fuzz testing for the Finchippay Soroban smart contract using
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) (libFuzzer).

## Overview

Fuzz testing generates random inputs to discover edge cases that unit tests
might miss — panics, arithmetic overflows, incorrect state transitions, and
other safety violations.

The fuzz suite covers four critical code paths:

| Target | Code Path | What It Fuzzes |
|--------|-----------|----------------|
| `fuzz_target_1_parse_payment` | Memo parsing & storage | Random byte sequences as memo `Symbol`s through `send_tip`, `mint_receipt`, `create_escrow`, and `verify_receipt` round-trip integrity |
| `fuzz_target_2_escrow` | Escrow lifecycle | `create_escrow` → `claim_escrow` / `claim_escrow_partial` / `cancel_escrow` with random amounts, release ledgers, and operation sequences |
| `fuzz_target_3_multisig` | Multi-sig approval | `create_multisig` → `approve_multisig` with varying thresholds, signer counts, duplicates, invalid signers, and timeout flows |
| `fuzz_target_4_batch_send` | Batch send | `batch_send` / `batch_send_multi` with random recipient counts, amounts, memos, and intentional error cases (length mismatch, oversized batches) |

## Prerequisites

```bash
# Install Rust nightly (required by libFuzzer)
rustup toolchain install nightly

# Install cargo-fuzz
cargo install cargo-fuzz
```

## Quick Start

Run all fuzz targets for 30 seconds each:

```bash
bash scripts/fuzz-contract.sh
```

Run with a custom duration (e.g., 10 seconds for a smoke test):

```bash
bash scripts/fuzz-contract.sh 10
```

## Running Individual Fuzz Targets

```bash
# Memo parsing fuzzer
cargo +nightly fuzz run fuzz_target_1_parse_payment \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- -max_total_time=30

# Escrow lifecycle fuzzer
cargo +nightly fuzz run fuzz_target_2_escrow \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- -max_total_time=30

# Multi-sig approval fuzzer
cargo +nightly fuzz run fuzz_target_3_multisig \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- -max_total_time=30

# Batch send fuzzer
cargo +nightly fuzz run fuzz_target_4_batch_send \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- -max_total_time=30
```

## Reproducing a Crash

If a fuzz target finds a crash, the crashing input is saved to the
`artifacts/` directory. To reproduce:

```bash
cargo +nightly fuzz run <target_name> \
  --fuzz-dir contracts/finchippay-contract/fuzz \
  -- contracts/finchippay-contract/fuzz/artifacts/<target_name>/<crash_file>
```

## Corpus Management

The fuzz targets maintain a corpus of interesting inputs in:

```
contracts/finchippay-contract/fuzz/corpus/<target_name>/
```

To start with a clean corpus:

```bash
rm -rf contracts/finchippay-contract/fuzz/corpus/
```

## CI Integration

Fuzz tests run in CI for 60 seconds per target on every push to `main` and
every pull request. Crash artifacts are uploaded for later analysis.

See `.github/workflows/ci.yml` → `fuzz` job.

## Writing New Fuzz Targets

1. Add a new file in `contracts/finchippay-contract/fuzz/fuzz_targets/`
2. Add a `[[bin]]` entry in `contracts/finchippay-contract/fuzz/Cargo.toml`
3. Add the target name to the `TARGETS` array in `scripts/fuzz-contract.sh`
4. Add the target to the CI workflow

### Fuzz Target Template

```rust
#![no_main]
use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    Address, Env,
};

fuzz_target!(|data: &[u8]| {
    if data.len() < MIN_BYTES {
        return;
    }

    let env = Env::default();
    let contract_id = env.register(finchippay_contract::FinchippayContract, ());
    let client = finchippay_contract::FinchippayContractClient::new(&env, &contract_id);

    // ... parse data, call contract, check invariants ...
});
```

### Guidelines

- **Always use `Env::default()` or `Env::from_config()`** for each iteration
  to get a fresh, isolated test environment.
- **Use `env.mock_all_auths()`** to bypass Stellar auth in the test env.
- **Use `std::panic::catch_unwind`** to catch panics from invalid inputs
  that the fuzzer might generate — you're testing that the contract doesn't
  have *unexpected* panics.
- **Check invariants** after each operation — verify state consistency,
  status transitions, and storage integrity.
- **Keep targets focused** on a single code path for better coverage guidance.

## Limitations

- **No real token transfers**: Fuzz targets use Soroban's testutils which
  simulate Stellar Asset Contracts but don't connect to a real network.
- **Host target only**: Fuzz targets compile for the host (x86_64), not WASM.
  Soroban-specific WASM issues (e.g., memory limits) are not tested.
- **Short-run CI only**: CI runs are 60-second smoke tests. Long-running
  fuzz campaigns should be run locally or integrated with OSS-Fuzz.

## Future Work

- [ ] OSS-Fuzz integration for continuous fuzzing
- [ ] Differential fuzzing against the contract's expected behavior
- [ ] Cross-contract fuzzing with mock token contracts
- [ ] Fuzz the streaming payment formula with larger parameter ranges

## Fuzz Testing Strategy

We run 10 libFuzzer targets on every PR via the `fuzz` CI job. Each target
focuses on a specific contract entrypoint and uses randomized inputs to
discover edge cases in validation, arithmetic, and state transitions.

### Targets

| Target | Entrypoint | Focus |
|--------|-----------|-------|
| `create_escrow` | `create_escrow` | Amount bounds, recipient validation |
| `create_multisig` | `create_multisig` | Signer uniqueness, threshold bounds |
| `batch_send` | `batch_send` | Batch size limits, duplicate detection |
| `open_stream` | `open_stream` | Rate bounds, deposit validation |
| `claim_stream` | `claim_stream` | Accumulation math, overflow protection |
| `parse_payment` | (NLP parser) | Input format, edge cases |
| `escrow` | All escrow ops | State transitions |
| `multisig` | All multisig ops | Proposal/approval logic |
| `batch_swap` | `batch_swap` | Path validation, slippage bounds |
| `property_streaming` | Stream lifecycle | Invariants (total claimed ≤ deposited) |

### Running Locally

```bash
cd contracts/finchippay-contract/fuzz
cargo fuzz run create_escrow -- -max_total_time=60
```

### Adding a New Target

```bash
python3 create_fuzz_targets.py --entrypoint <name> --args "ArgType1, ArgType2"
```
