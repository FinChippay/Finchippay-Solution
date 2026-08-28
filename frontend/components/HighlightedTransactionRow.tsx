/**
 * components/HighlightedTransactionRow.tsx
 * Transaction row with highlighted search matches
 */

import clsx from "clsx";
import { PaymentRecord, shortenAddress, explorerUrl } from "@/lib/stellar";
import { SearchResult } from "@/lib/transactionSearch";
import { formatAsset, timeAgo } from "@/utils/format";
import { ExternalLinkIcon } from "./icons";

interface HighlightedTransactionRowProps {
  result?: SearchResult;
  payment: PaymentRecord;
  compact?: boolean;
  onPrintReceipt?: (payment: PaymentRecord) => void;
  onSendAgain?: (to: string, amount: string) => void;
}

function HighlightText({
  text,
  highlights,
}: {
  text: string;
  highlights: string[];
}) {
  if (highlights.length === 0) return <span>{text}</span>;

  let lastIndex = 0;
  const parts: JSX.Element[] = [];
  const highlightSet = new Set(highlights.map((h) => h.toLowerCase()));

  // Sort highlights by position in text
  const positions = highlights.map((h) => ({
    highlight: h,
    index: text.toLowerCase().indexOf(h.toLowerCase()),
  }));

  for (const { highlight, index } of positions.sort(
    (a, b) => a.index - b.index
  )) {
    if (index !== -1 && index >= lastIndex) {
      if (index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {text.substring(lastIndex, index)}
          </span>
        );
      }
      parts.push(
        <mark
          key={`highlight-${index}`}
          className="bg-amber-300 dark:bg-amber-500 text-slate-900 dark:text-white px-0.5 rounded font-semibold"
        >
          {text.substring(index, index + highlight.length)}
        </mark>
      );
      lastIndex = index + highlight.length;
    }
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-end`}>{text.substring(lastIndex)}</span>
    );
  }

  return <>{parts}</>;
}

export default function HighlightedTransactionRow({
  result,
  payment,
  compact = false,
  onPrintReceipt,
  onSendAgain,
}: HighlightedTransactionRowProps) {
  const isIncoming = payment.type === "received";
  const counterparty: string = isIncoming ? payment.from : payment.to;

  const memoHighlights = result?.highlights.memo || [];
  const addressHighlights = result?.highlights.address || [];
  const hashHighlights = result?.highlights.hash || [];
  const relevance = result?.relevance || 0;

  return (
    <div
      className={clsx(
        "p-3 rounded-lg border border-slate-200 dark:border-slate-700",
        "hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors",
        relevance > 5 && "bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-800"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Relevance badge */}
          {relevance > 0 && (
            <div className="inline-block mb-1 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
              Match: {relevance} points
            </div>
          )}

          <div className="space-y-2">
            {/* Direction and counterparty */}
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "inline-block w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white",
                  isIncoming ? "bg-emerald-500" : "bg-blue-500"
                )}
              >
                {isIncoming ? "↓" : "↑"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isIncoming ? "Received from" : "Sent to"}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  <a
                    href={explorerUrl(`account/${counterparty}`) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-stellar-500 inline-flex items-center gap-1"
                  >
                    {addressHighlights.length > 0 ? (
                      <HighlightText
                        text={shortenAddress(counterparty)}
                        highlights={addressHighlights}
                      />
                    ) : (
                      shortenAddress(counterparty)
                    )}
                    <ExternalLinkIcon className="w-3 h-3" />
                  </a>
                </p>
              </div>
            </div>

            {/* Amount */}
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {payment.amount} {formatAsset(payment.asset)}
              </p>
            </div>

            {/* Memo with highlighting */}
            {payment.memo && (
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">
                  Memo:
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                  {memoHighlights.length > 0 ? (
                    <HighlightText text={payment.memo} highlights={memoHighlights} />
                  ) : (
                    payment.memo
                  )}
                </p>
              </div>
            )}

            {/* Hash with highlighting */}
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">
                Transaction:
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                <a
                  href={explorerUrl(`tx/${payment.hash}`) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-stellar-500 inline-flex items-center gap-1"
                >
                  {hashHighlights.length > 0 ? (
                    <HighlightText text={payment.hash.substring(0, 16)} highlights={hashHighlights} />
                  ) : (
                    payment.hash.substring(0, 16)
                  )}
                  ...
                  <ExternalLinkIcon className="w-3 h-3" />
                </a>
              </p>
            </div>

            {/* Time */}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {timeAgo(payment.createdAt)}
            </p>
          </div>
        </div>

        {/* Actions */}
        {!compact && (
          <div className="flex gap-2">
            {onPrintReceipt && (
              <button
                onClick={() => onPrintReceipt(payment)}
                className="px-2 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title="Print receipt"
              >
                🖨️
              </button>
            )}
            {!isIncoming && onSendAgain && (
              <button
                onClick={() => onSendAgain(counterparty, payment.amount)}
                className="px-2 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title="Send again"
              >
                ↩️
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
