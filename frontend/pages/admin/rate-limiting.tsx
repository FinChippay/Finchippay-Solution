/**
 * pages/admin/rate-limiting.tsx
 * Admin rate limiting analytics dashboard.
 *
 * Shows overview stats, top blocked IPs, per-route hit rates,
 * and a rate limit rules editor.
 */

import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import RateLimitRuleEditor from "@/components/admin/RateLimitRuleEditor";
import { apiFetch } from "@/lib/api";

interface RateLimitStats {
  requestsPerMin: number;
  blocksPerMin: number;
  topBlockedIps: Array<{ ipHash: string; breaches: number }>;
  perRouteHitRates: Array<{
    route: string;
    limiterType: string;
    allowed: number;
    blocked: number;
    total: number;
    breachRate: number;
  }>;
}

interface RateLimitRule {
  id: number;
  route: string;
  method: string;
  limit: number;
  window_ms: number;
  enabled: boolean;
}

export default function AdminRateLimitingPage() {
  const [stats, setStats] = useState<RateLimitStats | null>(null);
  const [rules, setRules] = useState<RateLimitRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, rulesRes] = await Promise.all([
        apiFetch(`${apiBase}/api/admin/rate-limits/stats`),
        apiFetch(`${apiBase}/api/admin/rate-limits`),
      ]);

      if (!statsRes.ok || !rulesRes.ok) {
        throw new Error("Failed to load rate limit data");
      }

      const statsData = await statsRes.json();
      const rulesData = await rulesRes.json();

      setStats(statsData.data);
      setRules(rulesData.rules || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-cosmos-900">
        <main className="mx-auto max-w-5xl px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-64 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
              ))}
            </div>
            <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Rate Limiting Dashboard - Finchippay Admin</title>
      </Head>
      <div className="min-h-screen bg-white dark:bg-cosmos-900">
        <main className="mx-auto max-w-5xl px-4 py-8">
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                Rate Limiting Dashboard
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Monitor and configure API rate limiting rules
              </p>
            </div>

            {error && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
                {error}
              </div>
            )}

            {/* Overview Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Requests/min
                </p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {stats?.requestsPerMin ?? 0}
                </p>
              </div>
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Blocks/min
                </p>
                <p className="text-2xl font-bold text-rose-500 mt-1">
                  {stats?.blocksPerMin ?? 0}
                </p>
              </div>
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Active Rules
                </p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {rules.length}
                </p>
              </div>
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Block Rate
                </p>
                <p className="text-2xl font-bold text-amber-500 mt-1">
                  {stats && stats.requestsPerMin > 0
                    ? `${((stats.blocksPerMin / stats.requestsPerMin) * 100).toFixed(1)}%`
                    : "0%"}
                </p>
              </div>
            </div>

            {/* Top Offenders */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Top Offenders (Blocked IPs)
              </h2>
              {stats?.topBlockedIps && stats.topBlockedIps.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-cosmos-900">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                          IP Hash
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                          Block Count
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {stats.topBlockedIps.map((ip) => (
                        <tr key={ip.ipHash} className="hover:bg-slate-50 dark:hover:bg-cosmos-900/50">
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                            {ip.ipHash.slice(0, 16)}...
                          </td>
                          <td className="px-4 py-3 text-right text-rose-500 font-medium">
                            {ip.breaches}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No blocked IPs in the current window.
                </p>
              )}
            </div>

            {/* Per-Route Stats */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Per-Route Hit Rates
              </h2>
              {stats?.perRouteHitRates && stats.perRouteHitRates.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-cosmos-900">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Route</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Type</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Allowed</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Blocked</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Total</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Breach %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {stats.perRouteHitRates.map((route) => (
                        <tr key={`${route.route}-${route.limiterType}`} className="hover:bg-slate-50 dark:hover:bg-cosmos-900/50">
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                            {route.route}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{route.limiterType}</td>
                          <td className="px-4 py-3 text-right text-emerald-500">{route.allowed}</td>
                          <td className="px-4 py-3 text-right text-rose-500">{route.blocked}</td>
                          <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">{route.total}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            <span className={`${route.breachRate > 0.1 ? 'text-rose-500' : 'text-slate-500'}`}>
                              {(route.breachRate * 100).toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No rate limit data yet.
                </p>
              )}
            </div>

            {/* Rate Limit Rules Editor */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Rate Limit Rules
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Edit rate limit rules. Changes take effect immediately — no restart required.
              </p>
              <RateLimitRuleEditor rules={rules} onUpdate={fetchData} />
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
