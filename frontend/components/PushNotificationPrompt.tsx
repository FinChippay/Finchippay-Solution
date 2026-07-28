/**
 * components/PushNotificationPrompt.tsx
 * Gentle prompt that asks users to enable push notifications after connecting
 * their wallet. Respects user choice and won't nag once dismissed.
 */

import { useState, useEffect } from "react";
import { requestPermission, subscribeUser, isSubscribed } from "@/lib/pushNotifications";

const DISMISSED_KEY = "finchippay:push-prompt-dismissed";

interface PushNotificationPromptProps {
  /** The connected wallet's Stellar public key. Pass null when disconnected. */
  publicKey: string | null;
}

export default function PushNotificationPrompt({
  publicKey,
}: PushNotificationPromptProps) {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setShow(false);
      return;
    }

    // Don't show if the browser doesn't support push or permission already decided
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    // Already granted or denied — no need to prompt
    if (
      Notification.permission === "granted" ||
      Notification.permission === "denied"
    ) {
      return;
    }

    // User previously dismissed the prompt
    if (localStorage.getItem(DISMISSED_KEY) === "true") return;

    // Show only if not already subscribed (async check)
    isSubscribed().then((subscribed) => {
      if (!subscribed) setShow(true);
    });
  }, [publicKey]);

  const handleEnable = async () => {
    if (!publicKey) return;
    setLoading(true);

    try {
      const permission = await requestPermission();
      if (permission !== "granted") {
        setShow(false);
        return;
      }
      await subscribeUser(publicKey);
    } catch (err) {
      console.error("[PushPrompt] Enable failed:", err);
    } finally {
      setLoading(false);
      setShow(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Enable push notifications"
      className="fixed bottom-20 left-4 right-4 z-40 animate-slide-up sm:bottom-6 sm:left-auto sm:right-6 sm:w-96"
    >
      <div className="rounded-xl border border-stellar-500/30 bg-white p-4 shadow-2xl backdrop-blur-sm dark:bg-cosmos-800 dark:shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          {/* Bell icon */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stellar-500/10">
            <svg
              className="h-5 w-5 text-stellar-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h3 className="mb-1 text-sm font-display font-semibold text-slate-900 dark:text-white">
              Stay in the loop
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Get notified when you receive payments, a stream is ready to
              claim, or an escrow unlocks — even when the app is closed.
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="shrink-0 cursor-pointer p-1 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Dismiss notification prompt"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleEnable}
            disabled={loading}
            className="btn-primary flex-1 px-4 py-2 text-xs disabled:opacity-60"
          >
            {loading ? "Enabling…" : "Enable Notifications"}
          </button>
          <button
            onClick={handleDismiss}
            className="btn-secondary flex-1 px-4 py-2 text-xs"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
