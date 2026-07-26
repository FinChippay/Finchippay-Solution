/**
 * shared/types/index.ts
 * Single point of import for API/domain types shared across the frontend
 * and SDK, re-exported from the SDK's auto-generated OpenAPI types so
 * neither side has to hand-maintain a duplicate copy.
 *
 * The frontend already depends on `@finchippay/sdk` directly as a
 * workspace package and can import types from it, but this module gives
 * any other TypeScript consumer (or a future package that doesn't want the
 * full SDK client) a stable `shared/types` import path, per the issue's
 * expected architecture.
 */
export * from "../../sdk/src/types";
