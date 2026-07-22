# Makefile — Common development commands for Finchippay Solution
#
# Usage:
#   make dev     — start frontend + backend concurrently (hot-reload)
#   make test    — run all tests (frontend unit + backend unit)
#   make lint    — lint frontend + backend
#   make build   — build Docker images (dev compose)

.PHONY: dev test lint build storybook deploy-contract-testnet

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

# ─── Contract Deployment ────────────────────────────────────────────────────
# Deploy the Soroban contract to Stellar testnet.
# Requires: Stellar CLI, Rust + wasm32v1-none target, funded Stellar identity.
NETWORK ?= testnet
IDENTITY ?= alice
deploy-contract-testnet:
	./scripts/deploy-contract.sh $(NETWORK) $(IDENTITY)
