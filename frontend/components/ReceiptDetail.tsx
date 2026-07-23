import React, { useState } from "react";
import { formatXLM } from "@/utils/format";
import type { ReceiptMetadata } from "@/lib/stellar";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@/components/icons";

interface ReceiptDetailProps {
  index: number;
  receipt: ReceiptMetadata;
  username: string; // the username or address to build the share link
  onClose?: () => void;
}

export default function ReceiptDetail({ index, receipt, username, onClose }: ReceiptDetailProps) {
  const [copied, setCopied] = useState(false);

  const shareLink = typeof window !== "undefined"
    ? `${window.location.origin}/${username}/receipt/${index}`
    : `/${username}/receipt/${index}`;

  const formattedDate = new Date(receipt.timestamp * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg rounded-3xl border border-white/20 bg-white/10 p-8 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
            Receipt #{index}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {formattedDate}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="mb-8 rounded-2xl bg-slate-50 p-6 text-center dark:bg-slate-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Amount Paid
        </p>
        <p className="text-4xl font-black text-stellar-600 dark:text-stellar-400">
          {formatXLM(Number(receipt.amount) / 10000000)} XLM
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col border-b border-slate-200 pb-4 dark:border-white/10">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">From</span>
          <span className="font-mono text-sm text-slate-900 dark:text-slate-200 break-all mt-1">{receipt.from}</span>
        </div>
        
        <div className="flex flex-col border-b border-slate-200 pb-4 dark:border-white/10">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">To</span>
          <span className="font-mono text-sm text-slate-900 dark:text-slate-200 break-all mt-1">{receipt.to}</span>
        </div>

        {receipt.memo && (
          <div className="flex flex-col border-b border-slate-200 pb-4 dark:border-white/10">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Memo</span>
            <span className="text-sm text-slate-900 dark:text-slate-200 mt-1">{receipt.memo}</span>
          </div>
        )}

        <div className="flex flex-col pb-4">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Ledger</span>
          <span className="font-mono text-sm text-slate-900 dark:text-slate-200 mt-1">{receipt.ledger}</span>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200 dark:border-white/10 flex flex-col gap-3">
        <button
          onClick={handleCopyLink}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-stellar-500 py-3.5 text-sm font-semibold text-white transition-all hover:bg-stellar-600 shadow-lg shadow-stellar-500/30"
        >
          {copied ? <CheckIcon className="h-5 w-5" /> : <CopyIcon className="h-5 w-5" />}
          {copied ? "Link Copied!" : "Copy Share Link"}
        </button>
      </div>
    </div>
  );
}
