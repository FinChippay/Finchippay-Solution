/**
 * Type declarations for shared/errorCodes.js.
 *
 * This module stays CommonJS (`.js`) rather than being converted to
 * `.ts`: it's `require()`'d directly by ~15 backend files under plain
 * Node (no ts-node/build step — see backend/package.json's `start`/`dev`
 * scripts), on Node 20 in CI. Backend TypeScript conversion is out of
 * scope for this issue (tracked separately), so renaming this file to
 * `.ts` would break every one of those `require()` calls. This
 * declaration file gives frontend/SDK TypeScript consumers full typing
 * for the same module without touching its runtime behavior.
 */

export interface ErrorCodeEntry {
  code: string;
  httpStatus: number;
  message: string;
  /** Present on deprecated aliases kept for backward compatibility. */
  deprecated?: boolean;
  /** The non-deprecated code that superseded this one, if `deprecated` is set. */
  supersededBy?: string;
}

export type ErrorLayer = "api" | "contract" | "frontend" | "shared";

export const ERROR_CODES: Record<string, ErrorCodeEntry>;
export const CATEGORY_LAYERS: Record<string, ErrorLayer>;
export const CONTRACT_ERROR_MAP: Record<number, string>;

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

export function getError(code: string): ErrorCodeEntry;
export function getErrorLayer(code: string): ErrorLayer;
export function isKnownErrorCode(code: string): boolean;
export function formatErrorResponse(
  code: string,
  details?: unknown,
  overrides?: { message?: string; correlationId?: string }
): ErrorResponseBody;
export function getContractErrorCode(contractErrCode: number): string;
export function formatContractErrorResponse(
  contractErrCode: number,
  details?: unknown
): ErrorResponseBody;
export function setCorrelationIdProvider(
  provider: (() => string | undefined) | null
): void;
export function getCorrelationId(): string | undefined;
