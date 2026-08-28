#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SDK_DIR="$PROJECT_DIR/sdk"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

API_URL="${API_URL:-http://localhost:4000}"
SPEC_URL="$API_URL/api/docs.json"

if ! curl -sf "$SPEC_URL" > "$TMP_DIR/spec.json" 2>/dev/null; then
  echo "ERROR: Cannot reach $SPEC_URL. Start the backend before running this check."
  exit 1
fi

npx --yes openapi-typescript "$SPEC_URL" -o "$TMP_DIR/generated.ts"

if ! cmp -s "$TMP_DIR/generated.ts" "$SDK_DIR/src/types.ts"; then
  echo "SDK types are out of date. Run npm run generate:sdk and commit the updated sdk/src/types.ts file."
  exit 1
fi

echo "SDK type generation is up to date."
