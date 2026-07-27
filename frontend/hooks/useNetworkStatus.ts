/**
 * hooks/useNetworkStatus.ts
 *
 * Wraps navigator.onLine with event listeners and exposes:
 *   - isOnline        current connectivity state
 *   - wasOffline      true if the user was offline at least once this session
 *   - lastOnlineAt    Date the device last had connectivity (persisted in localStorage)
 *
 * Also stores the beforeinstallprompt event so any component can later call
 * triggerInstallPrompt() to show the native install dialog.
 */

import { useState, useEffect, useCallback } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const LAST_ONLINE_KEY = "finchippay:lastOnlineAt";

function readLastOnlineAt(): Date | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_ONLINE_KEY);
    return raw ? new Date(raw) : null;
  } catch {
    return null;
  }
}

function writeLastOnlineAt(date: Date): void {
  try {
    localStorage.setItem(LAST_ONLINE_KEY, date.toISOString());
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

// Singleton deferred prompt — stored outside of React state so all hook
// instances share the same reference and we never miss the event.
let _deferredPrompt: BeforeInstallPromptEvent | null = null;

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(readLastOnlineAt);
  const [installPromptReady, setInstallPromptReady] = useState(false);

  // ── Online / offline listeners ──────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      const now = new Date();
      setIsOnline(true);
      setLastOnlineAt(now);
      writeLastOnlineAt(now);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    // Sync initial state
    if (navigator.onLine) {
      const now = new Date();
      setLastOnlineAt(now);
      writeLastOnlineAt(now);
    } else {
      setIsOnline(false);
      setWasOffline(true);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── beforeinstallprompt listener ────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      _deferredPrompt = e as BeforeInstallPromptEvent;
      setInstallPromptReady(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  // ── appinstalled listener ───────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleInstalled = () => {
      _deferredPrompt = null;
      setInstallPromptReady(false);
      // Emit an analytics event if gtag is available
      if (typeof window !== "undefined" && (window as any).gtag) {
        (window as any).gtag("event", "pwa_installed", {
          event_category: "pwa",
          event_label: "install_accepted",
        });
      }
    };

    window.addEventListener("appinstalled", handleInstalled);
    return () => window.removeEventListener("appinstalled", handleInstalled);
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────

  const triggerInstallPrompt = useCallback(async (): Promise<
    "accepted" | "dismissed" | "unavailable"
  > => {
    if (!_deferredPrompt) return "unavailable";

    await _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;

    if (outcome === "accepted") {
      _deferredPrompt = null;
      setInstallPromptReady(false);
    }

    // Track the outcome
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "pwa_install_prompt", {
        event_category: "pwa",
        event_label: outcome,
      });
    }

    return outcome;
  }, []);

  return {
    isOnline,
    wasOffline,
    lastOnlineAt,
    installPromptReady,
    triggerInstallPrompt,
  };
}
