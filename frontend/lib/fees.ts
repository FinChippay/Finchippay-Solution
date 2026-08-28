/**
 * Stellar fee estimation service.
 * Fetches fee stats from Horizon and provides tiered fee estimates.
 */

import type { Transaction } from "@stellar/stellar-sdk";
import { simulateTransactionResources } from "./soroban";
import { getNetworkConfig } from "./stellar";

export interface FeeStats {
  min: number;
  mode: number;
  p50: number;
  p95: number;
  p99: number;
  lastLedger: number;
  max: number;
}

interface CachedFeeStats {
  stats: FeeStats;
  fetchedAt: number;
}

const CACHE_DURATION_MS = 60_000; // 60 seconds
const FALLBACK_RESOURCE_FEE_STROOPS = 1_000_000;

let cachedStats: CachedFeeStats | null = null;

export async function getFeeStats(): Promise<FeeStats> {
  if (cachedStats && Date.now() - cachedStats.fetchedAt < CACHE_DURATION_MS) {
    return cachedStats.stats;
  }

  const response = await fetch(`${getNetworkConfig().horizonUrl}/fee_stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch fee stats: ${response.statusText}`);
  }

  const data = await response.json();
  const stats: FeeStats = {
    min: Number(data.min_accepted_fee || 100),
    mode: Number(data.fee_charged?.mode || 100),
    p50: Number(data.fee_charged?.p50 || 100),
    p95: Number(data.fee_charged?.p95 || 100),
    p99: Number(data.fee_charged?.p99 || 100),
    lastLedger: Number(data.last_ledger || 0),
    max: Number(data.max_fee?.max || 1000),
  };

  cachedStats = { stats, fetchedAt: Date.now() };
  return stats;
}

export function resetFeeStatsCache(): void {
  cachedStats = null;
}

export interface AccurateFeeEstimate {
  baseFeeStroops: number;
  minBaseFeeStroops: number;
  maxBaseFeeStroops: number;
  resourceFeeStroops: number;
  totalFeeStroops: number;
  cpuInstructions: number;
  readBytes: number;
  writeBytes: number;
  simulated: boolean;
  warning: string | null;
}

export function isSorobanTransaction(transaction: Transaction): boolean {
  return transaction.operations.some((operation) =>
    ["invokeHostFunction", "extendFootprintTtl", "restoreFootprint"].includes(operation.type),
  );
}

/** Combine Horizon congestion data with an actual Soroban preflight. */
export async function estimateAccurateFee(transaction: Transaction): Promise<AccurateFeeEstimate> {
  const operationCount = Math.max(1, transaction.operations.length);
  let stats: FeeStats;
  let statsWarning: string | null = null;
  try {
    stats = await getFeeStats();
  } catch {
    stats = { min: 100, mode: 100, p50: 100, p95: 100, p99: 1000, lastLedger: 0, max: 1000 };
    statsWarning = "Horizon fee statistics are unavailable; using conservative network fees.";
  }

  const baseFeeStroops = Math.max(100, stats.p95);
  const common = {
    baseFeeStroops,
    minBaseFeeStroops: Math.max(100, stats.min),
    maxBaseFeeStroops: Math.max(baseFeeStroops, stats.max, stats.p99),
  };

  if (!isSorobanTransaction(transaction)) {
    return {
      ...common,
      resourceFeeStroops: 0,
      totalFeeStroops: baseFeeStroops * operationCount,
      cpuInstructions: 0,
      readBytes: 0,
      writeBytes: 0,
      simulated: false,
      warning: statsWarning,
    };
  }

  try {
    const resources = await simulateTransactionResources(transaction);
    return {
      ...common,
      ...resources,
      totalFeeStroops: resources.resourceFeeStroops + baseFeeStroops * operationCount,
      simulated: true,
      warning: statsWarning,
    };
  } catch {
    const fallbackBaseFee = common.maxBaseFeeStroops;
    return {
      ...common,
      baseFeeStroops: fallbackBaseFee,
      resourceFeeStroops: FALLBACK_RESOURCE_FEE_STROOPS,
      totalFeeStroops: FALLBACK_RESOURCE_FEE_STROOPS + fallbackBaseFee * operationCount,
      cpuInstructions: 0,
      readBytes: 0,
      writeBytes: 0,
      simulated: false,
      warning: "Soroban simulation is unavailable; using a conservative fallback estimate.",
    };
  }
}

export type FeeTier = "economy" | "standard" | "priority";

export function estimateTransactionFee(operationCount: number, feePerOp: number): string {
  const stroops = BigInt(feePerOp) * BigInt(operationCount);
  return formatFeeStroopsToXlm(Number(stroops));
}

export function getFeeForTier(stats: FeeStats, tier: FeeTier): number {
  switch (tier) {
    case "economy":
      return stats.p50;
    case "standard":
      return stats.p95;
    case "priority":
      return stats.p99;
    default:
      return stats.p95;
  }
}

export function formatFeeStroopsToXlm(stroops: number): string {
  const stroopsStr = BigInt(Math.floor(stroops)).toString();
  const isNegative = stroopsStr.startsWith("-");
  const absStr = isNegative ? stroopsStr.slice(1) : stroopsStr;
  const paddedStr = absStr.padStart(8, "0");
  const len = paddedStr.length;
  const integerPart = paddedStr.slice(0, len - 7) || "0";
  const fractionalPart = paddedStr.slice(len - 7);
  const sign = isNegative ? "-" : "";
  return `${sign}${integerPart}.${fractionalPart}`;
}

export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  economy: "Economy",
  standard: "Standard",
  priority: "Priority",
};
