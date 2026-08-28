import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import Skeleton from "./Skeleton";

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
  const shouldReduceMotion = useReducedMotion();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton variant="stat" height="h-24" />
          <Skeleton variant="stat" height="h-24" />
          <Skeleton variant="stat" height="h-24" />
        </div>
        <Skeleton variant="chart" height="h-80" />
        <Skeleton variant="chart" height="h-64" />
      </div>
    );
  }

  if (!timeseriesData.length && !assetBreakdown.length) {
    return <p className="text-center text-gray-500 py-8">No analytics data available.</p>;
  }

  const comparisonColor = monthlyComparison.changePercent >= 0 ? "text-green-500" : "text-red-500";
  const comparisonArrow = monthlyComparison.changePercent >= 0 ? "▲" : "▼";

  const containerVariants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 10 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
        className="space-y-6"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <motion.div variants={itemVariants} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:border-white/20">
            <p className="text-xs text-gray-400 font-medium">This Month</p>
            <p className="text-2xl font-bold mt-1 text-white">{monthlyComparison.current.toFixed(2)} XLM</p>
          </motion.div>
          <motion.div variants={itemVariants} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:border-white/20">
            <p className="text-xs text-gray-400 font-medium">Last Month</p>
            <p className="text-2xl font-bold mt-1 text-white">{monthlyComparison.previous.toFixed(2)} XLM</p>
          </motion.div>
          <motion.div variants={itemVariants} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:border-white/20">
            <p className="text-xs text-gray-400 font-medium">Monthly Change</p>
            <p className={`text-2xl font-bold mt-1 ${comparisonColor}`}>
              {comparisonArrow} {Math.abs(monthlyComparison.changePercent).toFixed(1)}%
            </p>
          </motion.div>
        </div>

        <motion.div variants={itemVariants} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="mb-4 text-base font-semibold text-white">Volume Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={timeseriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="period" fontSize={12} stroke="#9ca3af" />
              <YAxis fontSize={12} stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", borderColor: "#ffffff20", borderRadius: "8px", color: "#fff" }}
              />
              <Legend />
              <Bar dataKey="sent" fill="#3b82f6" name="Sent" radius={[4, 4, 0, 0]} />
              <Bar dataKey="received" fill="#22c55e" name="Received" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {assetBreakdown.length > 0 && (
          <motion.div variants={itemVariants} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="mb-4 text-base font-semibold text-white">Asset Breakdown</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={assetBreakdown}
                  dataKey="value"
                  nameKey="asset"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                >
                  {assetBreakdown.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", borderColor: "#ffffff20", borderRadius: "8px", color: "#fff" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
