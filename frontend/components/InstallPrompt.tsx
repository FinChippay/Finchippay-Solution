"use client";

import { useEffect, useState } from "react";

const VISIT_COUNT_KEY = "finchippay:pwa-visit-count";
const PROMPT_DISMISSED_KEY = "finchippay:pwa-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Simple analytics – uses Plausible if available (matches lib/onboardingState.ts convention). */
function trackInstallEvent(event: string) {
  if (typeof window !== "undefined" && (window as unknown as { plausible?: (e: string, o?: { props?: Record<string, unknown> }) => void }).plausible) {
    (window as unknown as { plausible: (e: string, o?: { props?: Record<string, unknown> }) => void }).plausible(`pwa_install_${event}`);
  }
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [canShow, setCanShow] = useState(false);

  useEffect(() => {
    const visits = Number.parseInt(localStorage.getItem(VISIT_COUNT_KEY) ?? "0", 10) || 0;
    const nextVisits = visits + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(nextVisits));
    const eligible = nextVisits >= 3 && localStorage.getItem(PROMPT_DISMISSED_KEY) !== "1";
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      trackInstallEvent("available");
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setCanShow(false);
      trackInstallEvent("installed");
    };
    setCanShow(eligible);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, "1");
    setCanShow(false);
    trackInstallEvent("dismissed");
  };
  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    trackInstallEvent(outcome === "accepted" ? "accepted" : "dismissed-native");
    setDeferredPrompt(null);
    if (outcome === "accepted") setCanShow(false);
  };

  if (!canShow || !deferredPrompt) return null;
  return <aside className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up sm:left-auto sm:w-96" role="dialog" aria-label="Install Finchippay"><div className="rounded-xl border border-stellar-500/30 bg-slate-900 p-4 shadow-2xl"><h2 className="text-sm font-semibold text-white">Install Finchippay</h2><p className="mt-1 text-xs text-slate-300">Install for faster access, offline payments, and push notifications.</p><div className="mt-3 flex gap-2"><button onClick={() => void install()} className="flex-1 rounded-lg bg-stellar-500 py-2 text-xs font-semibold text-white">Install</button><button onClick={dismiss} className="flex-1 rounded-lg border border-white/10 py-2 text-xs text-slate-300">Not now</button></div></div></aside>;
}
