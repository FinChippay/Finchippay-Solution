/**
 * components/ProposalCard.tsx
 * Compact treasury row for a governance (admin) or payment multi-sig proposal.
 *
 * Shows the action type, approval progress ("2 of 3 signed"), and status,
 * with a "View details" affordance. Accessible: the whole card is keyboard
 * reachable and announces status changes via the short status text.
 */

import {
  ADMIN_ACTION_LABELS,
  type ProposalKind,
  type TreasuryProposal,
} from "@/lib/treasury";
import { shortenAddress } from "@/utils/format";

interface ProposalCardProps {
  proposal: TreasuryProposal;
  onSelect: (proposal: TreasuryProposal) => void;
}

const KIND_BADGES: Record<ProposalKind, string> = {
  admin:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  payment:
    "bg-stellar-100 text-stellar-700 dark:bg-stellar-900/40 dark:text-stellar-300",
};

const STATUS_BADGES: Record<TreasuryProposal["status"], string> = {
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  executed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  cancelled:
    "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

function actionLabel(proposal: TreasuryProposal): string {
  if (proposal.kind === "admin") {
    return ADMIN_ACTION_LABELS[proposal.actionType] ?? proposal.actionType;
  }
  return "Payment";
}

export default function ProposalCard({ proposal, onSelect }: ProposalCardProps) {
  const signed = proposal.approvals.length;
  const percent =
    proposal.threshold > 0
      ? Math.min(100, Math.round((signed / proposal.threshold) * 100))
      : 0;
  const statusText =
    proposal.status === "pending"
      ? `${signed} of ${proposal.threshold} signed`
      : proposal.status === "executed"
        ? "Executed"
        : "Cancelled";

  return (
    <button
      type="button"
      onClick={() => onSelect(proposal)}
      className="group w-full rounded-2xl border border-white/20 bg-white/10 p-5 text-left shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-stellar-400/40 hover:shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-stellar-400/60 dark:border-white/10 dark:bg-slate-900/40"
      aria-label={`${actionLabel(proposal)} proposal ${proposal.id}, ${statusText}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${KIND_BADGES[proposal.kind]}`}
          >
            {proposal.kind === "admin" ? "Governance" : "Payment"}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            #{proposal.id}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGES[proposal.status]}`}
        >
          {proposal.status}
        </span>
      </div>

      <h3 className="mb-1 truncate text-base font-semibold text-slate-900 dark:text-white">
        {actionLabel(proposal)}
      </h3>
      <p className="mb-4 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
        {shortenAddress(proposal.proposer, 8)} · {signed} of {proposal.threshold} signed
      </p>

      {/* Approval progress */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10"
        role="progressbar"
        aria-valuenow={signed}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, proposal.threshold)}
        aria-label={`${signed} of ${proposal.threshold} approvals`}
      >
        <div
          className={`h-full rounded-full transition-all ${
            proposal.status === "executed"
              ? "bg-emerald-500"
              : proposal.status === "cancelled"
                ? "bg-slate-400"
                : "bg-stellar-500"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {statusText}
        </span>
        <span className="text-xs font-semibold text-stellar-600 dark:text-stellar-400 group-hover:underline">
          View details →
        </span>
      </div>
    </button>
  );
}