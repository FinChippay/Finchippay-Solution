#!/usr/bin/env bash
# tests/load/run-all.sh
# Run all k6 load test scenarios and write JSON results to k6-results/.
#
# Usage:
#   BASE_URL=http://localhost:4000 bash tests/load/run-all.sh
#
# Requirements:
#   k6 must be installed and on PATH.
#   See: https://k6.io/docs/getting-started/installation/
#
# Output:
#   k6-results/dashboard-traffic.json
#   k6-results/payment-burst.json
#   k6-results/analytics-query.json
#   k6-results/sustained-load.json
#   k6-results/summary.txt

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
TEST_PUBLIC_KEY="${TEST_PUBLIC_KEY:-GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW}"
RESULTS_DIR="k6-results"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================================"
echo " Finchippay k6 Load Test Suite"
echo " Target: ${BASE_URL}"
echo " Results: ${RESULTS_DIR}/"
echo "======================================================"
echo ""

# Verify k6 is available
if ! command -v k6 &>/dev/null; then
  echo "❌ k6 is not installed. Install it from https://k6.io/docs/get-started/installation/"
  exit 1
fi

mkdir -p "${RESULTS_DIR}"
SUMMARY_FILE="${RESULTS_DIR}/summary.txt"
echo "Load test run: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "${SUMMARY_FILE}"
echo "Target: ${BASE_URL}" >> "${SUMMARY_FILE}"
echo "" >> "${SUMMARY_FILE}"

run_scenario() {
  local name="$1"
  local script="${SCRIPT_DIR}/${name}.js"
  local output="${RESULTS_DIR}/${name}.json"

  echo "▶  Running: ${name}"
  echo "   Script:  ${script}"
  echo "   Output:  ${output}"
  echo ""

  set +e
  k6 run \
    --env BASE_URL="${BASE_URL}" \
    --env TEST_PUBLIC_KEY="${TEST_PUBLIC_KEY}" \
    --out "json=${output}" \
    "${script}"
  EXIT_CODE=$?
  set -e

  if [ $EXIT_CODE -eq 0 ]; then
    echo "   ✅ ${name} — PASSED" | tee -a "${SUMMARY_FILE}"
  else
    echo "   ❌ ${name} — FAILED (exit code: ${EXIT_CODE})" | tee -a "${SUMMARY_FILE}"
    FAILED_SCENARIOS="${FAILED_SCENARIOS:-} ${name}"
  fi
  echo ""
}

FAILED_SCENARIOS=""

run_scenario "dashboard-traffic"
run_scenario "payment-burst"
run_scenario "analytics-query"
run_scenario "sustained-load"

echo "======================================================"
echo " Summary"
echo "======================================================"
cat "${SUMMARY_FILE}"
echo ""

if [ -n "${FAILED_SCENARIOS:-}" ]; then
  echo "❌ Failed scenarios:${FAILED_SCENARIOS}"
  echo "   Review ${RESULTS_DIR}/*.json for details."
  exit 1
fi

echo "✅ All load test scenarios passed."
echo "   JSON results saved to ${RESULTS_DIR}/"
