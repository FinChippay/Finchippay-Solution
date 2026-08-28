/**
 * @file lib/pathFinder.ts
 * @description Stellar Horizon path-payment discovery helpers for the swap interface.
 *
 * Uses the Horizon `/paths/strict-send` and `/paths/strict-receive` endpoints to
 * find the best multi-hop route between two assets. Supports up to 6 intermediate
 * hops as allowed by Stellar protocol.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/aggregations/paths/strict-send | Horizon strict-send}
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/aggregations/paths/strict-receive | Horizon strict-receive}
 */

import { Asset } from "@stellar/stellar-sdk";
import { getNetworkConfig } from "./stellarConfig";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A single asset hop in the payment path.
 * Native XLM is represented as `{ asset_type: "native" }`.
 */
export interface PathAsset {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12";
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * A payment path record returned by Horizon.
 */
export interface PaymentPath {
  /** Source asset being sold. */
  source_asset_type: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  /** The amount the source account would send. */
  source_amount: string;
  /** Destination asset being bought. */
  destination_asset_type: string;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  /** The amount the destination account would receive. */
  destination_amount: string;
  /**
   * Intermediate hops in the path (up to 6 assets).
   * Empty array means a direct swap with no intermediate hops.
   */
  path: PathAsset[];
}

/**
 * Result of a path-finding query, including the best selected path.
 */
export interface PathFinderResult {
  /** All paths returned by Horizon, sorted best-first. */
  paths: PaymentPath[];
  /** The best path selected (index 0). */
  bestPath: PaymentPath | null;
  /** Human-readable route string, e.g. "XLM → USDC" or "XLM → yXLM → USDC". */
  routeDisplay: string;
  /** Source amount (for strict-receive this is the estimated send amount). */
  sourceAmount: string;
  /** Destination amount (for strict-send this is the estimated receive amount). */
  destinationAmount: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a Stellar `Asset` to Horizon query parameter strings.
 */
function assetToParams(
  asset: Asset,
  prefix: "source" | "destination"
): Record<string, string> {
  if (asset.isNative()) {
    return { [`${prefix}_asset_type`]: "native" };
  }
  const assetType =
    asset.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
  return {
    [`${prefix}_asset_type`]: assetType,
    [`${prefix}_asset_code`]: asset.code,
    [`${prefix}_asset_issuer`]: asset.issuer,
  };
}

/**
 * Format a {@link PathAsset} as a short human-readable string, e.g. `"XLM"` or `"USDC"`.
 */
export function formatPathAsset(asset: PathAsset): string {
  if (asset.asset_type === "native") return "XLM";
  return asset.asset_code ?? "???";
}

/**
 * Build a display string for the swap route from a {@link PaymentPath}.
 *
 * @example
 * buildRouteDisplay(path) // "XLM → yXLM → USDC"
 */
export function buildRouteDisplay(
  path: PaymentPath,
  sourceAsset: Asset,
  destAsset: Asset
): string {
  const sourceLabel = sourceAsset.isNative()
    ? "XLM"
    : sourceAsset.code;
  const destLabel = destAsset.isNative() ? "XLM" : destAsset.code;

  if (!path.path || path.path.length === 0) {
    return `${sourceLabel} → ${destLabel}`;
  }

  const hops = path.path.map(formatPathAsset);
  return [sourceLabel, ...hops, destLabel].join(" → ");
}

// ─── Strict-send path finding ────────────────────────────────────────────────

/**
 * Find optimal payment paths using Horizon's strict-send endpoint.
 *
 * The caller specifies **exactly how much they want to send** (`sourceAmount`),
 * and Horizon returns possible paths ranked by destination amount (most received first).
 *
 * Stellar protocol allows up to 6 intermediate assets per path.
 *
 * @param sourceAsset    - The asset the user is paying with.
 * @param sourceAmount   - Exact amount the user will send.
 * @param destAsset      - The asset the user wants to receive.
 * @param destinationAccount - Destination account public key (used by Horizon for trustline checks).
 * @returns Sorted paths with the best (highest destination amount) first.
 */
export async function findStrictSendPaths(
  sourceAsset: Asset,
  sourceAmount: string,
  destAsset: Asset,
  destinationAccount?: string
): Promise<PathFinderResult> {
  const config = getNetworkConfig();
  const baseUrl = config.horizonUrl;

  const params = new URLSearchParams({
    ...assetToParams(sourceAsset, "source"),
    source_amount: sourceAmount,
    ...assetToParams(destAsset, "destination"),
  });

  // destination_account is optional but improves trustline accuracy when provided
  if (destinationAccount) {
    params.set("destination_account", destinationAccount);
  }

  const url = `${baseUrl}/paths/strict-send?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      // 404 means no paths found — return empty result
      return {
        paths: [],
        bestPath: null,
        routeDisplay: "",
        sourceAmount,
        destinationAmount: "0",
      };
    }
    throw new Error(
      `Horizon strict-send path lookup failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    _embedded?: { records?: PaymentPath[] };
  };

  const records: PaymentPath[] = data?._embedded?.records ?? [];

  // Sort best-first: highest destination_amount first
  const sorted = [...records].sort(
    (a, b) => parseFloat(b.destination_amount) - parseFloat(a.destination_amount)
  );

  const best = sorted[0] ?? null;

  return {
    paths: sorted,
    bestPath: best,
    routeDisplay: best
      ? buildRouteDisplay(best, sourceAsset, destAsset)
      : `${sourceAsset.isNative() ? "XLM" : sourceAsset.code} → ${destAsset.isNative() ? "XLM" : destAsset.code}`,
    sourceAmount,
    destinationAmount: best?.destination_amount ?? "0",
  };
}

// ─── Strict-receive path finding ─────────────────────────────────────────────

/**
 * Find optimal payment paths using Horizon's strict-receive endpoint.
 *
 * The caller specifies **exactly how much they want to receive** (`destAmount`),
 * and Horizon returns possible paths ranked by source amount (least spent first).
 *
 * Stellar protocol allows up to 6 intermediate assets per path.
 *
 * @param sourceAsset     - The asset the user is paying with.
 * @param destAsset       - The asset the user wants to receive.
 * @param destAmount      - Exact amount the user wants to receive.
 * @param sourceAccount   - Payer's account public key (used by Horizon for trustline checks).
 * @returns Sorted paths with the best (lowest source amount) first.
 */
export async function findStrictReceivePaths(
  sourceAsset: Asset,
  destAsset: Asset,
  destAmount: string,
  sourceAccount?: string
): Promise<PathFinderResult> {
  const config = getNetworkConfig();
  const baseUrl = config.horizonUrl;

  const params = new URLSearchParams({
    ...assetToParams(sourceAsset, "source"),
    ...assetToParams(destAsset, "destination"),
    destination_amount: destAmount,
  });

  // source_account is optional but improves trustline accuracy when provided
  if (sourceAccount) {
    params.set("source_account", sourceAccount);
  }

  const url = `${baseUrl}/paths/strict-receive?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        paths: [],
        bestPath: null,
        routeDisplay: "",
        sourceAmount: "0",
        destinationAmount: destAmount,
      };
    }
    throw new Error(
      `Horizon strict-receive path lookup failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    _embedded?: { records?: PaymentPath[] };
  };

  const records: PaymentPath[] = data?._embedded?.records ?? [];

  // Sort best-first: lowest source_amount first
  const sorted = [...records].sort(
    (a, b) => parseFloat(a.source_amount) - parseFloat(b.source_amount)
  );

  const best = sorted[0] ?? null;

  return {
    paths: sorted,
    bestPath: best,
    routeDisplay: best
      ? buildRouteDisplay(best, sourceAsset, destAsset)
      : `${sourceAsset.isNative() ? "XLM" : sourceAsset.code} → ${destAsset.isNative() ? "XLM" : destAsset.code}`,
    sourceAmount: best?.source_amount ?? "0",
    destinationAmount: destAmount,
  };
}

// ─── Price impact calculation ─────────────────────────────────────────────────

/**
 * Estimate the price impact percentage for a swap.
 *
 * Price impact is the ratio of the unfavourable price deviation from the
 * mid-market rate. A simple approximation is used here because exact
 * AMM-style pool depths are not always available via Horizon paths.
 *
 * @param sourceAmount      - Amount being sold.
 * @param destinationAmount - Amount being received.
 * @param marketRate        - Reference market rate (destAsset per sourceAsset). Pass 0 to skip.
 * @returns Price impact as a decimal percentage (e.g. 2.5 = 2.5%).
 */
export function calculatePriceImpact(
  sourceAmount: string,
  destinationAmount: string,
  marketRate?: number
): number {
  const src = parseFloat(sourceAmount);
  const dst = parseFloat(destinationAmount);

  if (!src || !dst || src <= 0 || dst <= 0) return 0;

  if (marketRate && marketRate > 0) {
    // Compare actual rate vs market rate
    const actualRate = dst / src;
    const impact = Math.abs((actualRate - marketRate) / marketRate) * 100;
    return Math.round(impact * 100) / 100;
  }

  // Without a reference rate, return 0 (caller should supply market rate when possible)
  return 0;
}

/**
 * Apply slippage tolerance to a destination amount to derive the minimum received.
 *
 * `minimumReceived = destinationAmount × (1 − slippagePercent / 100)`
 *
 * @param destinationAmount - Expected destination amount.
 * @param slippagePercent   - Slippage tolerance (e.g. 0.5 for 0.5%).
 * @returns Minimum received amount as a string (7 decimal places).
 */
export function applySlippage(
  destinationAmount: string,
  slippagePercent: number
): string {
  const dst = parseFloat(destinationAmount);
  if (!dst || dst <= 0) return "0.0000000";
  const slippageFactor = 1 - slippagePercent / 100;
  const minReceived = dst * slippageFactor;
  return minReceived.toFixed(7);
}

/**
 * Convert a `PathAsset[]` returned by Horizon paths API into an `Asset[]`
 * from the Stellar SDK, suitable for use in `pathPaymentStrictSend` /
 * `pathPaymentStrictReceive` operations.
 */
export function pathAssetsToStellarAssets(pathAssets: PathAsset[]): Asset[] {
  return pathAssets.map((p) => {
    if (p.asset_type === "native") return Asset.native();
    return new Asset(p.asset_code!, p.asset_issuer!);
  });
}
