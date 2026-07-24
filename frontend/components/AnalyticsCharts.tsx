import { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"];

interface TimeseriesPoint {
  period: string;
  sent: number;
  received: number;
  volume: number;
}

interface AssetBreakdown {
  asset: string;
  value: number;
  percentage: number;
}

interface MonthlyComparison {
  current: number;
  previous: number;
  changePercent: number;
}

interface AnalyticsChartsProps {
  timeseriesData: TimeseriesPoint[];
  assetBreakdown: AssetBreakdown[];
  monthlyComparison: MonthlyComparison;
  loading?: boolean;
}

export default function AnalyticsCharts({
  timeseriesData,
  assetBreakdown,
  monthlyComparison,
  loading = false,
}: AnalyticsChartsProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-64 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-48 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (!timeseriesData.length && !assetBreakdown.length) {
    return <p className="text-center text-gray-500">No analytics data available.</p>;
  }

  const comparisonColor = monthlyComparison.changePercent >= 0 ? "text-green-600" : "text-red-600";
  const comparisonArrow = monthlyComparison.changePercent >= 0 ? "?" : "?";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">This Month</p>
          <p className="text-2xl font-bold">{monthlyComparison.current.toFixed(2)} XLM</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Last Month</p>
          <p className="text-2xl font-bold">{monthlyComparison.previous.toFixed(2)} XLM</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Change</p>
          <p className={`text-2xl font-bold ${comparisonColor}`}>
            {comparisonArrow} {Math.abs(monthlyComparison.changePercent).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h3 className="mb-4 font-semibold">Volume Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={timeseriesData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Bar dataKey="sent" fill="#3b82f6" name="Sent" />
            <Bar dataKey="received" fill="#22c55e" name="Received" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {assetBreakdown.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-4 font-semibold">Asset Breakdown</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={assetBreakdown}
                dataKey="value"
                nameKey="asset"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ asset, percentage }) => `${asset} (${percentage}%)`}
              >
                {assetBreakdown.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
