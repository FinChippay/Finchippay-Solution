/**
 * components/PaymentLinkAnalytics.tsx
 * Analytics card for the Payment Links dashboard — shows aggregate stats
 * (views, payments, total collected, conversion rate) and a small
 * views-vs-payments chart across the link list.
 */
import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { PaymentLinkRecord } from "@/lib/paymentLinks";
import { formatAsset } from "@/utils/format";

interface PaymentLinkAnalyticsProps {
  links: PaymentLinkRecord[];
}

interface ChartPoint {
  label: string;
  views: number;
  payments: number;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function PaymentLinkAnalytics({
  links,
}: PaymentLinkAnalyticsProps) {
  const { totalViews, totalPayments, totalCollected, chartData, hasData } =
    useMemo(() => {
      let views = 0;
      let payments = 0;
      let collected = 0;
      const byDay = new Map<string, ChartPoint>();

      for (const link of links) {
        const v = link.viewCount ?? 0;
        const p = link.paymentCount ?? 0;
        views += v;
        payments += p;
        collected += link.totalCollected ?? 0;

        if (v > 0 || p > 0) {
          const key = dayKey(link.createdAt);
          const existing = byDay.get(key) ?? { label: key, views: 0, payments: 0 };
          existing.views += v;
          existing.payments += p;
          byDay.set(key, existing);
        }
      }

      const chartData = [...byDay.values()].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );

      return {
        totalViews: views,
        totalPayments: payments,
        totalCollected: collected,
        chartData,
        hasData: links.length > 0,
      };
    }, [links]);

  const conversionRate =
    totalViews > 0 ? Math.round((totalPayments / totalViews) * 100) : 0;

  if (!hasData) return null;

  return (
    <section
      className="card border-stellar-400/20 p-6"
      aria-label="Payment links analytics"
    >
      <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-6">
        Payment Links Analytics
      </h3>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatCard label="Total Views" value={String(totalViews)} />
        <StatCard label="Total Payments" value={String(totalPayments)} />
        <StatCard label="Total Collected" value={formatAsset(totalCollected)} />
        <StatCard label="Conversion Rate" value={`${conversionRate}%`} />
      </div>

      {chartData.length > 0 ? (
        <div className="h-56 w-full" role="img" aria-label="Views and payments over time">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "#0b0f1a",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="views"
                name="Views"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="payments"
                name="Payments"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No view or payment activity yet. Share your payment links to start
          tracking analytics.
        </p>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-1">
        {label}
      </p>
      <p className="text-xl font-bold text-slate-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
