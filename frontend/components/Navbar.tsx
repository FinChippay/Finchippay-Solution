/**
 * components/Navbar.tsx
 * Top navigation bar with theme toggle, network status, and wallet controls.
 */

import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import {
  shortenAddress,
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
import { NavStarIcon } from "@/components/icons";

export default function Navbar() {
  const router = useRouter();
  const { publicKey, connectWallet, disconnectWallet } = useWallet();
  const { t } = useTranslation("common");
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [feeLevel, setFeeLevel] = useState<FeeLevel | null>(null);
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

  useEffect(() => {
    if (!showDisconnectConfirm) return;

    const timeoutId = window.setTimeout(() => {
      setShowDisconnectConfirm(false);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [showDisconnectConfirm]);

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

          {publicKey ? (
            <div className="flex items-center gap-2">
              <kbd
                title={t("nav.quickSend")}
                className="hidden select-none items-center gap-1 rounded-md border border-stellar-500/20 bg-stellar-500/5 px-2 py-1 font-mono text-xs text-stellar-700 dark:text-stellar-400 md:inline-flex"
              >
                {t("nav.quickSend")}
              </kbd>

              <div className="address-pill flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span>{shortenAddress(publicKey)}</span>
              </div>
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                aria-label="Show disconnect confirmation"
                className="px-2 py-1 text-xs text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300"
              >
                {t("nav.disconnect")}
              </button>
              {showDisconnectConfirm && (
                <div className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-100 px-2 py-1 dark:bg-amber-400/10">
                  <span className="text-[11px] text-amber-800 dark:text-amber-300">
                    {t("nav.disconnectConfirm")}
                  </span>
                  <button
                    onClick={() => {
                      setShowDisconnectConfirm(false);
                      disconnectWallet();
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-500/20 dark:text-red-300"
                  >
                    {t("nav.confirm")}
                  </button>
                  <button
                    onClick={() => setShowDisconnectConfirm(false)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    {t("nav.cancel")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={handleConnectClick} className="btn-primary px-4 py-2 text-sm">
              {t("nav.connectWallet")}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
