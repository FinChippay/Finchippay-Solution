/**
 * pages/offline.tsx
 * Offline fallback page (Issue #483) — served by the service worker when a
 * navigation can't reach the network. Matches the app's cosmos styling and
 * hosts the offline transaction composer so users can keep preparing payments.
 */

import Head from "next/head";
import Link from "next/link";
import OfflineTransactionComposer from "@/components/OfflineTransactionComposer";

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 animate-fade-in">
      <Head>
        <title>You&apos;re offline | Finchippay-Solution</title>
        <meta
          name="description"
          content="Finchippay-Solution is offline. Queue a transaction and it will be sent automatically when you reconnect."
        />
      </Head>

      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-stellar-500/3 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-amber-500/3 rounded-full blur-2xl" />
      </div>

      <div className="relative z-10 text-center mb-8">
        <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20">
          <svg
            className="h-7 w-7 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
            />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-2">
          You&apos;re offline
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          You can still compose a transaction below. It will be saved to this device and sent
          automatically once you&apos;re back online.
        </p>
      </div>

      <OfflineTransactionComposer />

      <div className="mt-6 flex items-center justify-center gap-4">
        <Link href="/" className="btn-primary text-sm px-6 py-2.5">
          Go Home →
        </Link>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-secondary text-sm px-6 py-2.5"
        >
          Check connection
        </button>
      </div>
    </div>
  );
}
