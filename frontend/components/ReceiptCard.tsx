import React from "react";
import { formatXLM, shortenAddress } from "@/utils/format";
import type { ReceiptMetadata } from "@/lib/stellar";

interface ReceiptCardProps {
  index: number;
  receipt: ReceiptMetadata;
  onViewDetails: (index: number) => void;
}

export default function ReceiptCard({ index, receipt, onViewDetails }: ReceiptCardProps) {
  const formattedDate = new Date(receipt.timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-5 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] backdrop-blur-md transition-all hover:-translate-y-1 hover:shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] dark:border-white/10 dark:bg-slate-900/40">
      <div className="absolute top-0 right-0 rounded-bl-xl bg-stellar-500/20 px-3 py-1 text-xs font-bold text-stellar-700 dark:text-stellar-300">
        #{index}
      </div>
      
      <div className="mb-4 mt-2">
        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
          {formatXLM(Number(receipt.amount) / 10000000)} XLM
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">{formattedDate}</p>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">From</span>
          <span className="font-mono text-slate-900 dark:text-slate-200" title={receipt.from}>
            {shortenAddress(receipt.from)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">To</span>
          <span className="font-mono text-slate-900 dark:text-slate-200" title={receipt.to}>
            {shortenAddress(receipt.to)}
          </span>
        </div>
        {receipt.memo && (
          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
            <span className="text-slate-500 dark:text-slate-400">Memo</span>
            <span className="text-slate-900 dark:text-slate-200 text-right truncate max-w-[150px]" title={receipt.memo}>
              {receipt.memo}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={() => onViewDetails(index)}
        className="mt-6 w-full rounded-xl bg-stellar-500/10 py-2.5 text-sm font-semibold text-stellar-700 transition-colors hover:bg-stellar-500/20 dark:bg-stellar-500/20 dark:text-stellar-300 dark:hover:bg-stellar-500/30"
      >
        View Details
      </button>
    </div>
  );
}
