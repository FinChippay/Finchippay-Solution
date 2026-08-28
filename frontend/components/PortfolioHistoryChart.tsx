/**
 * components/PortfolioHistoryChart.tsx
 * "Portfolio Value Over Time" line chart, last 30 days (issue #482).
 */

import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { PortfolioValueSnapshot, FiatCurrency } from "@/lib/portfolio";
import { formatAmount } from "@/utils/format";

interface PortfolioHistoryChartProps {
  history: PortfolioValueSnapshot[];
  fiatCurrency: FiatCurrency;
}

export default function PortfolioHistoryChart({ history, fiatCurrency }: PortfolioHistoryChartProps) {
  const { t, i18n } = useTranslation("common");

  if (history.length < 2) {
    return (
      <div className="card text-center text-sm text-slate-500 dark:text-slate-400">
        {t("portfolio.historyBuilding")}
      </div>
    );
  }

  const data = history.slice(-30).map((s) => ({ date: s.date, value: s.totalValue }));

  return (
    <div className="card">
      <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">
        {t("portfolio.valueOverTime")}
      </h3>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickFormatter={(v: number) => formatAmount(v, fiatCurrency, i18n.language)}
              width={70}
            />
            <Tooltip
              formatter={(value) => formatAmount(Number(value), fiatCurrency, i18n.language)}
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
              }}
            />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
