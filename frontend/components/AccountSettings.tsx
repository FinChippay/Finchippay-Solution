/**
 * components/AccountSettings.tsx
 * Settings panel for naming, switching, and removing connected accounts (#147).
 */

import { useState } from "react";
import { shortenAddress } from "@/lib/stellar";
import { getAccountDisplayName, useWallet } from "@/lib/useWallet";
import { CheckIcon, PencilIcon, TrashIcon } from "@/components/icons";

export default function AccountSettings() {
  const {
    accounts,
    activeAccountIndex,
    setActiveAccount,
    setAccountLabel,
    addAccount,
    removeAccount,
  } = useWallet();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = (publicKey: string, currentLabel?: string) => {
    setEditingKey(publicKey);
    setDraftLabel(currentLabel ?? "");
  };

  const commitLabel = (publicKey: string) => {
    setAccountLabel(publicKey, draftLabel);
    setEditingKey(null);
    setDraftLabel("");
  };

  const handleAddAccount = async () => {
    setIsAdding(true);
    setError(null);
    const { error: addError } = await addAccount();
    setIsAdding(false);
    if (addError) setError(addError);
  };

  return (
    <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
        Accounts
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Name your connected accounts so they are easy to tell apart in the account
        switcher. Press Ctrl+K (Cmd+K) anywhere to switch accounts.
      </p>

      {accounts.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No accounts connected yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account, index) => {
            const isActive = index === activeAccountIndex;
            const isEditing = editingKey === account.publicKey;

            return (
              <li
                key={account.publicKey}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
                  isActive
                    ? "border-stellar-500 bg-stellar-500/5"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={draftLabel}
                      maxLength={40}
                      onChange={(event) => setDraftLabel(event.target.value)}
                      onBlur={() => commitLabel(account.publicKey)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitLabel(account.publicKey);
                        if (event.key === "Escape") setEditingKey(null);
                      }}
                      aria-label={`Label for ${shortenAddress(account.publicKey)}`}
                      placeholder="e.g. Business"
                      className="w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:text-white"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900 dark:text-white">
                        {getAccountDisplayName(account, index)}
                      </span>
                      {account.isPrimary && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          Primary
                        </span>
                      )}
                    </div>
                  )}
                  <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {shortenAddress(account.publicKey)}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEditing(account.publicKey, account.label)}
                      aria-label={`Rename ${getAccountDisplayName(account, index)}`}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                  )}

                  {isActive ? (
                    <span className="flex items-center gap-1 px-2 text-xs font-medium text-stellar-600 dark:text-stellar-300">
                      <CheckIcon className="h-4 w-4" />
                      Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveAccount(index)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-stellar-700 hover:bg-stellar-500/10 dark:text-stellar-300"
                    >
                      Make active
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => removeAccount(account.publicKey)}
                    aria-label={`Remove ${getAccountDisplayName(account, index)}`}
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleAddAccount}
        disabled={isAdding}
        className="btn-secondary mt-4 w-full px-4 py-2 text-sm disabled:opacity-60"
      >
        {isAdding ? "Waiting for Freighter..." : "Add Account"}
      </button>
    </div>
  );
}
