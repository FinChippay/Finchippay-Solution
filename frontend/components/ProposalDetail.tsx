/**
 * components/ProposalDetail.tsx
 * Full detail view for a governance (admin) or payment multi-sig proposal.
 *
 * Shows proposer, action type, raw payload, signer set, approval threshold and
 * status, plus an "Approve" action for pending proposals. Approving invokes the
 * contract's `approve_admin_action` / `approve_multisig` entrypoint through the
 * connected wallet.
 */

import { useState } from "react";
import { getClient } from "@/lib/soroban";
import { submitTransaction } from "@/lib/stellar";
import {
  ADMIN_ACTION_LABELS,
  type ProposalKind,
  type TreasuryProposal,
} from "@/lib/treasury";
import { signTransactionWithWallet } from "@/lib/wallet";
import { shortenAddress } from "@/utils/format";

interface ProposalDetailProps {
  proposal: TreasuryProposal;
  /** The connected wallet public key, used to pre-check whether the user can approve. */
  publicKey: string | null;
  onBack: () => void;
  onApproved?: () => void;
}

/** Human-friendly summary of an admin action's raw `action_data` payload. */
function formatActionData(
  kind: ProposalKind,
  actionType: string,
  data: unknown[],
): string {
  if (kind === "payment" || data.length === 0) return "—";
  if (actionType === "set_admin_signers") {
    const signers = Array.isArray(data[0]) ? data[0].map(String) : [];
    const threshold = data[1];
    return `Signers: ${signers.length} · threshold ${String(threshold)}`;
  }
  if (actionType === "upgrade") {
    return `WASM hash: ${shortenAddress(String(data[0] ?? ""), 10)} · layout v${String(data[1] ?? "")}`;
  }
  if (actionType === "reconcile_balance") {
    return `Token: ${shortenAddress(String(data[0] ?? ""), 8)}`;
  }
  if (actionType === "set_pauser") {
    return `Pauser: ${shortenAddress(String(data[0] ?? ""), 8)}`;
  }
  return JSON.stringify(data);
}

export default function ProposalDetail({
  proposal,
  publicKey,
  onBack,
  onApproved,
}: ProposalDetailProps) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const signed = proposal.approvals.length;
  const isPending = proposal.status === "pending";
  // Only admin actions support on-chain approval here; payment multi-sig
  // approval shares the same entrypoint family via the client but we keep the
  // governance (admin) flow as the primary supported action.
  const canApprove = isPending && Boolean(publicKey);

  const handleApprove = async () => {
    if (!publicKey) return;
    setApproving(true);
    setError(null);
    setTxHash(null);
    try {
      const client = getClient();
      const tx =
        proposal.kind === "admin"
          ? await client.buildApproveAdminActionTx(proposal.id, publicKey)
          : await client.buildApprovePaymentMultisigTx(proposal.id, publicKey);
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Signing rejected");
      }
      const result = await submitTransaction(signedXDR);
      setTxHash(result.hash);
      onApproved?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  };

  const actionLabel =
    proposal.kind === "admin"
      ? ADMIN_ACTION_LABELS[proposal.actionType] ?? proposal.actionType
      : "Payment multi-sig";

  const statusText =
    proposal.status === "pending"
      ? `Pending — ${signed} of ${proposal.threshold} signed`
      : proposal.status === "executed"
        ? "Executed"
        : "Cancelled";

  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-6 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] backdrop-blur-md dark:border-white/10 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-xs font-semibold text-stellar-600 hover:underline dark:text-stellar-400"
      >
        ← Back to proposals
      </button>

      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          {actionLabel}
        </h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">#{proposal.id}</span>
      </div>
      <p className="mb-6 text-xs text-slate-500 dark:text-slate-400">
        {proposal.kind === "admin" ? "Governance proposal" : "Payment proposal"} · {statusText}
      </p>

      <dl className="space-y-3 text-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Proposer</dt>
          <dd className="font-mono text-slate-900 dark:text-slate-200">
            {shortenAddress(proposal.proposer, 12)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Action type</dt>
          <dd className="font-mono text-slate-900 dark:text-slate-200">
            {proposal.actionType}
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Payload</dt>
          <dd className="break-all font-mono text-xs text-slate-900 dark:text-slate-200">
            {formatActionData(proposal.kind, proposal.actionType, proposal.actionData)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Approvals</dt>
          <dd className="text-slate-900 dark:text-slate-200">
            {signed} of {proposal.threshold}
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Expiration ledger</dt>
          <dd className="font-mono text-slate-900 dark:text-slate-200">
            {proposal.expirationLedger > 0 ? proposal.expirationLedger : "—"}
          </dd>
        </div>
      </dl>

      {/* Signers / approvals */}
      {(proposal.signers.length > 0 || proposal.approvals.length > 0) && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {proposal.kind === "admin" ? "Admin signers" : "Signers"}
          </h3>
          <ul className="space-y-1.5">
            {proposal.signers.map((signer) => {
              const approved = proposal.approvals.includes(signer);
              return (
                <li
                  key={signer}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300"
                >
                  <span>{shortenAddress(signer, 10)}</span>
                  <span
                    className={
                      approved
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-400"
                    }
                  >
                    {approved ? "✓ Signed" : "Pending"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      {txHash && (
        <p className="mt-4 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Approved — tx {txHash}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={!canApprove || approving}
          aria-busy={approving}
          className="btn-primary flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {approving ? "Approving…" : "Approve"}
        </button>
        {!publicKey && isPending && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Connect a wallet to approve.
          </span>
        )}
      </div>
    </div>
  );
}