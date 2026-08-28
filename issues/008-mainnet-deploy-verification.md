# Issue #8 — Mainnet Deployment + On-Chain Verification

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `devops` `contract` `deployment` `verification`

> This is a devops issue for the GrantFox FWC26 campaign (Stellar Wave). Promote the existing testnet deploy pipeline to a mainnet-ready, hash-verified deployment with a manual approval gate.

## Requirements and Context

`.github/workflows/contract-deploy.yml` and `scripts/deploy-contract.sh` already build the WASM, deploy to **testnet**, and verify the on-chain hash. The roadmap lists "Mainnet contract deployment + verification" as open. Mainnet deployment needs the same build→hash→deploy→verify flow, plus a required-approver gate and a documented rollback/upgrade path.

## Objectives
1. Add a mainnet deployment target to the workflow behind a manual approval gate (GitHub Environments).
2. Reuse the existing WASM hash computation to verify the deployed code matches the build artifact.
3. Document the upgrade path (`upgrade(new_wasm_hash)`) and emergency rollback procedure.
4. Add a verification badge and `docs/contract-verification.md` covering independent verification.

## Suggested Execution
1. Fork and branch: `git checkout -b feat/mainnet-deploy`.
2. Extend `.github/workflows/contract-deploy.yml` with a `mainnet` environment + required reviewers.
3. Add `--network mainnet` support and hash-verify steps to `scripts/deploy-contract.sh`.
4. Write `docs/contract-verification.md` and add a verification badge to `README.md`.
5. Validate the workflow with a testnet dry-run; open a PR.

## Acceptance Criteria
- [ ] Mainnet deployment requires manual approval via a protected GitHub Environment.
- [ ] The on-chain WASM hash is verified to match the CI build artifact before the deploy is considered successful.
- [ ] `docs/contract-verification.md` documents independent verification and the `upgrade()` rollback path.
- [ ] A contract verification badge is present in `README.md`.
- [ ] A testnet dry-run of the updated pipeline succeeds.

## Guidelines
- Never commit mainnet keys or secrets; use GitHub Actions secrets.
- Failed verification must fail the workflow with a descriptive error.
- Document all manual steps for operators.

## Timeframe
72 hours
