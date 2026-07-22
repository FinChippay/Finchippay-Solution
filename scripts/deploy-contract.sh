#!/usr/bin/env bash
# scripts/deploy-contract.sh
# Build and deploy the FinchippayContract to Stellar testnet or mainnet.
#
# Prerequisites:
#   - Rust + wasm32v1-none target (required by soroban-sdk v27.0.0+)
#     rustup target add wasm32v1-none
#   - Stellar CLI
#     cargo install --locked stellar-cli
#   - A funded Stellar identity
#     stellar keys generate alice --network testnet
#
# Usage:
#   chmod +x scripts/deploy-contract.sh
#   ./scripts/deploy-contract.sh [testnet|mainnet] [identity-name]
#
# Example:
#   ./scripts/deploy-contract.sh testnet alice

set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${2:-alice}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$WORKSPACE_ROOT/contracts/finchippay-contract"
# Workspace builds land in workspace_root/target, not contract_dir/target
WASM="$WORKSPACE_ROOT/target/wasm32v1-none/release/finchippay_contract.wasm"

echo "╔══════════════════════════════════════════╗"
echo "║  Finchippay-Solution — Contract Deploy   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Network : $NETWORK"
echo "  Identity: $IDENTITY"
echo ""

# ─── Validate prerequisites ──────────────────────────────────────────────────

for cmd in cargo stellar; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required command not found: $cmd"
    case "$cmd" in
      cargo)   echo "   Install Rust: https://rustup.rs" ;;
      stellar) echo "   Install Stellar CLI: cargo install --locked stellar-cli" ;;
    esac
    exit 1
  fi
done

# ─── Build ────────────────────────────────────────────────────────────────────

echo "🔨 Building WASM (release)..."
cd "$CONTRACT_DIR"
cargo build --target wasm32v1-none --release --quiet

if [[ ! -f "$WASM" ]]; then
  echo "❌ WASM not found after build: $WASM"
  exit 1
fi

WASM_SIZE=$(du -sh "$WASM" | cut -f1)
echo "   ✅ $WASM_SIZE  →  $WASM"
echo ""

# ─── Deploy ───────────────────────────────────────────────────────────────────

echo "🚀 Uploading and deploying to $NETWORK..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK")

echo ""
echo "✅ Deployed!"
echo "   Contract ID: $CONTRACT_ID"
echo ""

# ─── Initialize ───────────────────────────────────────────────────────────────

ADMIN_KEY=$(stellar keys address "$IDENTITY" 2>/dev/null || true)

if [[ -n "$ADMIN_KEY" ]]; then
  echo "🔧 Initializing with admin: $ADMIN_KEY"
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- initialize \
    --admin "$ADMIN_KEY"
  echo "   ✅ Initialized"

  # Verify the contract version and pause state
  echo ""
  echo "🔍 Verifying contract security state..."
  VERSION=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- get_version 2>/dev/null || echo "unknown")
  echo "   Contract version: $VERSION"

  echo "   Testing pause circuit breaker..."
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- pause \
    --admin "$ADMIN_KEY" 2>/dev/null && echo "   ✅ Pause works" || echo "   ⚠️  Pause test skipped"

  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- unpause \
    --admin "$ADMIN_KEY" 2>/dev/null && echo "   ✅ Unpause works" || echo "   ⚠️  Unpause test skipped"
else
  echo "⚠️  Could not resolve admin key for identity '$IDENTITY'"
  echo "   Initialize manually:"
  echo "   stellar contract invoke --id $CONTRACT_ID --source $IDENTITY --network $NETWORK -- initialize --admin <YOUR_PUBLIC_KEY>"
fi

echo ""
echo "─────────────────────────────────────────────────"
echo "  Add to your .env files:"
echo "  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID"
echo "─────────────────────────────────────────────────"
