/**
 * components/Navbar.tsx
 * Top navigation bar with theme toggle, network status, and wallet controls.
 */

import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import {
  getNetworkConfig,
  fetchNetworkFeeStats,
  type FeeLevel,
} from "@/lib/stellar";
import {
  connectWallet as requestWalletConnection,
  performSEP0010Auth,
} from "@/lib/wallet";
import { useWallet } from "@/lib/useWallet";
import ThemeToggle from "@/components/ThemeToggle";
import AccountSwitcher from "@/components/AccountSwitcher";
import { NavStarIcon } from "@/components/icons";

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

  const config = getNetworkConfig();
  const isMainnet = config.network === "mainnet";
  const networkLabel =
    config.network === "custom" ? "Custom" : isMainnet ? "Mainnet" : "Testnet";

  const navLinks = [
    { href: "/", label: t("nav.home") },
    { href: "/dashboard", label: t("nav.dashboard") },
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

  // Close help menu when clicking outside.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        helpMenuRef.current &&
        !helpMenuRef.current.contains(event.target as Node)
      ) {
        setIsHelpMenuOpen(false);
      }
    };

    if (isHelpMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isHelpMenuOpen]);

  const handleConnectClick = async () => {
    const { publicKey: nextPublicKey, error: walletError } =
      await requestWalletConnection();

    if (!nextPublicKey) {
      if (walletError) {
        console.error(walletError);
      }
      return;
    }

    const { error: authError } = await performSEP0010Auth(nextPublicKey);
    if (authError) {
      console.error(authError);
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
    <nav className="sticky top-0 z-50 border-b border-[rgba(14,165,233,0.12)] bg-white/80 backdrop-blur-xl transition-colors duration-300 dark:bg-cosmos-900/80">
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
          <ThemeToggle />

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
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-cosmos-800 dark:hover:text-slate-200 md:hidden"
            aria-label="Toggle mobile menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
        <div className="absolute left-0 right-0 top-full border-b border-[rgba(14,165,233,0.12)] bg-white p-4 shadow-lg dark:bg-cosmos-900 md:hidden">
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
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
