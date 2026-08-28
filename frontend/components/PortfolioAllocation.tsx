/**
 * components/PortfolioAllocation.tsx
 * Donut chart of portfolio allocation by token, with a clickable legend
 * (issue #362).
 */

import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Skeleton from "@/components/Skeleton";
import type { PortfolioToken, TokenPriceSnapshot, FiatCurrency } from "@/lib/portfolio";
import { formatAmount } from "@/utils/format";

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"];

interface PortfolioAllocationProps {
  holdings: PortfolioToken[];
  prices: Record<string, TokenPriceSnapshot>;
  fiatCurrency: FiatCurrency;
  selectedCode?: string | null;
  onSelectToken?: (code: string) => void;
  loading?: boolean;
}

interface Slice {
  code: string;
  value: number;
}

export default function PortfolioAllocation({
  holdings,
  prices,
  fiatCurrency,
  selectedCode,
  onSelectToken,
  loading = false,
}: PortfolioAllocationProps) {
  const { t, i18n } = useTranslation("common");

  if (loading) {
    return <Skeleton height="h-72" />;
  }

  const slices: Slice[] = holdings
    .map((h) => {
      const price = prices[h.code]?.prices[fiatCurrency];
      const value = price === undefined ? 0 : parseFloat(h.balance) * price;
      return { code: h.code, value };
    })
    .filter((s) => s.value > 0);

  const totalValue = slices.reduce((sum, s) => sum + s.value, 0);

  if (slices.length === 0) {
    return (
      <div className="card text-center text-slate-500 dark:text-slate-400">
        {t("portfolio.noHoldings")}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">{t("portfolio.allocation")}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="code"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            onClick={(_, index) => onSelectToken?.(slices[index]?.code)}
          >
            {slices.map((slice, i) => (
              <Cell
                key={slice.code}
                fill={COLORS[i % COLORS.length]}
                stroke={slice.code === selectedCode ? "#0ea5e9" : undefined}
                strokeWidth={slice.code === selectedCode ? 3 : 0}
                cursor="pointer"
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatAmount(Number(value), fiatCurrency, i18n.language)}
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.75rem",
              color: "var(--color-text)",
            }}
            labelStyle={{ color: "var(--color-text)" }}
            itemStyle={{ color: "var(--color-text)" }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-4 space-y-2">
        {slices.map((slice, i) => (
          <button
            key={slice.code}
            type="button"
            onClick={() => onSelectToken?.(slice.code)}
            className={clsx(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
              slice.code === selectedCode
                ? "bg-stellar-500/15 text-stellar-700 dark:text-stellar-300"
                : "hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300"
            )}
          >
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              {slice.code}
            </span>
            <span className="flex items-center gap-3 font-mono">
              <span>{totalValue > 0 ? ((slice.value / totalValue) * 100).toFixed(1) : "0.0"}%</span>
              <span>{formatAmount(slice.value, fiatCurrency, i18n.language)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
