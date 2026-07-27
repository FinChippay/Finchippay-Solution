/**
 * components/InstallPrompt.tsx
 *
 * Custom PWA install prompt that:
 *   - Tracks page visits in localStorage and only appears after 3+ visits
 *   - Surfaces a dismissible card with clear benefits messaging
 *   - Triggers the native browser install dialog on "Install"
 *   - Tracks installation events for analytics
 *   - Respects "Not Now" / permanent dismiss preferences
 */

import { useState, useEffect } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

// ─── Constants ────────────────────────────────────────────────────────────────

const VISIT_COUNT_KEY = "finchippay:visitCount";
const DISMISSED_KEY = "finchippay:installDismissed";
const MIN_VISITS = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVisitCount(): number {
  if (typeof localStorage === "undefined") return 0;
  return parseInt(localStorage.getItem(VISIT_COUNT_KEY) ?? "0", 10);
}

function incrementVisitCount(): number {
  const next = getVisitCount() + 1;
  try {
    localStorage.setItem(VISIT_COUNT_KEY, String(next));
  } catch {
    // Ignore localStorage errors
  }
  return next;
}

function setDismissed(permanently: boolean): void {
  try {
    localStorage.setItem(
      DISMISSED_KEY,
      JSON.stringify({ dismissed: true, permanent: permanently, at: new Date().toISOString() })
    );
  } catch {
    // Ignore
  }
}

function isDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { dismissed: boolean; permanent: boolean; at: string };
    if (parsed.permanent) return true;

    // Temporary dismiss expires after 3 days
    const dismissedAt = new Date(parsed.at).getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < threeDaysMs;
  } catch {
    return false;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InstallPrompt() {
  const { installPromptReady, triggerInstallPrompt } = useNetworkStatus();
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Skip if already installed (standalone display mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Skip if dismissed
    if (isDismissed()) return;

    // Increment visit counter
    const visits = incrementVisitCount();

    // Only show after MIN_VISITS
    if (visits >= MIN_VISITS && installPromptReady) {
      setVisible(true);
    }
  }, [installPromptReady]);

  // Re-check visibility when the prompt becomes available
  useEffect(() => {
    if (!installPromptReady || !visible) return;
    if (isDismissed()) return;
    if (getVisitCount() >= MIN_VISITS) {
      setVisible(true);
    }
  }, [installPromptReady, visible]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const outcome = await triggerInstallPrompt();
      if (outcome === "accepted") {
        // Track successful install
        if (typeof window !== "undefined" && (window as any).gtag) {
          (window as any).gtag("event", "pwa_install_accepted", {
            event_category: "pwa",
          });
        }
        setVisible(false);
      } else if (outcome === "dismissed") {
        setDismissed(false);
        setVisible(false);
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleDismiss = (permanent = false) => {
    setDismissed(permanent);
    setVisible(false);
  };

  if (!visible || !installPromptReady) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-96 animate-slide-up"
      role="dialog"
      aria-label="Install Finchippay app"
      aria-modal="true"
    >
      <div className="rounded-xl border border-stellar-500/30 bg-white dark:bg-cosmos-800 p-4 shadow-2xl backdrop-blur-sm ring-1 ring-black/5">
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* App icon placeholder */}
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-gradient-to-br from-stellar-500 to-purple-600 flex items-center justify-center shadow-md">
            <svg
              className="h-6 w-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">
              Install Finchippay
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Add to your home screen for the best experience
            </p>
          </div>

          <button
            onClick={() => handleDismiss(false)}
            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-md hover:bg-slate-100 dark:hover:bg-cosmos-700"
            aria-label="Dismiss install prompt"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Benefits */}
        <ul className="mt-3 space-y-1.5" aria-label="App benefits">
          {[
            { icon: "⚡", text: "Faster access — no browser chrome" },
            { icon: "📴", text: "Offline payments with action queuing" },
            { icon: "🔔", text: "Push notifications for payments" },
          ].map(({ icon, text }) => (
            <li key={text} className="flex items-center gap-2">
              <span className="text-sm" aria-hidden="true">{icon}</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">{text}</span>
            </li>
          ))}
        </ul>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex-1 rounded-lg bg-stellar-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-stellar-600 focus:outline-none focus:ring-2 focus:ring-stellar-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed dark:focus:ring-offset-cosmos-800"
          >
            {installing ? (
              <span className="flex items-center justify-center gap-1.5">
                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                Installing…
              </span>
            ) : (
              "Install App"
            )}
          </button>

          <button
            onClick={() => handleDismiss(false)}
            className="flex-1 rounded-lg border border-slate-200 dark:border-cosmos-600 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-cosmos-700 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 dark:focus:ring-offset-cosmos-800"
          >
            Not Now
          </button>
        </div>

        {/* Permanent dismiss */}
        <button
          onClick={() => handleDismiss(true)}
          className="mt-2 block w-full text-center text-xs text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
          aria-label="Don't show this again"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  );
}
