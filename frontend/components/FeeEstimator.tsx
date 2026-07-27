/**
 * components/FeeEstimator.tsx
 *
 * Transaction fee tier selector.  Shows economy / standard / fast fee tiers
 * based on live Horizon fee stats and calls onFeeSelected when the user picks
 * a tier.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { fetchNetworkFeeStats } from "@/lib/stellar";
import { Transaction } from "@stellar/stellar-sdk";

export type FeeTier = "economy" | "standard" | "fast";

interface FeeEstimatorProps {
  /** The preview transaction (currently unused — reserved for future simulation) */
  transaction?: Transaction | null;
  /** Payment amount (for display context) */
  amount?: string;
  /** Payment asset */
  asset?: string;
  /** Called with (stroops, tier) when user selects a tier */
  onFeeSelected: (feeStroops: number, tier: FeeTier) => void;
}

interface FeeTierOption {
  tier: FeeTier;
  label: string;
  description: string;
  stroops: number;
  xlm: string;
  emoji: string;
}

const STROOPS_PER_XLM = 10_000_000;
const DEFAULT_TIERS: FeeTierOption[] = [
  {
    tier: "economy",
    label: "Economy",
    description: "May be slower",
    stroops: 100,
    xlm: "0.0000100",
    emoji: "🐢",
  },
  {
    tier: "standard",
    label: "Standard",
    description: "Recommended",
    stroops: 500,
    xlm: "0.0000500",
    emoji: "⚖️",
  },
  {
    tier: "fast",
    label: "Fast",
    description: "Prioritised",
    stroops: 1000,
    xlm: "0.0001000",
    emoji: "⚡",
  },
];

function stroopsToXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7);
}

export default function FeeEstimator({
  onFeeSelected,
}: FeeEstimatorProps) {
  const [tiers, setTiers] = useState<FeeTierOption[]>(DEFAULT_TIERS);
  const [selected, setSelected] = useState<FeeTier>("standard");
  const [loading, setLoading] = useState(true);

  // Fetch live fee stats from Horizon
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const stats = await fetchNetworkFeeStats();
        if (cancelled) return;

        const baseFeeXlm = stats.baseFeeXlm;
        const baseStroops = Math.round(baseFeeXlm * STROOPS_PER_XLM);

        const updated: FeeTierOption[] = [
          {
            tier: "economy",
            label: "Economy",
            description: "May be slower",
            stroops: Math.max(100, Math.floor(baseStroops * 0.5)),
            xlm: stroopsToXlm(Math.max(100, Math.floor(baseStroops * 0.5))),
            emoji: "🐢",
          },
          {
            tier: "standard",
            label: "Standard",
            description: "Recommended",
            stroops: Math.max(100, baseStroops),
            xlm: stroopsToXlm(Math.max(100, baseStroops)),
            emoji: "⚖️",
          },
          {
            tier: "fast",
            label: "Fast",
            description: "Prioritised",
            stroops: Math.max(100, Math.ceil(baseStroops * 2)),
            xlm: stroopsToXlm(Math.max(100, Math.ceil(baseStroops * 2))),
            emoji: "⚡",
          },
        ];

        setTiers(updated);

        // Notify parent with the default "standard" tier
        const standardTier = updated.find((t) => t.tier === "standard")!;
        onFeeSelected(standardTier.stroops, "standard");
      } catch {
        // Fall back to static defaults — already set via useState
        const standard = DEFAULT_TIERS.find((t) => t.tier === "standard")!;
        if (!cancelled) {
          onFeeSelected(standard.stroops, "standard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (tier: FeeTierOption) => {
    setSelected(tier.tier);
    onFeeSelected(tier.stroops, tier.tier);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Network fee
        {loading && (
          <span className="ml-1 text-slate-400 dark:text-slate-500">(fetching…)</span>
        )}
      </p>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Fee tier">
        {tiers.map((tier) => {
          const isSelected = selected === tier.tier;
          return (
            <button
              key={tier.tier}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleSelect(tier)}
              className={clsx(
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-colors",
                isSelected
                  ? "border-stellar-500 bg-stellar-500/10 text-stellar-600 dark:text-stellar-400"
                  : "border-slate-200 dark:border-cosmos-600 bg-white dark:bg-cosmos-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-cosmos-500"
              )}
            >
              <span className="text-base" aria-hidden="true">{tier.emoji}</span>
              <span className="text-xs font-semibold">{tier.label}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {tier.xlm} XLM
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {tier.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
