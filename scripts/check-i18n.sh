#!/usr/bin/env bash
#
# scripts/check-i18n.sh
# Validates that translation files are in sync with source code keys.
#
# i18next-scanner v4 removed --dry-run, so we scan to a temp directory
# and compare against the committed locale files.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$FRONTEND_DIR"

echo "==> Scanning for translation keys ..."
npx i18next-scanner --config i18next-scanner.config.js --output "$TMP_DIR" \
  "pages/**/*.{js,jsx,ts,tsx}" \
  "components/**/*.{js,jsx,ts,tsx}" \
  "lib/**/*.{js,jsx,ts,tsx}" \
  2>&1

# Check for missing translation placeholders in the generated output.
echo "==> Checking for missing translations ..."
MISSING=0
for lang in en es fr ar he; do
  if [ -f "$TMP_DIR/$lang/common.json" ]; then
    if grep -q "__MISSING_TRANSLATION__" "$TMP_DIR/$lang/common.json"; then
      echo "ERROR: Missing translations found in $lang/common.json"
      MISSING=1
    fi
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Missing translations detected. Run 'npm run i18n:scan' locally and add the missing"
  echo "translations to public/locales/{lang}/common.json."
  exit 1
fi

echo "i18n translation keys are up to date."
