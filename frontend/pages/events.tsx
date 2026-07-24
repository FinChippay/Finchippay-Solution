/**
 * pages/events.tsx
 * On-chain event feed — contract activity log for streams, escrows, tips, and multi-sig.
 *
 * Gated behind the "events_page" feature flag (#103).
 * Renders a "coming soon" fallback when the flag is off.
 */

import Head from "next/head";
import { FeatureGate } from "@/lib/FeatureFlags";
import Link from "next/link";

export default function EventsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <Head>
        <title>Events | Finchippay</title>
        <meta
          name="description"
          content="On-chain event feed for Finchippay contract activity — streams, escrows, tips, and multi-sig proposals."
        />
      </Head>

      <FeatureGate
        flag="events_page"
        fallback={
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-6">
              <BoltIcon className="w-8 h-8 text-violet-500" />
            </div>
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">
              Events — Coming Soon
            </h1>
            <p className="text-slate-600 dark:text-slate-400 max-w-md mb-6">
              The on-chain event feed is currently in limited preview. It will
              show real-time contract activity for streams, escrows, tips, and
              multi-sig proposals once it launches.
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
        {/* ── Feature content (rendered when events_page flag is on) ── */}
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-1">
            On-Chain Events
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-8">
            Real-time contract activity feed
          </p>

          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Recent Events
            </h2>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-slate-50 dark:bg-white/5 rounded-lg animate-pulse"
                />
              ))}
            </div>
          </div>
        </div>
      </FeatureGate>
    </div>
  );
}

function BoltIcon({ className }: { className?: string }) {
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
        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
      />
    </svg>
  );
}
