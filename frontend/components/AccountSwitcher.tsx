/**
 * components/AccountSwitcher.tsx
 * Navbar dropdown for switching between connected Stellar accounts (#147).
 *
 * Opens on click or with the Cmd+K / Ctrl+K shortcut, lists every connected
 * account with its label and truncated public key, and offers "Add account"
 * plus "Remove account" (with confirmation when it is the last one).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { shortenAddress } from "@/lib/stellar";
import { getAccountDisplayName, useWallet } from "@/lib/useWallet";
import { CheckIcon, Spinner, TrashIcon, WalletIcon } from "@/components/icons";

export default function AccountSwitcher() {
  const {
    accounts,
    activeAccountIndex,
    activeAccount,
    setActiveAccount,
    addAccount,
    removeAccount,
  } = useWallet();
  const { t } = useTranslation("common");

  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setPendingRemoval(null);
    setError(null);
  }, []);

  // Cmd+K / Ctrl+K toggles the switcher from anywhere in the app.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsOpen((open) => !open);
        return;
      }

      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, close]);

  const handleAddAccount = async () => {
    setIsAdding(true);
    setError(null);

    const { error: addError } = await addAccount();

    setIsAdding(false);
    if (addError) {
      setError(addError);
      return;
    }
    close();
  };

  const handleRemove = (publicKey: string) => {
    // Removing the only account disconnects the wallet, so make it deliberate.
    if (accounts.length === 1 && pendingRemoval !== publicKey) {
      setPendingRemoval(publicKey);
      return;
    }

    removeAccount(publicKey);
    close();
  };

  if (!activeAccount) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t("nav.switchAccount")}
        className="address-pill flex items-center gap-2"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        <span className="max-w-[10rem] truncate">
          {getAccountDisplayName(activeAccount, activeAccountIndex)}
        </span>
        <span className="hidden font-mono text-xs opacity-70 sm:inline">
          {shortenAddress(activeAccount.publicKey)}
        </span>
        <svg
          className={clsx("h-3 w-3 transition-transform", isOpen && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={t("nav.accounts")}
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-cosmos-800"
        >
          <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("nav.accounts")}
          </div>

          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {accounts.map((account, index) => {
              const isActive = index === activeAccountIndex;

              return (
                <li key={account.publicKey} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveAccount(index);
                      close();
                    }}
                    className={clsx(
                      "flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-stellar-100 text-stellar-700 dark:bg-stellar-500/15 dark:text-stellar-300"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                    )}
                  >
                    <WalletIcon className="h-4 w-4 flex-shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {getAccountDisplayName(account, index)}
                        {account.isPrimary && (
                          <span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">
                            {t("nav.primary")}
                          </span>
                        )}
                      </span>
                      <span className="block truncate font-mono text-xs opacity-70">
                        {shortenAddress(account.publicKey)}
                      </span>
                    </span>
                    {isActive && <CheckIcon className="h-4 w-4 flex-shrink-0" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRemove(account.publicKey)}
                    aria-label={`${t("nav.removeAccount")}: ${getAccountDisplayName(account, index)}`}
                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-500 dark:text-slate-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          {pendingRemoval && (
            <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-100 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
              {t("nav.removeLastAccountWarning")}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
              {error}
            </p>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleAddAccount}
            disabled={isAdding}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-stellar-500/30 px-2 py-2 text-sm font-medium text-stellar-700 transition-colors hover:bg-stellar-500/10 disabled:opacity-60 dark:text-stellar-300"
          >
            {isAdding ? <Spinner className="h-4 w-4" /> : <span aria-hidden="true">+</span>}
            {t("nav.addAccount")}
          </button>

          <p className="mt-2 px-2 pb-1 text-center text-[11px] text-slate-500 dark:text-slate-400">
            {t("nav.switchAccountShortcut")}
          </p>
        </div>
      )}
    </div>
  );
}
