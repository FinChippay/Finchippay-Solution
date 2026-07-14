#!/usr/bin/env bash
# scripts/deploy-frontend.sh
# Deploy the Next.js frontend to Vercel (or any Node host).
#
# Usage:
#   chmod +x scripts/deploy-frontend.sh
#   ./scripts/deploy-frontend.sh [testnet|mainnet]

set -euo pipefail

NETWORK=${1:-testnet}

echo "🚀 Deploying Stellar MicroPay Frontend"
echo "   Network: $NETWORK"
echo ""

# Validate network argument
if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
  echo "❌ Invalid network. Use: testnet or mainnet"
  exit 1
fi

# Set Horizon URL based on network
if [[ "$NETWORK" == "mainnet" ]]; then
  HORIZON_URL="https://horizon.stellar.org"
  echo "⚠️  WARNING: Deploying to MAINNET with real XLM!"
  read -p "   Are you sure? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
else
  HORIZON_URL="https://horizon-testnet.stellar.org"
fi

cd "$(dirname "$0")/../frontend"

echo "📦 Installing dependencies..."
npm ci

echo "🔍 Running type check..."
npm run type-check

echo "🔍 Running linter..."
npm run lint

echo "🏗️  Building Next.js app..."
NEXT_PUBLIC_STELLAR_NETWORK=$NETWORK \
NEXT_PUBLIC_HORIZON_URL=$HORIZON_URL \
npm run build

echo ""
echo "✅ Build complete!"
echo ""
echo "Next steps:"
echo "  • Vercel:   vercel deploy --prod"
echo "  • Self-host: npm start (runs on port 3000)"
echo "  • Docker:   docker build -t stellar-micropay-frontend ."
