/**
 * components/FeeEstimator.tsx
 * Lets the user pick a network fee tier (economy/standard/fast) for an
 * outgoing Stellar payment, based on live Horizon fee stats.
 */

import type { Transaction } from "@stellar/stellar-sdk";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchNetworkFeeStats, STELLAR_BASE_FEE_XLM } from "@/lib/stellar";

export type FeeTier = "economy" | "standard" | "fast";

interface FeeEstimatorProps {
  transaction: Transaction | null;
  amount: string;
  asset: string;
  onFeeSelected: (feeStroops: number, tier: FeeTier) => void;
}

const STROOPS_PER_XLM = 10_000_000;
const MIN_BASE_FEE_STROOPS = 100;
const TIER_ORDER: FeeTier[] = ["economy", "standard", "fast"];

function buildTiers(baseFeeXlm: number): Record<FeeTier, number> {
  const modeStroops = Math.max(
    MIN_BASE_FEE_STROOPS,
    Math.round(baseFeeXlm * STROOPS_PER_XLM)
  );
  return {
    economy: MIN_BASE_FEE_STROOPS,
    standard: modeStroops,
    fast: Math.max(modeStroops * 3, MIN_BASE_FEE_STROOPS * 3),
  };
}

function FeeEstimator({ transaction, amount, asset, onFeeSelected }: FeeEstimatorProps) {
  const { t } = useTranslation("common");
  const [tiers, setTiers] = useState<Record<FeeTier, number>>(() =>
    buildTiers(STELLAR_BASE_FEE_XLM)
  );
  const [selectedTier, setSelectedTier] = useState<FeeTier>("standard");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadTiers = async () => {
      try {
        const stats = await fetchNetworkFeeStats();
        if (!cancelled) {
          setTiers(buildTiers(stats.baseFeeXlm || STELLAR_BASE_FEE_XLM));
        }
      } catch {
        if (!cancelled) {
          setTiers(buildTiers(STELLAR_BASE_FEE_XLM));
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
  }, []);

  // Store callback in a ref to avoid stale closures while respecting the
  // rules-of-hooks dependency contract.
  const onFeeSelectedRef = useRef(onFeeSelected);
  onFeeSelectedRef.current = onFeeSelected;

  useEffect(() => {
    onFeeSelectedRef.current(tiers[selectedTier], selectedTier);
  }, [tiers, selectedTier]);

  const operationCount = transaction?.operations?.length || 1;
  const totalFeeXlm = (tiers[selectedTier] * operationCount) / STROOPS_PER_XLM;

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
                : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
            )}
          >
            <span className="block text-xs font-medium">{tierLabels[tier]}</span>
            <span className="block font-mono text-xs mt-0.5">
              {(tiers[tier] / STROOPS_PER_XLM).toFixed(7)}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {t("sendPayment.estimatedFee")}: {totalFeeXlm.toFixed(7)} XLM
        {amount ? ` (${amount} ${asset})` : ""}
      </p>
    </div>
  );
}

export default FeeEstimator;
