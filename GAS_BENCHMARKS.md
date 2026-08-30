# Gas Benchmarks and Regression Guard

As new features are added to the Soroban contract, entrypoint gas costs can silently regress. To prevent a seemingly innocent change from pushing frequently-called entrypoints above acceptable gas limits, this project implements a gas regression guard in CI.

## Overview
- **Location:** The gas benchmarks are defined in `contracts/finchippay-contract/tests/gas_benchmarks.rs`.
- **Measurement:** CPU instructions are measured for key mutating entrypoints (escrow, stream, multi-sig, batch, tips).
- **Baselines:** The expected baseline gas costs are recorded in `contracts/finchippay-contract/benches/gas_baseline.json`.
- **CI Enforcement:** A CI step runs `cargo test --test gas_benchmarks` to compare the current measurement against the baseline. If any entrypoint exceeds its baseline by **>10%**, the test (and the CI pipeline) will fail.

## Updating the Baseline
When intentional optimizations or feature additions change gas requirements by more than 10%, you will need to update the baseline file.

To regenerate the baselines and update `gas_baseline.json`, run the test locally with the `UPDATE_BASELINE` environment variable set:

```bash
cd contracts/finchippay-contract
UPDATE_BASELINE=1 cargo test --test gas_benchmarks
```

Review the updated `benches/gas_baseline.json` file to ensure the new CPU instruction costs are expected, then commit the updated baseline:

```bash
git add benches/gas_baseline.json
git commit -m "Update gas benchmarks baseline"
```

## Adding New Entrypoints to the Guard
If you add a new mutating entrypoint to the contract, add a new test block to `gas_benchmarks.rs` that profiles it:
1. Mock the necessary auths.
2. Call `env.budget().reset_unlimited()`.
3. Capture `cpu_before` using `env.budget().cpu_instruction_cost()`.
4. Call your new entrypoint.
5. Capture `cpu_after`.
6. Insert the measurement into the `current_measurements` map.

Then, run the benchmark suite with `UPDATE_BASELINE=1` to generate the baseline entry for your new function.
