/**
 * components/DashboardCharts.tsx
 *
 * Route-level code splitting for the dashboard (issue #610):
 * recharts is the single heaviest client dependency on the dashboard route.
 * By moving every recharts-powered chart into this lazily-loaded module and
 * loading it via next/dynamic from the page, the ~450KB recharts bundle no
 * longer ships in the dashboard's first-load chunk. It is only fetched once
 * the charts actually mount (after the skeleton placeholder).
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export interface ChartMonthData {
  month: string;
  monthIndex: number;
  year: number;
  sent: number;
  received: number;
  label: string;
}

export interface ChartDayData {
  day: string;
  dateKey: string;
  sent: number;
  received: number;
}

export function MonthlySpendingChart({
  data,
  loading,
  onBarClick,
  t,
}: {
  data: ChartMonthData[];
  loading: boolean;
  onBarClick: (data: ChartMonthData) => void;
  t: (key: string) => string;
}) {
  if (loading && data.length === 0) {
    return (
      <div className="card mb-6 h-[350px] animate-pulse bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10" />
    );
  }

  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-6">
        {t("dashboard.monthlySpending")}
      </h2>
      <div className="h-[250px] w-[calc(100%+3rem)] -mx-6 sm:w-full sm:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            onClick={(state: unknown) => {
              const s = state as { activePayload?: Array<{ payload: ChartMonthData }> } | null;
              if (s?.activePayload?.[0]?.payload) {
                onBarClick(s.activePayload[0].payload);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              tickFormatter={(value: number) => `${value}`}
            />
            <Tooltip
              cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
              }}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ThirtyDayVolumeChart({ data, loading, t }: { data: ChartDayData[]; loading: boolean; t: (key: string) => string }) {
  if (loading && data.length === 0) {
    return <div className="card mb-6 h-[280px] animate-pulse bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10" />;
  }
  const visibleData = data.filter((_, i) => i % 5 === 0 || i === data.length - 1);
  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-6">{t("dashboard.thirtyDayVolume")}</h2>
      <div className="h-[220px] w-[calc(100%+3rem)] -mx-6 sm:w-full sm:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              ticks={visibleData.map((d) => d.day)}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" name="Sent" radius={[3, 3, 0, 0]} />
            <Bar dataKey="received" fill="#34d399" name="Received" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
