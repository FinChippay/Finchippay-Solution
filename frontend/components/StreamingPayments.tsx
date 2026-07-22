/**
 * components/StreamingPayments.tsx
 * Real-time view of the connected wallet's active payment streams.
 *
 * Polls get_stream (via getActiveStreamsForRecipient) every ledger close
 * (~5s) and animates the claimable balance between polls using the stream's
 * rate_per_ledger, so the number visibly ticks up instead of jumping.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getActiveStreamsForRecipient,
  getCurrentLedger,
  computeStreamClaimable,
  buildClaimStreamTransaction,
  submitTransaction,
  STELLAR_STROOPS_PER_XLM,
  shortenAddress,
  type StreamRecord,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { useCountUp } from "@/lib/useCountUp";
import { useToastContext } from "@/lib/ToastContext";

/** Matches Stellar's ~5s ledger close time. */
const POLL_INTERVAL_MS = 5000;

interface StreamingPaymentsProps {
  publicKey: string;
}

export default function StreamingPayments({ publicKey }: StreamingPaymentsProps) {
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [currentLedger, setCurrentLedger] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const { addToast } = useToastContext();

  const fetchStreams = useCallback(async () => {
    try {
      const [active, ledger] = await Promise.all([
        getActiveStreamsForRecipient(publicKey),
        getCurrentLedger(),
      ]);
      setStreams(active);
      setCurrentLedger(ledger);
      setError(null);
      setPollTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment streams.");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchStreams();
    const intervalId = window.setInterval(fetchStreams, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchStreams]);

  const handleClaim = async (streamId: number) => {
    setClaimingId(streamId);
    try {
      const tx = await buildClaimStreamTransaction(publicKey, streamId);
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Signing was rejected.");
      }
      await submitTransaction(signedXDR);
      addToast("Stream claimed successfully.", "success");
      await fetchStreams();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Claim failed. Please try again.", "error");
    } finally {
      setClaimingId(null);
    }
  };

  if (loading) {
    return (
      <div className="card mb-8 h-40 animate-pulse bg-white/[0.03] border-white/10" data-testid="streaming-payments-loading" />
    );
  }

  if (error) {
    return (
      <section className="card mb-8 border-red-500/20 bg-red-500/5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={() => { setLoading(true); fetchStreams(); }} className="btn-secondary text-sm px-4 py-2">
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card mb-8" data-testid="streaming-payments" aria-label="Active payment streams">
      <h2 className="font-display text-lg font-semibold text-white mb-5 flex items-center gap-2">
        <StreamIcon className="w-5 h-5 text-stellar-400" />
        Active Streams
      </h2>

      {streams.length === 0 ? (
        <div className="text-center py-8" data-testid="streaming-payments-empty">
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
            <StreamIcon className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-slate-400 text-sm">No active payment streams.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {streams.map((stream) => (
            <StreamRow
              key={`${stream.id}-${pollTick}`}
              stream={stream}
              currentLedger={currentLedger ?? stream.startLedger}
              claiming={claimingId === stream.id}
              onClaim={() => handleClaim(stream.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StreamRow({
  stream,
  currentLedger,
  claiming,
  onClaim,
}: {
  stream: StreamRecord;
  currentLedger: number;
  claiming: boolean;
  onClaim: () => void;
}) {
  const depositedXLM = Number(stream.deposited) / STELLAR_STROOPS_PER_XLM;
  const claimedXLM = Number(stream.claimed) / STELLAR_STROOPS_PER_XLM;
  const rateXLM = Number(stream.ratePerLedger) / STELLAR_STROOPS_PER_XLM;
  const claimableXLM = Number(computeStreamClaimable(stream, currentLedger)) / STELLAR_STROOPS_PER_XLM;
  const progressPct = depositedXLM > 0 ? Math.min(100, (claimedXLM / depositedXLM) * 100) : 0;

  // Animate the amount expected to accrue before the next poll (~one ledger's
  // worth, at rate_per_ledger) so the claimable number visibly ticks up
  // between polls instead of jumping every 5s. Uses micro-XLM precision so
  // the animation stays smooth even for small rates.
  const deltaTargetMicroXLM = Math.max(0, Math.round(rateXLM * 1_000_000));
  const { count, elementRef } = useCountUp(deltaTargetMicroXLM, POLL_INTERVAL_MS, false);
  const animatedDelta = claimableXLM >= depositedXLM - claimedXLM ? 0 : count / 1_000_000;
  const displayClaimableXLM = claimableXLM + animatedDelta;

  return (
    <div ref={elementRef} className="rounded-xl bg-white/[0.02] border border-white/5 p-4" data-testid={`stream-row-${stream.id}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-400">From {shortenAddress(stream.payer)}</p>
        <p className="text-xs text-slate-500">Stream #{stream.id}</p>
      </div>

      <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden mb-3" role="progressbar" aria-valuenow={Math.round(progressPct)} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full bg-stellar-400 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400">Claimable</p>
          <p className="font-display text-xl font-bold text-white">
            {displayClaimableXLM.toFixed(4)} <span className="text-stellar-400 text-sm">XLM</span>
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {claimedXLM.toFixed(4)} / {depositedXLM.toFixed(4)} XLM claimed
          </p>
        </div>
        <button
          onClick={onClaim}
          disabled={claiming || claimableXLM <= 0}
          className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {claiming ? "Claiming..." : "Claim"}
        </button>
      </div>
    </div>
  );
}

function StreamIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m0 0l-6.75-6.75M20.25 12l-6.75 6.75" />
    </svg>
  );
}
