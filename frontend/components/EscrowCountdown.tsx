import { useState, useEffect } from "react";

interface EscrowCountdownProps {
  releaseLedger: number;
  currentLedger: number;
}

const SECONDS_PER_LEDGER = 5;
const LEDGERS_PER_DAY = 24 * 60 * 60 / SECONDS_PER_LEDGER;
const LEDGERS_PER_HOUR = 60 * 60 / SECONDS_PER_LEDGER;
const LEDGERS_PER_MINUTE = 60 / SECONDS_PER_LEDGER;

function getLedgerCountdown(release: number, current: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalLedgers: number;
} {
  const remaining = Math.max(0, release - current);
  const totalSeconds = remaining * SECONDS_PER_LEDGER;
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, totalLedgers: remaining };
}

function getColorClass(remainingLedgers: number): string {
  if (remainingLedgers <= 0) return "text-emerald-400";
  if (remainingLedgers <= Math.floor(24 * LEDGERS_PER_HOUR)) return "text-rose-400";
  if (remainingLedgers <= Math.floor(7 * LEDGERS_PER_DAY)) return "text-amber-400";
  return "text-emerald-400";
}

function getBgColorClass(remainingLedgers: number): string {
  if (remainingLedgers <= 0) return "bg-emerald-500/10 border-emerald-500/20";
  if (remainingLedgers <= Math.floor(24 * LEDGERS_PER_HOUR)) return "bg-rose-500/10 border-rose-500/20";
  if (remainingLedgers <= Math.floor(7 * LEDGERS_PER_DAY)) return "bg-amber-500/10 border-amber-500/20";
  return "bg-emerald-500/10 border-emerald-500/20";
}

export default function EscrowCountdown({ releaseLedger, currentLedger }: EscrowCountdownProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const countdown = getLedgerCountdown(releaseLedger, currentLedger);
  const colorClass = getColorClass(countdown.totalLedgers);
  const bgClass = getBgColorClass(countdown.totalLedgers);

  const estimatedDate = new Date(now + countdown.totalLedgers * SECONDS_PER_LEDGER * 1000);
  const formattedDate = estimatedDate.toLocaleString();

  if (countdown.totalLedgers <= 0) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass} ${bgClass}`} title="Release ledger has passed">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Ready to claim
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass} ${bgClass}`}
      title={`Release ledger: ${releaseLedger.toLocaleString()} · Current: ${currentLedger.toLocaleString()} · Estimated: ${formattedDate}`}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {countdown.days > 0 && `${countdown.days}d `}
      {countdown.hours > 0 && `${countdown.hours}h `}
      {countdown.minutes > 0 && `${countdown.minutes}m `}
      {countdown.seconds}s
    </span>
  );
}
