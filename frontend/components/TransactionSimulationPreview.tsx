/**
 * components/TransactionSimulationPreview.tsx
 *
 * Preview modal that displays Soroban transaction simulation results
 * *before* the user signs. Shows:
 *  - Balance changes (before/after amounts)
 *  - Resource fees in XLM
 *  - Contract errors surfaced (e.g. "release_ledger not reached")
 *  - Warning on simulation failure, but allows user to proceed
 *
 * Integration: Wire this component into any flow that builds a transaction
 * (escrow, streaming, multi-sig, etc.) right before the signing step.
 *
 * Usage:
 *   <TransactionSimulationPreview
 *     isOpen={showPreview}
 *     onClose={() => setShowPreview(false)}
 *     onProceed={handleSign}
 *     simulation={simulationResult}
 *     loading={simLoading}
 *     error={simError}
 *     warning={simWarning}
 *   />
 */

import { useState, useMemo } from "react";
import clsx from "clsx";
import type {
  SimulationResult,
  BalanceChange,
} from "@/hooks/useTransactionSimulation";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TransactionSimulationPreviewProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Called when the user closes the preview */
  onClose: () => void;
  /** Called when the user chooses to proceed and sign */
  onProceed: () => void;
  /** Optional label for the proceed button (e.g. "Sign with Freighter") */
  proceedLabel?: string;
  /** The simulation result (null while loading) */
  simulation: SimulationResult | null;
  /** Whether the simulation is still loading */
  loading: boolean;
  /** A network-level error from the simulation */
  error: string | null;
  /** A warning (simulation failed but user can proceed) */
  warning: string | null;
  /** Optional title for the preview */
  title?: string;
  /** Optional description shown at the top of the modal */
  description?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TransactionSimulationPreview({
  isOpen,
  onClose,
  onProceed,
  proceedLabel = "Proceed to Sign",
  simulation,
  loading,
  error,
  warning,
  title = "Transaction Preview",
  description = "Review the estimated effects of this transaction before signing.",
}: TransactionSimulationPreviewProps) {
  const [confirmed, setConfirmed] = useState(false);

  // Reset confirmation state when modal opens
  useMemo(() => {
    if (isOpen) setConfirmed(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const hasIssues = !!warning || !!error;
  const canProceed = confirmed || !hasIssues;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-preview-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl"
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stellar-300/80">
                Pre-Signing Review
              </p>
              <h3
                id="sim-preview-title"
                className="mt-2 font-display text-xl font-semibold text-white"
              >
                {title}
              </h3>
              <p className="mt-1 text-sm text-slate-400">{description}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Close
            </button>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-stellar-400/20 bg-stellar-400/5 px-4 py-3">
              <Spinner className="h-5 w-5 text-stellar-300" />
              <p className="text-sm text-slate-300">
                Simulating transaction on Soroban RPC...
              </p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <WarnIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-300">
                    Simulation Error
                  </p>
                  <p className="mt-1 text-sm text-red-200/80">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Warning state (simulation failed but can proceed) */}
          {warning && !loading && (
            <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <WarnIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-300">
                    Simulation Warning
                  </p>
                  <p className="mt-1 text-sm text-amber-200/80">{warning}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        {!loading && (
          <div className="space-y-5 px-6 py-5">
            {/* Balance changes */}
            {simulation && simulation.balanceChanges.length > 0 && (
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Balance Changes
                </h4>
                <div className="space-y-2">
                  {simulation.balanceChanges.map((change, i) => (
                    <BalanceChangeRow key={i} change={change} />
                  ))}
                </div>
              </section>
            )}

            {/* No balance changes */}
            {simulation && simulation.balanceChanges.length === 0 && (
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Balance Changes
                </h4>
                <p className="text-sm text-slate-500 italic">
                  No balance changes detected for your account.
                </p>
              </section>
            )}

            {/* Resource fees */}
            {simulation?.resourceFee && (
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Resource Fees (Soroban)
                </h4>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">
                      Minimum Resource Fee
                    </span>
                    <span className="font-mono text-sm font-semibold text-stellar-200">
                      {simulation.resourceFee.xlm.toFixed(7)} XLM
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    ({simulation.resourceFee.stroops.toLocaleString()} stroops)
                  </p>
                </div>
              </section>
            )}

            {/* Base fee estimate */}
            {simulation && simulation.rawSimulation && (
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Network Fee Estimate
                </h4>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Base Fee</span>
                    <span className="font-mono text-sm text-slate-300">
                      ~0.00001 XLM (100 stroops)
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* Contract error details */}
            {simulation?.contractError && (
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Contract Feedback
                </h4>
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <XCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                    <div>
                      <p className="text-sm font-medium text-red-300">
                        {simulation.contractError.message}
                      </p>
                      {simulation.contractError.code && (
                        <p className="mt-1 text-xs text-red-200/60">
                          Code: {simulation.contractError.code}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Success state indicator */}
            {simulation?.success && !warning && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon className="h-5 w-5 text-emerald-400" />
                  <p className="text-sm text-emerald-200">
                    Simulation passed — no contract errors detected.
                  </p>
                </div>
              </div>
            )}

            {/* Confirmation checkbox for warning/error scenarios */}
            {hasIssues && (
              <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-400 bg-amber-400/10 text-amber-500 focus:ring-amber-400/30"
                />
                <span className="text-sm text-slate-300">
                  I understand there was a simulation issue and want to proceed
                  anyway.
                </span>
              </label>
            )}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="border-t border-white/10 px-6 py-4">
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-full py-2.5 text-sm sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onProceed}
              disabled={!canProceed || loading}
              className={clsx(
                "btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2",
                (!canProceed || loading) && "opacity-50 cursor-not-allowed"
              )}
            >
              {loading ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Simulating...
                </>
              ) : (
                proceedLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function BalanceChangeRow({ change }: { change: BalanceChange }) {
  const diffNum = parseFloat(change.difference);
  const isNegative = diffNum < 0;
  const isPositive = diffNum > 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">
          {change.assetCode}
          {change.asset !== "native" && (
            <span className="ml-1 text-xs text-slate-500">
              ({change.asset.slice(0, 12)}...)
            </span>
          )}
        </span>
        <span
          className={clsx(
            "font-mono text-sm font-semibold",
            isNegative && "text-red-400",
            isPositive && "text-emerald-400",
            !isNegative && !isPositive && "text-slate-400"
          )}
        >
          {isPositive ? "+" : ""}
          {change.difference} {change.assetCode}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>Before: {change.before}</span>
        <ArrowRightIcon className="mx-2 h-3 w-3 text-slate-600" />
        <span>After: {change.after}</span>
      </div>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`${className ?? ""} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
      />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l6 6m0-6l-6 6M12 3a9 9 0 110 18 9 9 0 010-18z" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}