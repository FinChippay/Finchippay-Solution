#!/usr/bin/env bash
# scripts/setup-dev.sh
# One-command local development setup for Finchippay Solution.
# Run this after cloning the repo.
#
# Usage:
#   chmod +x scripts/setup-dev.sh
#   ./scripts/setup-dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  ✨ Finchippay Solution — Dev Setup"
echo "  ─────────────────────────────────"
echo ""

# Helper function to check for commands
check_command() {
  local cmd_name="$1"
  local install_instructions="$2"
  if ! command -v "$cmd_name" &> /dev/null; then
    echo "❌ $cmd_name not found. $install_instructions"
    exit 1
  fi
  echo "✅ $cmd_name found."
}

# ─── Check Node.js ───────────────────────────────────────────────────────────
check_command "node" "Install from https://nodejs.org (v20+)"
NODE_MAJOR_VER=$(node -v | cut -d '.' -f 1 | sed 's/v//')
if [[ "$NODE_MAJOR_VER" -lt 20 ]]; then
  echo "❌ Node.js version is $NODE_MAJOR_VER. Please install Node.js v20 or higher from https://nodejs.org"
  exit 1
fi
echo "✅ Node.js v$NODE_MAJOR_VER (20+) found."

# ─── Check Docker ────────────────────────────────────────────────────────────
check_command "docker" "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
if ! docker info &> /dev/null; then
  echo "❌ Docker is not running. Please start Docker Desktop."
  exit 1
fi
echo "✅ Docker is running."

# ─── Check Stellar CLI ───────────────────────────────────────────────────────
check_command "stellar" "Install Stellar CLI from https://developers.stellar.org/docs/getting-started/setup-local-development#install-the-stellar-cli"

# ─── Frontend setup ──────────────────────────────────────────────────────────
echo ""
echo "📦 Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install || { echo "❌ npm install failed in frontend/"; exit 1; }

if [[ ! -f ".env.local" ]]; then
  cp .env.example .env.local
  echo "   Created frontend/.env.local from .env.example"
else
  echo "   frontend/.env.local already exists — skipping"
fi

# ─── Backend setup ───────────────────────────────────────────────────────────
echo ""
echo "📦 Installing backend dependencies..."
cd "$ROOT/backend"
npm install || { echo "❌ npm install failed in backend/"; exit 1; }

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "   Created backend/.env from .env.example"
else
  echo "   backend/.env already exists — skipping"
fi

# ─── Docker Compose Dev Environment ──────────────────────────────────────────
echo ""
echo "🐳 Bringing up Docker Compose development environment..."
cd "$ROOT"
docker compose -f docker-compose.dev.yml up -d --build || { echo "❌ Docker Compose failed to start."; exit 1; }
echo "✅ Docker Compose environment started."

# ─── Run Tests ───────────────────────────────────────────────────────────────
echo ""
echo "🧪 Running tests to verify environment..."
cd "$ROOT/frontend"
npm test || { echo "❌ Frontend tests failed."; exit 1; }
echo "✅ Frontend tests passed."

cd "$ROOT/backend"
npm test || { echo "❌ Backend tests failed."; exit 1; }
echo "✅ Backend tests passed."

# ─── Rust check (optional) ───────────────────────────────────────────────────
echo ""
if command -v cargo &> /dev/null; then
  RUST_VER=$(rustc --version)
  echo "✅ $RUST_VER"

  if rustup target list --installed | grep -q "wasm32v1-none"; then
    echo "✅ wasm32v1-none target installed"
  else
    echo "⚠️  Adding wasm32v1-none target..."
    rustup target add wasm32v1-none
    echo "✅ wasm32v1-none installed"
  fi
else
  echo "⚠️  Rust not found — smart contract development unavailable."
  echo "   Install: https://rustup.rs"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────"
echo "  ✅ Setup complete! Your development environment is ready."
echo ""
echo "  To stop the Docker services, run:"
echo "      docker compose -f docker-compose.dev.yml down"
echo ""
echo "  Freighter wallet (install if not already):"
echo "    https://freighter.app"
echo "  ─────────────────────────────────────"
echo ""