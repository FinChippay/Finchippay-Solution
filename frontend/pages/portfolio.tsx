/**
 * pages/portfolio.tsx
 * Portfolio overview page — asset allocation breakdown and performance summary.
 *
 * Gated behind the "new_portfolio" feature flag (#103).
 * Renders a "coming soon" fallback when the flag is off.
 */

import Head from "next/head";
import { FeatureGate } from "@/lib/FeatureFlags";
import { useWallet } from "@/lib/useWallet";
import Link from "next/link";

export default function PortfolioPage() {
  const { publicKey } = useWallet();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <Head>
        <title>Portfolio | Finchippay</title>
        <meta
          name="description"
          content="View your Stellar asset allocation, performance history, and portfolio breakdown."
        />
      </Head>

      <FeatureGate
        flag="new_portfolio"
        fallback={
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-stellar-500/10 border border-stellar-500/20 flex items-center justify-center mb-6">
              <ChartPieIcon className="w-8 h-8 text-stellar-500" />
            </div>
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">
              Portfolio — Coming Soon
            </h1>
            <p className="text-slate-600 dark:text-slate-400 max-w-md mb-6">
              The portfolio overview page is currently in limited preview. Check
              back soon or head to the dashboard for your current balances.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-stellar-500 hover:bg-stellar-600 text-white font-semibold text-sm py-2.5 px-5 rounded-lg transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        }
      >
        {/* ── Feature content (rendered when new_portfolio flag is on) ── */}
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-1">
            Portfolio
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-8">
            Asset allocation and performance for{" "}
            <span className="font-mono">
              {publicKey ? `${publicKey.slice(0, 6)}…${publicKey.slice(-6)}` : "your wallet"}
            </span>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {["Total Value", "24h Change", "Assets Held"].map((label) => (
              <div
                key={label}
                className="card bg-gradient-to-br from-white to-slate-50 dark:from-cosmos-800 dark:to-cosmos-900 border-stellar-500/20"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400 mb-1">
                  {label}
                </p>
                <div className="h-8 w-28 bg-slate-100 dark:bg-white/10 rounded animate-pulse" />
              </div>
            ))}
          </div>

          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Asset Allocation
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Connect your wallet to view your full portfolio breakdown.
            </p>
          </div>
        </div>
      </FeatureGate>
    </div>
  );
}

function ChartPieIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z"
      />
    </svg>
  );
}
