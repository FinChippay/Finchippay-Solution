#!/usr/bin/env bash
#
# scripts/gen-contract-bindings.sh
# Auto-generates TypeScript bindings from the deployed Soroban contract ABI.
#
# Prerequisites:
#   - Stellar CLI installed (cargo install --locked stellar-cli)
#   - The contract must already be deployed to the target network
#
# Usage:
#   ./scripts/gen-contract-bindings.sh                          # Uses CONTRACT_ID & network defaults
#   CONTRACT_ID=C... ./scripts/gen-contract-bindings.sh         # Override contract ID
#   NETWORK=mainnet ./scripts/gen-contract-bindings.sh          # Override network (default: testnet)
#   ./scripts/gen-contract-bindings.sh testnet C...             # Positional args
#
# Output:
#   frontend/lib/contract-bindings/  — TypeScript source files
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/frontend/lib/contract-bindings"

# ─── Config ──────────────────────────────────────────────────────────────────
NETWORK="${1:-${NETWORK:-testnet}}"
CONTRACT_ID="${2:-${CONTRACT_ID:-}}"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "ERROR: No contract ID provided."
  echo ""
  echo "  Provide one of:"
  echo "    - CONTRACT_ID env var"
  echo "    - Second positional argument"
  echo "    - NEXT_PUBLIC_CONTRACT_ID in frontend/.env or frontend/.env.local"
  echo ""
  echo "  Examples:"
  echo "    CONTRACT_ID=C... ./scripts/gen-contract-bindings.sh"
  echo "    ./scripts/gen-contract-bindings.sh testnet C..."
  exit 1
fi

# ─── Validate prerequisites ──────────────────────────────────────────────────
if ! command -v stellar &>/dev/null; then
  echo "ERROR: 'stellar' CLI not found."
  echo "  Install: cargo install --locked stellar-cli"
  exit 1
fi

# ─── Generate bindings ──────────────────────────────────────────────────────
echo "==> Generating TypeScript bindings for contract $CONTRACT_ID on $NETWORK ..."
echo "    Output: $OUTPUT_DIR"

mkdir -p "$OUTPUT_DIR"

stellar contract bindings typescript \
  --contract-id "$CONTRACT_ID" \
  --output-dir "$OUTPUT_DIR" \
  --network "$NETWORK"

echo ""
echo "==> Bindings generated successfully!"
echo "    Files:"
find "$OUTPUT_DIR" -type f -name "*.ts" | while read -r f; do
  echo "      - ${f#$PROJECT_DIR/}"
done
echo ""
echo "Next steps:"
echo "  1. Review the generated types in frontend/lib/contract-bindings/"
echo "  2. Import them in frontend/lib/stellar.ts instead of manual nativeToScVal calls"
echo ""
echo "   Example:"
echo "     import { sendTip } from '../lib/contract-bindings';"
echo ""
