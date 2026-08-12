/**
 * components/PushNotificationPrompt.tsx
 * Opt-in prompt for Web Push notifications.
 *
 * Shown once a wallet is connected and only while the browser permission is
 * still undecided. "Not Now" suppresses it for two weeks rather than for the
 * session, because a permission prompt the user already declined is the kind of
 * thing that gets an app's notifications blocked outright.
 */

import { useCallback, useEffect, useState } from "react";
import {
  dismissPrompt,
  getVapidPublicKey,
  requestPermission,
  setOptIn,
  shouldShowPrompt,
} from "@/lib/pushNotifications";
import { useToast } from "@/lib/useToast";

interface PushNotificationPromptProps {
  /** Connected account. The prompt stays hidden until this is available. */
  publicKey?: string | null;
  /** Called after the user enables or dismisses, for parent-side bookkeeping. */
  onResolved?: (enabled: boolean) => void;
}

export function PushNotificationPrompt({
  publicKey,
  onResolved,
}: PushNotificationPromptProps) {
  const { showToast } = useToast();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Deciding visibility needs localStorage and Notification.permission, so it
  // runs after mount: computing it during render would not match the server
  // HTML and would trip a hydration warning.
  useEffect(() => {
    if (!publicKey) {
      setVisible(false);
      return;
    }

    let cancelled = false;

    const decide = async () => {
      if (!shouldShowPrompt()) return;

      // Do not ask for a permission the backend cannot act on: with no VAPID
      // key there is nothing to deliver a push.
      const vapidKey = await getVapidPublicKey();
      if (!cancelled && vapidKey) setVisible(true);
    };

    decide();

    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const handleEnable = useCallback(async () => {
    if (!publicKey) return;

    setBusy(true);
    try {
      const { permission, subscribed } = await requestPermission(publicKey);

      if (permission === "granted") {
        setOptIn(true);
        setVisible(false);
        onResolved?.(true);
        showToast(
          subscribed
            ? "Notifications enabled"
            : "Notifications allowed, but this device could not be registered yet.",
          subscribed ? "success" : "info",
        );
        return;
      }

      // Denied is final until the user changes it in browser settings, so stop
      // showing the prompt rather than asking again on the next visit.
      dismissPrompt();
      setVisible(false);
      onResolved?.(false);
      showToast(
        permission === "denied"
          ? "Notifications are blocked. You can allow them in your browser settings."
          : "Notifications were not enabled.",
        "info",
      );
    } catch {
      showToast("Could not enable notifications. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }, [publicKey, onResolved, showToast]);

  const handleDismiss = useCallback(() => {
    dismissPrompt();
    setVisible(false);
    onResolved?.(false);
  }, [onResolved]);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Enable push notifications"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Get notified when you receive payments
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            We&apos;ll alert you about incoming payments, claimable streams, and
            escrows that unlock — even when Finchippay is closed.
          </p>
        </div>

        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={busy}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Not Now
          </button>
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Enabling…" : "Enable"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PushNotificationPrompt;
