/**
 * pages/treasury.tsx
 * DAO treasury multi-sig management dashboard (Issue #566).
 *
 * Lists on-chain governance (admin-action) proposals and payment multi-sig
 * proposals with approval progress, a detail view, and approve actions wired
 * through the connected wallet.
 */

import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import ProposalCard from "@/components/ProposalCard";
import ProposalDetail from "@/components/ProposalDetail";
import WalletConnect from "@/components/WalletConnect";
import { logger } from "@/lib/logger";
import {
  fetchTreasuryOverview,
  type TreasuryOverview,
  type TreasuryProposal,
} from "@/lib/treasury";
import { useWallet } from "@/lib/useWallet";

export default function TreasuryPage() {
  const { publicKey } = useWallet();
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreasuryProposal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTreasuryOverview(publicKey ?? undefined);
      setOverview(data);
    } catch (err: unknown) {
      logger.error("Failed to load treasury overview", {}, err instanceof Error ? err : undefined);
      setError(err instanceof Error ? err.message : "Failed to load treasury proposals");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  // Reload whenever the wallet changes. Without a wallet we still attempt the
  // read so the page works anonymously (reads are public on the contract).
  useEffect(() => {
    void load();
  }, [load]);

  const handleApproved = useCallback(() => {
    setSelected(null);
    void load();
  }, [load]);

  const handleSelect = useCallback((proposal: TreasuryProposal) => {
    setSelected(proposal);
  }, []);

  const pendingCount = overview?.proposals.filter((p) => p.status === "pending").length ?? 0;

  return (
    <>
      <Head>
        <title>Treasury — Multi-Sig Governance</title>
        <meta
          name="description"
          content="DAO treasury multi-sig governance dashboard: view proposals, track signer thresholds, and approve admin actions."
        />
      </Head>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Treasury Governance
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Multi-sig proposals and admin actions from the on-chain governance
              contract.
              {overview && (
                <>
                  {" "}
                  {pendingCount > 0
                    ? `${pendingCount} pending proposal${pendingCount === 1 ? "" : "s"} awaiting approval.`
                    : "No pending proposals."}
                </>
              )}
            </p>
          </div>
          <WalletConnect />
        </div>

        {loading && (
          <div className="space-y-4" role="status" aria-label="Loading treasury proposals">
            <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/10" />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/10" />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/10" />
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {!loading && !error && overview && (
          <>
            {overview.adminSigners.length > 0 && (
              <div className="mb-6 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/40">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Admin signer set · threshold{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {overview.adminThreshold}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {overview.adminSigners.length}
                  </span>
                </p>
              </div>
            )}

            {selected ? (
              <ProposalDetail
                proposal={selected}
                publicKey={publicKey}
                onBack={() => setSelected(null)}
                onApproved={handleApproved}
              />
            ) : overview.proposals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/30 p-10 text-center dark:border-white/20">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No treasury proposals yet. When admin actions or payment
                  multi-sig proposals are proposed on-chain, they will appear
                  here.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {overview.proposals.map((proposal) => (
                  <ProposalCard
                    key={`${proposal.kind}-${proposal.id}`}
                    proposal={proposal}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}