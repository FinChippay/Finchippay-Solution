/**
 * components/FeeEstimator.tsx
 * Lets the user pick a network fee tier (economy/standard/fast) for a
 * payment, based on the current Stellar network base fee.
 */

import { useEffect, useState } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import {
  fetchNetworkFeeStats,
  STELLAR_BASE_FEE_STROOPS,
  STELLAR_STROOPS_PER_XLM,
} from "@/lib/stellar";

export type FeeTier = "economy" | "standard" | "fast";

interface FeeEstimatorProps {
  /** The built (but not yet submitted) transaction, if one has been prepared. */
  transaction: Transaction | null;
  amount: string;
  asset: string;
  onFeeSelected: (feeStroops: number, tier: FeeTier) => void;
}

interface TierOption {
  tier: FeeTier;
  label: string;
  feeStroops: number;
}

export default function FeeEstimator({ transaction, onFeeSelected }: FeeEstimatorProps) {
  const [tiers, setTiers] = useState<TierOption[] | null>(null);
  const [selectedTier, setSelectedTier] = useState<FeeTier>("standard");

  useEffect(() => {
    let cancelled = false;

    fetchNetworkFeeStats()
      .then(({ baseFeeXlm }) => {
        if (cancelled) return;

        const standardStroops = Math.max(
          STELLAR_BASE_FEE_STROOPS,
          Math.round(baseFeeXlm * STELLAR_STROOPS_PER_XLM)
        );

        const options: TierOption[] = [
          { tier: "economy", label: "Economy", feeStroops: STELLAR_BASE_FEE_STROOPS },
          { tier: "standard", label: "Standard", feeStroops: standardStroops },
          { tier: "fast", label: "Fast", feeStroops: Math.round(standardStroops * 1.5) },
        ];

        setTiers(options);
        const initial = options.find((o) => o.tier === "standard") ?? options[0];
        onFeeSelected(initial.feeStroops, initial.tier);
      })
      .catch(() => {
        if (cancelled) return;
        // Network fee stats unavailable — fall back to the protocol minimum
        // for every tier rather than blocking the send flow.
        const options: TierOption[] = [
          { tier: "economy", label: "Economy", feeStroops: STELLAR_BASE_FEE_STROOPS },
          { tier: "standard", label: "Standard", feeStroops: STELLAR_BASE_FEE_STROOPS },
          { tier: "fast", label: "Fast", feeStroops: STELLAR_BASE_FEE_STROOPS },
        ];
        setTiers(options);
        onFeeSelected(STELLAR_BASE_FEE_STROOPS, "standard");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tiers) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4">
      <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">
        Network fee
      </p>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((option) => (
          <button
            key={option.tier}
            type="button"
            onClick={() => {
              setSelectedTier(option.tier);
              onFeeSelected(option.feeStroops, option.tier);
            }}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              selectedTier === option.tier
                ? "border-stellar-500 bg-stellar-500/10 text-stellar-600 dark:text-stellar-400"
                : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400"
            }`}
          >
            <div>{option.label}</div>
            <div className="mt-0.5 font-mono">
              {(option.feeStroops / STELLAR_STROOPS_PER_XLM).toFixed(7)} XLM
            </div>
          </button>
        ))}
      </div>
      {transaction && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Prepared transaction fee:{" "}
          {(parseInt(transaction.fee, 10) / STELLAR_STROOPS_PER_XLM).toFixed(7)} XLM
        </p>
      )}
    </div>
  );
}
