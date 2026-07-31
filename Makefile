# Makefile — Common development commands for Finchippay Solution
#
# Usage:
#   make dev     — start frontend + backend concurrently (hot-reload)
#   make test    — run all tests (frontend unit + backend unit)
#   make lint    — lint frontend + backend
#   make build   — build Docker images (dev compose)

.PHONY: dev test lint build storybook test-integration deploy-contract-testnet sbom sbom-scan

dev:
	npm run dev

test:
	npm run test --prefix frontend
	npm run test --prefix backend

lint:
	npm run lint --prefix frontend
	npm run lint --prefix backend

build:
	docker compose build

storybook:
	npm run storybook --prefix frontend

# ─── Contract Integration Tests ─────────────────────────────────────────────
test-integration:
	cd contracts/finchippay-contract && cargo test --test integration

# ─── Contract Deployment ────────────────────────────────────────────────────
# Deploy the Soroban contract to Stellar testnet.
# Requires: Stellar CLI, Rust + wasm32v1-none target, funded Stellar identity.
NETWORK ?= testnet
IDENTITY ?= alice
deploy-contract-testnet:
	./scripts/deploy-contract.sh $(NETWORK) $(IDENTITY)

# ─── Software Bill of Materials (SBOM) ──────────────────────────────────────
# Generate SPDX + CycloneDX SBOMs for every component into ./sbom (gitignored).
# Covers: frontend (npm), backend (npm), contract (Rust/cargo).
# Requires: syft — https://github.com/anchore/syft
#   curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
sbom:
	mkdir -p sbom
	syft dir:frontend                      -o spdx-json=sbom/frontend.spdx.json -o cyclonedx-json=sbom/frontend.cdx.json
	syft dir:backend                       -o spdx-json=sbom/backend.spdx.json  -o cyclonedx-json=sbom/backend.cdx.json
	syft dir:contracts/finchippay-contract -o spdx-json=sbom/contract.spdx.json -o cyclonedx-json=sbom/contract.cdx.json

# Scan the generated SBOMs and FAIL on CRITICAL or HIGH vulnerabilities.
# Requires: grype — https://github.com/anchore/grype
#   curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin
sbom-scan: sbom
	grype sbom:sbom/frontend.cdx.json --fail-on high
	grype sbom:sbom/backend.cdx.json  --fail-on high
	grype sbom:sbom/contract.cdx.json --fail-on high
