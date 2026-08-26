/**
 * components/FeeEstimator.tsx
 * Lets the user pick a network fee tier (economy/standard/fast) for an
 * outgoing Stellar payment, based on live Horizon fee stats.
 */

import type { Transaction } from "@stellar/stellar-sdk";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  estimateAccurateFee,
  formatFeeStroopsToXlm,
  getFeeStats,
  type AccurateFeeEstimate,
} from "@/lib/fees";

export type FeeTier = "economy" | "standard" | "fast";

interface FeeEstimatorProps {
  transaction: Transaction | null;
  amount: string;
  asset: string;
  onFeeSelected: (feeStroops: number, tier: FeeTier) => void;
}

const MIN_BASE_FEE_STROOPS = 100;
const TIER_ORDER: FeeTier[] = ["economy", "standard", "fast"];

function buildTiers(min: number, standard: number, max: number): Record<FeeTier, number> {
  return {
    economy: Math.max(MIN_BASE_FEE_STROOPS, min),
    standard: Math.max(MIN_BASE_FEE_STROOPS, standard),
    fast: Math.max(MIN_BASE_FEE_STROOPS, max),
  };
}

function FeeEstimator({ transaction, amount, asset, onFeeSelected }: FeeEstimatorProps) {
  const { t } = useTranslation("common");
  const [tiers, setTiers] = useState<Record<FeeTier, number>>(() => buildTiers(100, 100, 1000));
  const [estimate, setEstimate] = useState<AccurateFeeEstimate | null>(null);
  const [selectedTier, setSelectedTier] = useState<FeeTier>("standard");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadTiers = async () => {
      try {
        const result = transaction ? await estimateAccurateFee(transaction) : null;
        const stats = result ? null : await getFeeStats();
        if (cancelled) return;
        setEstimate(result);
        if (result) {
          setTiers(
            buildTiers(result.minBaseFeeStroops, result.baseFeeStroops, result.maxBaseFeeStroops),
          );
        } else if (stats) {
          setTiers(buildTiers(stats.min, stats.p95, Math.max(stats.max, stats.p99)));
        }
      } catch {
        if (!cancelled) {
          setTiers(buildTiers(100, 100, 1000));
          setEstimate(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    loadTiers();
    return () => {
      cancelled = true;
    };
  }, [transaction, amount, asset]);

  // Store callback in a ref to avoid stale closures while respecting the
  // rules-of-hooks dependency contract.
  const onFeeSelectedRef = useRef(onFeeSelected);
  onFeeSelectedRef.current = onFeeSelected;

  useEffect(() => {
    onFeeSelectedRef.current(tiers[selectedTier], selectedTier);
  }, [tiers, selectedTier]);

  const operationCount = transaction?.operations?.length || 1;
  const totalFeeStroops =
    tiers[selectedTier] * operationCount + (estimate?.resourceFeeStroops ?? 0);

  const tierLabels: Record<FeeTier, string> = {
    economy: t("sendPayment.feeEconomy"),
    standard: t("sendPayment.feeStandard"),
    fast: t("sendPayment.feeFast"),
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {t("sendPayment.networkFee")}
        </span>
        {isLoading && (
          <div className="h-3 w-3 rounded-full border-2 border-stellar-400 border-t-transparent animate-spin" />
        )}
      </div>

      <div className="flex gap-2">
        {TIER_ORDER.map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => setSelectedTier(tier)}
            aria-pressed={selectedTier === tier}
            aria-label={`${tierLabels[tier]} fee tier`}
            className={clsx(
              "flex-1 rounded-lg border px-3 py-2 text-center transition-all",
              selectedTier === tier
                ? "bg-stellar-500/15 text-stellar-700 dark:text-stellar-300 border-stellar-500/30"
                : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20",
            )}
          >
            <span className="block text-xs font-medium">{tierLabels[tier]}</span>
            <span className="block font-mono text-xs mt-0.5">
              {formatFeeStroopsToXlm(tiers[tier])}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {t("sendPayment.estimatedFee")}: {formatFeeStroopsToXlm(totalFeeStroops)} XLM
        {amount ? ` (${amount} ${asset})` : ""}
      </p>

      {estimate && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-xs dark:border-white/10">
          <dt className="text-slate-500">CPU instructions</dt>
          <dd className="text-right font-mono">{estimate.cpuInstructions.toLocaleString()}</dd>
          <dt className="text-slate-500">Read bytes</dt>
          <dd className="text-right font-mono">{estimate.readBytes.toLocaleString()}</dd>
          <dt className="text-slate-500">Write bytes</dt>
          <dd className="text-right font-mono">{estimate.writeBytes.toLocaleString()}</dd>
          <dt className="text-slate-500">Resource fee</dt>
          <dd className="text-right font-mono">
            {estimate.resourceFeeStroops.toLocaleString()} stroops
          </dd>
          <dt className="text-slate-500">Base fee range</dt>
          <dd className="text-right font-mono">
            {estimate.minBaseFeeStroops.toLocaleString()}–
            {estimate.maxBaseFeeStroops.toLocaleString()} stroops
          </dd>
          <dt className="font-medium text-slate-600 dark:text-slate-300">Total</dt>
          <dd className="text-right font-mono font-medium">
            {totalFeeStroops.toLocaleString()} stroops
          </dd>
        </dl>
      )}

      {estimate?.warning && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {estimate.warning}
        </p>
      )}
    </div>
  );
}

export default FeeEstimator;
