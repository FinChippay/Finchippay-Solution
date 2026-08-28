/**
 * components/Navbar.tsx
 * Top navigation bar with theme toggle, network status, and wallet controls.
 */

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AccountSwitcher from "@/components/AccountSwitcher";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { NavStarIcon } from "@/components/icons";
import { logger } from "@/lib/logger";
import { getQueueCount, processQueue, registerBackgroundSync } from "@/lib/offlineQueue";
import { loadAlerts, PRICE_ALERTS_STORAGE_KEY } from "@/lib/priceAlerts";
import {
  getNetworkConfig,
  fetchNetworkFeeStats,
  type FeeLevel,
} from "@/lib/stellar";
import { useWallet } from "@/lib/useWallet";
import {
  connectWallet as requestWalletConnection,
  performSEP0010Auth,
} from "@/lib/wallet";

/** Prop interface allowing _app.tsx to wire the tour launcher. */
export interface NavbarProps {
  onTakeTour?: () => void;
}

export default function Navbar({ onTakeTour }: NavbarProps) {
  const router = useRouter();
  const { publicKey, connectWallet } = useWallet();
  const { t } = useTranslation("common");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [feeLevel, setFeeLevel] = useState<FeeLevel | null>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  // Close mobile menu on Escape and return focus to the toggle button.
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobileMenuOpen]);

  // ── Price alert badge ────────────────────────────────────────────────────
  /** Number of recently triggered (≤ 24 h) price alerts shown as a badge. */
  const [alertBadgeCount, setAlertBadgeCount] = useState(0);

  useEffect(() => {
    const updateBadge = () => {
      const alerts = loadAlerts();
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // last 24 hours
      const recentlyTriggered = alerts.filter(
        (a) =>
          !a.active &&
          a.triggeredAt !== null &&
          new Date(a.triggeredAt).getTime() > cutoff
      ).length;
      setAlertBadgeCount(recentlyTriggered);
    };

    updateBadge();

    // Re-evaluate whenever localStorage is written from another component.
    const handleStorage = (e: StorageEvent) => {
      if (e.key === PRICE_ALERTS_STORAGE_KEY) updateBadge();
    };
    window.addEventListener("storage", handleStorage);

    // Also poll every 30 s in case the event doesn't fire in the same tab.
    const intervalId = window.setInterval(updateBadge, 30_000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(intervalId);
    };
  }, []);

  // ── Offline queue badge ──────────────────────────────────────────────────
  /** Number of transactions waiting to be submitted while offline. */
  const [queueBadgeCount, setQueueBadgeCount] = useState(0);

  useEffect(() => {
    const refreshCount = async () => {
      try {
        setQueueBadgeCount(await getQueueCount());
      } catch {
        // IndexedDB unavailable — keep previous value.
      }
    };

    void refreshCount();

    // Re-check every 30 s (matches the price-alert polling interval).
    const intervalId = window.setInterval(() => void refreshCount(), 30_000);

    // Also update immediately when the service worker finishes processing.
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "QUEUE_PROCESSED") {
        void refreshCount();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    return () => {
      window.clearInterval(intervalId);
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
    };
  }, []);

  const handleQueueRetry = async () => {
    try {
      await registerBackgroundSync();
    } catch {
      void processQueue();
    }
    try {
      setQueueBadgeCount(await getQueueCount());
    } catch { /* ignore */ }
  };

  const config = getNetworkConfig();
  const isMainnet = config.network === "mainnet";
  const networkLabel =
    config.network === "custom" ? "Custom" : isMainnet ? "Mainnet" : "Testnet";

  const navLinks = [
    { href: "/", label: t("nav.home") },
    { href: "/dashboard", label: t("nav.dashboard") },
    { href: "/portfolio", label: t("nav.portfolio") },
    { href: "/trade", label: t("nav.trade") },
    { href: "/transactions", label: t("nav.transactions") },
    { href: "/network", label: t("nav.network") },
    { href: "/settings", label: t("nav.settings") },
  ];
  const networkBadgeClassName =
    config.network === "custom"
      ? "border-purple-500/35 bg-purple-100 text-purple-700 dark:border-purple-400/35 dark:bg-purple-400/10 dark:text-purple-300"
      : isMainnet
        ? "border-emerald-500/35 bg-emerald-100 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-400/10 dark:text-emerald-300"
        : "border-amber-500/35 bg-amber-100 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-300";

  useEffect(() => {
    let cancelled = false;

    const loadFeeLevel = async () => {
      try {
        const stats = await fetchNetworkFeeStats();
        if (!cancelled) {
          setFeeLevel(stats.feeLevel);
        }
      } catch {
        // If fee stats fail, the status dot simply stays hidden.
      }
    };

    void loadFeeLevel();
    const intervalId = window.setInterval(() => void loadFeeLevel(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  // Close help menu when clicking outside or pressing Escape.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        helpMenuRef.current &&
        !helpMenuRef.current.contains(event.target as Node)
      ) {
        setIsHelpMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHelpMenuOpen(false);
        helpMenuRef.current?.querySelector("button")?.focus();
      }
    };

    if (isHelpMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHelpMenuOpen]);

  const handleConnectClick = async () => {
    const { publicKey: nextPublicKey, error: walletError } =
      await requestWalletConnection();

    if (!nextPublicKey) {
      if (walletError) {
        logger.error("Wallet connection error", {}, new Error(String(walletError)));
      }
      return;
    }

    const { error: authError } = await performSEP0010Auth(nextPublicKey);
    if (authError) {
      logger.error("Auth error", {}, new Error(String(authError)));
      return;
    }

    connectWallet(nextPublicKey);
  };

  const handleTakeTour = () => {
    setIsHelpMenuOpen(false);
    setIsMobileMenuOpen(false);
    onTakeTour?.();
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--color-accent-border)] bg-[var(--color-bg-surface)]/80 backdrop-blur-xl transition-colors duration-300">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="group flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-stellar-500/30 bg-stellar-500/20 transition-colors group-hover:border-stellar-500/60">
              <NavStarIcon className="h-4 w-4 text-stellar-400" />
            </div>
            <span className="font-display font-semibold tracking-tight text-slate-900 dark:text-white">
              Stellar<span className="text-stellar-400">Finchippay</span>
            </span>
          </Link>

          <span
            className={clsx(
              "hidden items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide md:inline-flex",
              networkBadgeClassName
            )}
          >
            {networkLabel}
          </span>

          {feeLevel && (
            <span
              title={`Network: ${feeLevel.charAt(0).toUpperCase()}${feeLevel.slice(1)}`}
              aria-label={`Network fee status: ${feeLevel}`}
              className={clsx(
                "hidden h-2.5 w-2.5 rounded-full border transition-colors md:inline-block",
                feeLevel === "normal" && "border-emerald-400/50 bg-emerald-400",
                feeLevel === "elevated" && "border-amber-400/50 bg-amber-400",
                feeLevel === "high" && "border-red-400/50 bg-red-400"
              )}
            />
          )}

          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={router.pathname === link.href ? "page" : undefined}
                className={clsx(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150",
                  router.pathname === link.href
                    ? "bg-stellar-100 text-stellar-700 dark:bg-stellar-500/15 dark:text-stellar-300"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />

          {/* ── Price alert bell badge ── */}
          <Link
            href="/dashboard"
            aria-label={
              alertBadgeCount > 0
                ? `${alertBadgeCount} price alert${alertBadgeCount > 1 ? "s" : ""} triggered`
                : "Price alerts"
            }
            className="relative flex items-center justify-center rounded-lg p-2 text-slate-500 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
            data-testid="price-alerts-bell"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            {alertBadgeCount > 0 && (
              <span
                className="absolute top-0.5 right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none"
                aria-hidden="true"
                data-testid="price-alerts-badge"
              >
                {alertBadgeCount > 9 ? "9+" : alertBadgeCount}
              </span>
            )}
          </Link>

          {/* ── Offline queue badge ── */}
          {queueBadgeCount > 0 && (
            <button
              onClick={() => void handleQueueRetry()}
              title={`${queueBadgeCount} transaction${queueBadgeCount > 1 ? "s" : ""} queued offline — click to retry`}
              aria-label={`${queueBadgeCount} queued offline transaction${queueBadgeCount > 1 ? "s" : ""}. Click to retry submission.`}
              className="relative flex items-center justify-center rounded-lg p-2 text-amber-500 transition-all duration-150 hover:bg-amber-50 hover:text-amber-600 dark:text-amber-400 dark:hover:bg-amber-400/10"
              data-testid="offline-queue-badge-btn"
            >
              {/* Cloud-upload icon */}
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <span
                className="absolute top-0.5 right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white leading-none"
                aria-hidden="true"
                data-testid="offline-queue-badge"
              >
                {queueBadgeCount > 9 ? "9+" : queueBadgeCount}
              </span>
            </button>
          )}

          {/* ── Help menu (contains "Take a Tour") ── */}
          <div className="relative hidden md:block" ref={helpMenuRef}>
            <button
              onClick={() => setIsHelpMenuOpen(!isHelpMenuOpen)}
              aria-haspopup="true"
              aria-expanded={isHelpMenuOpen}
              aria-label="Help menu"
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
              data-testid="help-menu-button"
            >
              {/* Question-mark circle icon */}
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>Help</span>
            </button>

            {isHelpMenuOpen && (
              <div
                role="menu"
                aria-label="Help options"
                className="absolute right-0 top-full mt-1 min-w-[160px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-cosmos-700 dark:bg-cosmos-800"
                data-testid="help-menu-dropdown"
              >
                <button
                  role="menuitem"
                  onClick={handleTakeTour}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-cosmos-700"
                  data-testid="take-a-tour-btn"
                >
                  {/* Map-pin / compass icon */}
                  <svg
                    className="h-4 w-4 text-stellar-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                    />
                  </svg>
                  Take a Tour
                </button>
              </div>
            )}
          </div>

          {publicKey ? (
            <div className="flex items-center gap-2">
              <kbd
                title={t("nav.switchAccountShortcut")}
                className="hidden select-none items-center gap-1 rounded-md border border-stellar-500/20 bg-stellar-500/5 px-2 py-1 font-mono text-xs text-stellar-700 dark:text-stellar-400 md:inline-flex"
              >
                {t("nav.quickSend")}
              </kbd>

              <AccountSwitcher />
            </div>
          ) : (
            <button
              onClick={handleConnectClick}
              className="btn-primary px-4 py-2 text-sm"
              data-tour="wallet-connect"
            >
              {t("nav.connectWallet")}
            </button>
          )}

          {/* Hamburger Menu Toggle */}
          <button
            ref={mobileMenuButtonRef}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-cosmos-800 dark:hover:text-slate-200 md:hidden"
            aria-label="Toggle mobile menu"
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-nav-menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              {isMobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div
          id="mobile-nav-menu"
          role="navigation"
          aria-label="Mobile"
          className="absolute left-0 right-0 top-full border-b border-[var(--color-accent-border)] bg-[var(--color-bg-surface)] p-4 shadow-lg md:hidden"
        >
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={router.pathname === link.href ? "page" : undefined}
                onClick={() => setIsMobileMenuOpen(false)}
                className="block min-h-[44px] rounded-lg px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-cosmos-800"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-cosmos-800">
              <div className="mb-2 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Network: {networkLabel}
              </div>
              {/* Take a Tour — mobile */}
              <button
                onClick={handleTakeTour}
                className="flex w-full min-h-[44px] items-center gap-2 rounded-lg px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-cosmos-800"
                data-testid="take-a-tour-mobile-btn"
              >
                <svg
                  className="h-4 w-4 text-stellar-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
                Take a Tour
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
