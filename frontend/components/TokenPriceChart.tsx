/**
 * components/TokenPriceChart.tsx
 * Price-history line chart for a single token, with a 7d/30d/90d range
 * selector (issue #362). Fetches from the backend's cached
 * GET /api/v1/tokens/:contractId/price-history endpoint.
 */

import clsx from "clsx";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import Skeleton from "@/components/Skeleton";

export type PriceRange = "7d" | "30d" | "90d";

const RANGES: PriceRange[] = ["7d", "30d", "90d"];

interface PricePoint {
  timestamp: number;
  price: number;
}

interface TokenPriceChartProps {
  contractId: string;
  code: string;
}

export default function TokenPriceChart({ contractId, code }: TokenPriceChartProps) {
  const { t } = useTranslation("common");
  const [range, setRange] = useState<PriceRange>("30d");
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
        const res = await fetch(
          `${apiBase}/api/v1/tokens/${contractId}/price-history?range=${range}`
        );
        if (!res.ok) throw new Error(`price-history request failed: ${res.status}`);
        const data = (await res.json()) as { prices: PricePoint[] };
        if (!cancelled) setPoints(data.prices || []);
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [contractId, range]);

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-white">
          {t("portfolio.priceHistory")} — {code}
        </h3>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={clsx(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                range === r
                  ? "bg-stellar-500/15 text-stellar-700 dark:text-stellar-300 border-stellar-500/30"
                  : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
              )}
            >
              {t(`portfolio.range${r}`)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton height="h-64" />
      ) : points.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          {t("portfolio.priceHistoryUnavailable")}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={points}>
            <XAxis
              dataKey="timestamp"
              tickFormatter={(ts: number) => new Date(ts).toLocaleDateString()}
              fontSize={12}
              minTickGap={40}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => v.toFixed(4)}
              fontSize={12}
              width={70}
            />
            <Tooltip
              labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
              formatter={(value) => Number(value).toFixed(6)}
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                color: "var(--color-text)",
              }}
              labelStyle={{ color: "var(--color-text)" }}
              itemStyle={{ color: "var(--color-text)" }}
            />
            <Line type="monotone" dataKey="price" stroke="#3b82f6" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
