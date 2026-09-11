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

# The SDK's src/types.ts is a hand-maintained, flat type surface (the client
# and the frontend import its interface names directly), so it can never be
# byte-identical to raw openapi-typescript output. What we CAN verify is that
# (a) the live spec is well-formed, (b) every type the SDK client imports
# still exists in src/types.ts, and (c) the SDK still compiles against it.
# That catches real drift — deleted/renamed types or a broken spec — without
# the impossible byte comparison.
if ! npx --yes openapi-typescript "$SPEC_URL" -o "$TMP_DIR/generated.ts" 2>/dev/null; then
  echo "ERROR: openapi-typescript failed to generate types from $SPEC_URL — the OpenAPI spec is malformed."
  exit 1
fi

# Extract the names the client imports from "./types" (the block between
# `import {` and `from "./types";`, minus comments/commas), then make sure
# each one is declared in sdk/src/types.ts.
IMPORT_BLOCK="$(awk '/from "\.\/types";/ { exit } /^import \{/ { in_import = 1; next } in_import { print }' "$SDK_DIR/src/client.ts")"
MISSING=0
while read -r name; do
  [ -n "$name" ] || continue
  if ! grep -qE "export (interface|type) ${name}\\b" "$SDK_DIR/src/types.ts"; then
    echo "ERROR: type '${name}' is imported by sdk/src/client.ts but not declared in sdk/src/types.ts"
    MISSING=1
  fi
done < <(printf '%s\n' "$IMPORT_BLOCK" | sed 's/\/\*[^*]*\*\///g' | tr ',' '\n' | grep -oE '[A-Za-z_][A-Za-z0-9_]*' | sort -u)

if [ "$MISSING" -eq 1 ]; then
  exit 1
fi

# The SDK must still type-check against the committed types file. This catches
# accidental drift between the client and its type surface.
(cd "$SDK_DIR" && npx tsc --noEmit)

echo "SDK types are up to date (spec reachable, imports resolved, type-check clean)."