#!/usr/bin/env bash
# fuzz-contract.sh — Run cargo-fuzz targets for FinchippayContract
#
# Usage:
#   ./scripts/fuzz-contract.sh [seconds]
#
#   seconds: How long to run each fuzz target (default: 30)
#
# Prerequisites:
#   - cargo-fuzz installed: cargo install cargo-fuzz
#   - Rust nightly toolchain (cargo-fuzz requires nightly)
#
# Examples:
#   ./scripts/fuzz-contract.sh          # 30 seconds per target
#   ./scripts/fuzz-contract.sh 60       # 60 seconds per target (CI mode)
#   ./scripts/fuzz-contract.sh 5        # 5 seconds per target (quick smoke test)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FUZZ_DIR="$PROJECT_DIR/contracts/finchippay-contract/fuzz"
CORPUS_DIR="$FUZZ_DIR/corpus"

FUZZ_SECONDS="${1:-30}"
TARGETS=(
    "fuzz_target_1_parse_payment"
    "fuzz_target_2_escrow"
    "fuzz_target_3_multisig"
    "fuzz_target_4_batch_send"
)

# ─── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── Prerequisites ──────────────────────────────────────────────────────────
echo -e "${CYAN}🔍 Checking prerequisites…${NC}"

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ cargo not found. Install Rust from https://rustup.rs${NC}"
    exit 1
fi

if ! cargo fuzz --help &> /dev/null; then
    echo -e "${YELLOW}⚠️  cargo-fuzz not found. Installing…${NC}"
    cargo install cargo-fuzz
fi

# Ensure we have nightly rust (required by libFuzzer)
if ! rustup toolchain list | grep -q nightly; then
    echo -e "${YELLOW}⚠️  nightly toolchain not found. Installing…${NC}"
    rustup toolchain install nightly
fi

# ─── Prepare corpus directories ─────────────────────────────────────────────
echo -e "${CYAN}📁 Preparing corpus directories…${NC}"
mkdir -p "$CORPUS_DIR"

for target in "${TARGETS[@]}"; do
    mkdir -p "$CORPUS_DIR/$target"
done

# ─── Run fuzz targets ───────────────────────────────────────────────────────
echo -e "${CYAN}🚀 Running fuzz targets (${FUZZ_SECONDS}s each)…${NC}"
echo ""

PASSED=0
FAILED=0
CRASHES=()

for target in "${TARGETS[@]}"; do
    echo -e "${YELLOW}─── ${target} ───${NC}"

    # Run with a timeout; cargo-fuzz will stop after $FUZZ_SECONDS
    # Use -max_total_time to limit runtime
    start_time=$(date +%s)

    # Run fuzz target
    cargo +nightly fuzz run "$target" \
        --fuzz-dir "$FUZZ_DIR" \
        -- -max_total_time="$FUZZ_SECONDS" \
            -print_final_stats=1 \
            2>&1 | tail -20

    exit_code=${PIPESTATUS[0]}

    end_time=$(date +%s)
    elapsed=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        echo -e "  ${GREEN}✅ ${target} PASSED${NC} (${elapsed}s)"
        PASSED=$((PASSED + 1))
    else
        echo -e "  ${RED}❌ ${target} FAILED (exit code ${exit_code})${NC} (${elapsed}s)"
        FAILED=$((FAILED + 1))
        CRASHES+=("$target")

        # Check for crash artifacts
        ARTIFACT_DIR="$FUZZ_DIR/artifacts/$target"
        if [ -d "$ARTIFACT_DIR" ] && [ "$(ls -A "$ARTIFACT_DIR" 2>/dev/null)" ]; then
            echo -e "  ${RED}💥 Crash artifacts found in: ${ARTIFACT_DIR}${NC}"
            ls -la "$ARTIFACT_DIR"
        fi
    fi
    echo ""
done

# ─── Summary ────────────────────────────────────────────────────────────────
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}📊 Fuzz Test Summary${NC}"
echo -e "  Total:  $((PASSED + FAILED))"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAILED${NC}"
    echo ""
    echo -e "${RED}💥 Crashes detected in:${NC}"
    for crash in "${CRASHES[@]}"; do
        echo -e "  ${RED}  - $crash${NC}"
    done
    echo ""
    echo -e "${YELLOW}To reproduce a crash:${NC}"
    echo "  cargo +nightly fuzz run <target_name> --fuzz-dir contracts/finchippay-contract/fuzz -- <crash_artifact>"
    exit 1
else
    echo -e "${GREEN}🎉 All fuzz targets passed!${NC}"
fi
