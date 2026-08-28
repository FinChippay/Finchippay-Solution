import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import EscrowCountdown from "@/components/EscrowCountdown";
import MilestoneProgress from "@/components/MilestoneProgress";
import type { Milestone } from "@/components/MilestoneProgress";
import WalletConnect from "@/components/WalletConnect";
import {
  getEscrows,
  claimEscrow,
  cancelEscrow,
  categorizeEscrows,
  sortEscrows,
  filterEscrows,
  clearEscrowCache,
  type EscrowRecord,
  type EscrowTab,
} from "@/lib/escrowManager";
import { getCurrentLedger, CONTRACT_ID, STELLAR_STROOPS_PER_XLM } from "@/lib/stellar";
import { useToast } from "@/lib/useToast";
import { useWallet } from "@/lib/useWallet";
import { copyToClipboard } from "@/utils/format";

function stroopsToXlm(stroops: string): string {
  const num = Number(BigInt(stroops)) / STELLAR_STROOPS_PER_XLM;
  return num.toFixed(7);
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function statusBadgeClass(status: EscrowRecord["status"]): string {
  switch (status) {
    case "Pending": return "bg-amber-500/10 text-amber-300 border-amber-500/20";
    case "Released": return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "Cancelled": return "bg-rose-500/10 text-rose-300 border-rose-500/20";
  }
}

export default function EscrowManage() {
  const { publicKey } = useWallet();
  const { showToast } = useToast();

  const [escrows, setEscrows] = useState<EscrowRecord[]>([]);
  const [currentLedger, setCurrentLedger] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<EscrowTab>("active");
  const [sortBy, setSortBy] = useState<"time-remaining" | "amount-desc" | "date-created">("time-remaining");
  const [searchQuery, setSearchQuery] = useState("");

  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const refresh = useCallback(async (forceRefresh = false) => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const [escrowList, ledger] = await Promise.all([
        getEscrows(publicKey, forceRefresh),
        getCurrentLedger(),
      ]);
      setEscrows(escrowList);
      setCurrentLedger(ledger);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load escrows");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const categorized = categorizeEscrows(escrows, publicKey || "");
  const tabEscrows = (() => {
    const source = activeTab === "active" ? categorized.active
      : activeTab === "completed" ? categorized.completed
      : categorized.incoming;
    const sorted = sortEscrows(source, sortBy);
    return filterEscrows(sorted, searchQuery);
  })();

  const handleClaim = async (id: number) => {
    if (!publicKey) return;
    setActionLoading(id);
    try {
      const result = await claimEscrow(publicKey, id);
      showToast(`Escrow #${id} claimed (${result})`);
      await refresh(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: number) => {
    if (!publicKey) return;
    setActionLoading(id);
    try {
      const result = await cancelEscrow(publicKey, id);
      showToast(`Escrow #${id} cancelled (${result})`);
      setCancelConfirmId(null);
      setCancelReason("");
      await refresh(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopy = (addr: string) => {
    copyToClipboard(addr);
    showToast("Address copied");
  };

  const isSender = (escrow: EscrowRecord) => publicKey === escrow.from;
  const isRecipient = (escrow: EscrowRecord) => publicKey === escrow.to;
  const canClaim = (escrow: EscrowRecord) =>
    escrow.status === "Pending" && isRecipient(escrow) && currentLedger >= escrow.releaseLedger;
  const canCancel = (escrow: EscrowRecord) =>
    escrow.status === "Pending" && isSender(escrow) && currentLedger < escrow.releaseLedger;

  const tabs: { key: EscrowTab; label: string; count: number }[] = [
    { key: "active", label: "Active", count: categorized.active.length },
    { key: "completed", label: "Completed", count: categorized.completed.length },
    { key: "incoming", label: "Incoming", count: categorized.incoming.length },
  ];

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <Head>
          <title>Escrow Dashboard | Finchippay-Solution</title>
          <meta name="description" content="Manage your escrows — active, pending, and completed." />
        </Head>
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">Escrow Dashboard</h1>
          <p className="text-slate-600 dark:text-slate-400">Connect your wallet to manage escrows</p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <Head>
        <title>Escrow Dashboard | Finchippay-Solution</title>
        <meta name="description" content="Comprehensive escrow management dashboard with real-time status and countdown timers." />
      </Head>

      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-1">Escrow Dashboard</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Current ledger: <span className="font-mono">{currentLedger.toLocaleString()}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refresh(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Refresh
            </button>
            <Link
              href="/escrow"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-stellar-700 dark:text-stellar-300 bg-stellar-50 dark:bg-stellar-500/10 border border-stellar-500/20 hover:bg-stellar-500/20 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Escrow
            </Link>
          </div>
        </div>

        {!CONTRACT_ID && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-sm text-amber-200">
              <strong>NEXT_PUBLIC_CONTRACT_ID</strong> is not configured. Escrow calls will fail until a deployed contract ID is wired in.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <p className="text-sm text-rose-200">{error}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl bg-white/5 border border-white/10 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-stellar-500/20 text-stellar-300 border border-stellar-500/30"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-white/10">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search & Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.5 5.5a7.5 7.5 0 0010.5 10.5z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by counterparty address or escrow ID..."
            className="w-full pl-10 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
        >
          <option value="time-remaining">Time Remaining</option>
          <option value="amount-desc">Amount (High to Low)</option>
          <option value="date-created">Date Created</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-16">
          <svg className="animate-spin w-8 h-8 mx-auto text-stellar-400 mb-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-400">Loading escrows...</p>
        </div>
      )}

      {/* Escrow list */}
      {!loading && tabEscrows.length === 0 && (
        <div className="card text-center py-16">
          <svg className="w-12 h-12 mx-auto mb-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <p className="text-slate-400">No escrows found in this view.</p>
          {activeTab !== "active" && (
            <button onClick={() => setActiveTab("active")} className="mt-3 text-sm text-stellar-400 hover:text-stellar-300 transition-colors">
              View active escrows
            </button>
          )}
        </div>
      )}

      {!loading && tabEscrows.length > 0 && (
        <div className="space-y-3">
          {tabEscrows.map((escrow) => (
            <div
              key={escrow.id}
              className="card-hover p-4 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/30 transition-all"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                {/* Left: Escrow info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-lg font-bold text-white">#{escrow.id}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusBadgeClass(escrow.status)}`}>
                      {escrow.status}
                    </span>
                    <EscrowCountdown releaseLedger={escrow.releaseLedger} currentLedger={currentLedger} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-slate-500">Amount:</span>
                      <span className="ml-1 text-white font-mono">{stroopsToXlm(escrow.amount)} XLM</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Token:</span>
                      <span className="ml-1 text-white font-mono">{escrow.token.slice(0, 8)}...</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Release:</span>
                      <span className="ml-1 text-white font-mono">#{escrow.releaseLedger.toLocaleString()}</span>
                    </div>
                    <div className="col-span-2 sm:col-span-3 flex items-center gap-1">
                      <span className="text-slate-500">From:</span>
                      <button onClick={() => handleCopy(escrow.from)} className="text-white font-mono hover:text-stellar-400 transition-colors" title="Copy address">
                        {shortenAddress(escrow.from)}
                      </button>
                      <span className="text-slate-500 mx-1">→</span>
                      <span className="text-slate-500">To:</span>
                      <button onClick={() => handleCopy(escrow.to)} className="text-white font-mono hover:text-stellar-400 transition-colors" title="Copy address">
                        {shortenAddress(escrow.to)}
                      </button>
                    </div>
                  </div>

                  {/* Counterparty info */}
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      isSender(escrow) ? "bg-blue-500/10 text-blue-300" : "bg-slate-500/10 text-slate-400"
                    }`}>
                      {isSender(escrow) ? "You sent" : "Sent to you"}
                    </span>
                    {escrow.memo && (
                      <span className="text-slate-500">Memo: {escrow.memo}</span>
                    )}
                  </div>

                  {/* Milestone visualization placeholder */}
                  {escrow.status === "Pending" && (
                    <div className="mt-3">
                      <MilestoneProgress
                        milestones={[
                          { id: 1, label: "Deposited", amount: stroopsToXlm(escrow.amount), deadline: escrow.releaseLedger - 100, status: "approved" },
                          { id: 2, label: "Approved", amount: stroopsToXlm(escrow.amount), deadline: escrow.releaseLedger, status: currentLedger >= escrow.releaseLedger ? "claimed" : "pending" },
                        ]}
                      />
                    </div>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="flex flex-col gap-2 shrink-0">
                  {escrow.status === "Pending" && (
                    <>
                      <button
                        onClick={() => handleClaim(escrow.id)}
                        disabled={!canClaim(escrow) || actionLoading === escrow.id}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
                        title={
                          !isRecipient(escrow) ? "Only the recipient can claim"
                          : currentLedger < escrow.releaseLedger ? "Release ledger not reached"
                          : "Claim escrow"
                        }
                      >
                        {actionLoading === escrow.id ? "Claiming..." : "Claim"}
                      </button>
                      <button
                        onClick={() => setCancelConfirmId(escrow.id)}
                        disabled={!canCancel(escrow)}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
                        title={
                          !isSender(escrow) ? "Only the sender can cancel"
                          : currentLedger >= escrow.releaseLedger ? "Release ledger already reached"
                          : "Cancel escrow"
                        }
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <a
                    href={`https://stellar.expert/explorer/testnet/ledger/${escrow.releaseLedger}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-white transition-colors text-center"
                  >
                    View on Explorer
                  </a>
                </div>
              </div>

              {/* Cancel confirmation dialog */}
              {cancelConfirmId === escrow.id && (
                <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <p className="text-sm text-rose-200 mb-2">Are you sure you want to cancel escrow #{escrow.id}?</p>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason for cancellation (optional)"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCancel(escrow.id)}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-500 transition-colors"
                    >
                      {actionLoading === escrow.id ? "Cancelling..." : "Confirm Cancel"}
                    </button>
                    <button
                      onClick={() => { setCancelConfirmId(null); setCancelReason(""); }}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-white/5 text-slate-400 hover:bg-white/10 transition-colors"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Link href="/escrow" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to escrow page
        </Link>
      </div>
    </div>
  );
}
