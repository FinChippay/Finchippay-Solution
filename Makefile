.PHONY: help test lint format build deploy clean dev

# ─── Finchippay Solution Makefile ─────────────────────────────────────────────

.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Development ────────────────────────────────────────────────────────────

dev: ## Start all services in development mode
	docker compose -f docker-compose.dev.yml up --build

dev-backend: ## Start backend only
	cd backend && npm run dev

dev-frontend: ## Start frontend only
	cd frontend && npm run dev

# ─── Testing ────────────────────────────────────────────────────────────────

test: test-backend test-frontend test-contract ## Run all tests

test-backend: ## Run backend tests
	cd backend && npm test

test-frontend: ## Run frontend tests
	cd frontend && npm test

test-contract: ## Run contract tests
	cargo test --manifest-path contracts/finchippay-contract/Cargo.toml

test-e2e: ## Run end-to-end tests
	cd frontend && npx playwright test

test-fuzz: ## Run contract fuzz targets
	./scripts/fuzz-contract.sh

test-load: ## Run load tests
	bash tests/load/run-all.sh

test-coverage: ## Run tests with coverage
	cd backend && npx jest --coverage
	cd frontend && npx jest --coverage

# ─── Linting ────────────────────────────────────────────────────────────────

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## Lint backend code
	cd backend && npm run lint

lint-frontend: ## Lint frontend code
	cd frontend && npx next lint

format: ## Format all code
	cd backend && npx prettier --write .
	cd frontend && npx prettier --write .
	cargo fmt --manifest-path contracts/finchippay-contract/Cargo.toml

format-check: ## Check formatting
	cd backend && npx prettier --check .
	cd frontend && npx prettier --check .
	cargo fmt --manifest-path contracts/finchippay-contract/Cargo.toml -- --check

# ─── Build ──────────────────────────────────────────────────────────────────

build: build-backend build-frontend build-contract ## Build all components

build-backend: ## Build backend Docker image
	docker build -t finchippay-backend -f backend/Dockerfile .

build-frontend: ## Build frontend
	cd frontend && npm run build

build-contract: ## Build Soroban contract
	cargo build --manifest-path contracts/finchippay-contract/Cargo.toml --target wasm32-unknown-unknown --release

# ─── Database ───────────────────────────────────────────────────────────────

migrate: ## Run database migrations
	cd backend && npx knex migrate:latest

migrate-rollback: ## Rollback last migration
	cd backend && npx knex migrate:rollback

seed: ## Run database seeds
	cd backend && npx knex seed:run

# ─── Deploy ─────────────────────────────────────────────────────────────────

deploy: ## Deploy full stack (see Terraform + K8s)
	@echo "Use terraform for infrastructure and kubectl for Kubernetes deployment"
	@echo "See DEPLOYMENT_GUIDE.md for instructions"

deploy-contract: ## Deploy contract to testnet
	./scripts/deploy-contract.sh

deploy-frontend: ## Deploy frontend to Vercel
	./scripts/deploy-frontend.sh

# ─── Cleanup ────────────────────────────────────────────────────────────────

clean: ## Clean build artifacts
	cd frontend && rm -rf .next
	cargo clean --manifest-path contracts/finchippay-contract/Cargo.toml
	docker compose -f docker-compose.dev.yml down -v --remove-orphans

# ─── Security ───────────────────────────────────────────────────────────────

security-audit: ## Run security audits
	cd backend && npm audit
	cd frontend && npm audit
	cargo audit --manifest-path contracts/finchippay-contract/Cargo.toml

# ─── CI ─────────────────────────────────────────────────────────────────────

ci: lint test build ## Full CI pipeline (local equivalent)
