/**

 * pages/tx/[txHash].tsx
 * Transaction detail page with mobile-first responsive design
 */

import clsx from "clsx";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { withErrorBoundary } from "@/components/ErrorBoundary";
import TransactionActions from "@/components/TransactionActions";
import TransactionTimeline from "@/components/TransactionTimeline";
import { ArrowUpIcon, ArrowDownIcon, LedgerIcon } from "@/components/icons";
import { server, explorerUrl, shortenAddress } from "@/lib/stellar";
import { formatAsset, formatDate, timeAgo } from "@/utils/format";
import { logger } from "@/lib/logger";

interface TransactionDetail {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  fee: string;
  memo?: string;
  memoType?: string;
  operationCount: number;
  successful: boolean;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
  type?: "sent" | "received" | "payment";
}

interface TimelineStep {
  label: string;
  timestamp?: string;
  status: "completed" | "current" | "pending";
}

function TransactionDetailPage() {
  const { t } = useTranslation("common");
  const router = useRouter();
  const { txHash } = router.query;

  const [transaction, setTransaction] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFullMemo, setShowFullMemo] = useState(false);

  useEffect(() => {
    if (!txHash || typeof txHash !== "string") return;

    async function fetchTransactionDetails() {
      setLoading(true);
      setError(null);

      try {
        const tx = await server.transactions().transaction(txHash as string).call();
        const operations = await server.operations().forTransaction(txHash as string).call();
        
        let amount: string | undefined;
        let asset: string | undefined;
        let from: string | undefined;
        let to: string | undefined;
        let type: "sent" | "received" | "payment" | undefined;

        type PaymentOp = import("@stellar/stellar-sdk").Horizon.HorizonApi.PaymentOperationResponse;
        const paymentOp = operations.records.find(
          (op) => op.type === "payment",
        ) as PaymentOp | undefined;
        if (paymentOp) {
          amount = paymentOp.amount;
          asset = paymentOp.asset_type === "native" ? "XLM" : paymentOp.asset_code;
          from = paymentOp.from;
          to = paymentOp.to;
          type = "payment";
        }

        const detail: TransactionDetail = {
          hash: String(tx.hash),
          ledger: tx.ledger_attr,
          createdAt: tx.created_at,
          sourceAccount: tx.source_account,
          fee: (parseInt(tx.fee_charged || tx.max_fee) / 10000000).toFixed(7),
          memo: tx.memo || undefined,
          memoType: tx.memo_type || undefined,
          operationCount: tx.operation_count,
          successful: tx.successful,
          amount,
          asset,
          from,
          to,
          type,
        };

        setTransaction(detail);
      } catch (err) {
        logger.error("Failed to fetch transaction:", {}, err instanceof Error ? err : undefined);
        setError("Failed to load transaction details. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    fetchTransactionDetails();
  }, [txHash]);

  const getTimelineSteps = (): TimelineStep[] => {
    if (!transaction) return [];
    const steps: TimelineStep[] = [
      { label: "Created", timestamp: transaction.createdAt, status: "completed" },
      { label: "Signed", timestamp: transaction.createdAt, status: "completed" },
      { label: "Submitted", timestamp: transaction.createdAt, status: "completed" },
      { label: transaction.successful ? "Confirmed" : "Failed", timestamp: transaction.createdAt, status: "completed" },
    ];
    return steps;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-cosmos-950 dark:to-cosmos-900 pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <div className="mb-6">
            <div className="h-8 w-48 bg-cosmos-700 animate-pulse rounded-lg mb-2" />
            <div className="h-4 w-64 bg-cosmos-700 animate-pulse rounded" />
          </div>
          <div className="card space-y-6">
            <div className="h-32 bg-cosmos-700 animate-pulse rounded-xl" />
            <div className="h-48 bg-cosmos-700 animate-pulse rounded-xl" />
            <div className="h-24 bg-cosmos-700 animate-pulse rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-cosmos-950 dark:to-cosmos-900 pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <div className="card text-center py-12">
            <p className="text-red-400 mb-4">{error || "Transaction not found"}</p>
            <button onClick={() => router.back()} className="btn-secondary text-sm py-2 px-4">Go Back</button>
          </div>
        </div>
      </div>
    );
  }

  const timelineSteps = getTimelineSteps();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-cosmos-950 dark:to-cosmos-900 pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-sm text-stellar-600 dark:text-stellar-400 hover:underline mb-3 inline-flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Transactions
          </button>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">Transaction Details</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{timeAgo(transaction.createdAt)}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">Overview</h2>
              {transaction.amount && transaction.asset && (
                <div className="mb-6 p-4 rounded-xl bg-slate-50 dark:bg-white/5 text-center">
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center", transaction.type === "sent" ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20")}>
                      {transaction.type === "sent" ? <ArrowUpIcon className="w-5 h-5 text-red-400" /> : <ArrowDownIcon className="w-5 h-5 text-emerald-400" />}
                    </div>
                    <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400 capitalize">{transaction.type || "Payment"}</h3>
                  </div>
                  <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatAsset(transaction.amount, transaction.asset)}</p>
                </div>
              )}
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-start"><span className="text-slate-600 dark:text-slate-400">Status</span><span className={clsx("font-medium px-2 py-1 rounded-lg text-xs", transaction.successful ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400")}>{transaction.successful ? "Confirmed" : "Failed"}</span></div>
                <div className="flex justify-between items-start"><span className="text-slate-600 dark:text-slate-400">Type</span><span className="font-medium text-slate-900 dark:text-white">Payment</span></div>
                <div className="flex justify-between items-start"><span className="text-slate-600 dark:text-slate-400">Operations</span><span className="font-medium text-slate-900 dark:text-white">{transaction.operationCount}</span></div>
              </div>
            </div>
            {transaction.from && transaction.to && (
              <div className="card">
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">Parties</h2>
                <div className="space-y-4">
                  <div><label className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1 block">From</label><span className="font-mono text-sm text-slate-900 dark:text-slate-200 break-all">{transaction.from}</span></div>
                  <div><label className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1 block">To</label><span className="font-mono text-sm text-slate-900 dark:text-slate-200 break-all">{transaction.to}</span></div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-6">
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-6">Transaction Timeline</h2>
              <TransactionTimeline steps={timelineSteps} />
            </div>
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">Details</h2>
              <div className="space-y-4 text-sm">
                <div><label className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1 block">Transaction Hash</label><p className="font-mono text-xs text-slate-900 dark:text-slate-200 break-all bg-slate-50 dark:bg-white/5 p-2 rounded">{transaction.hash}</p></div>
                <div className="flex justify-between items-start"><span className="text-slate-600 dark:text-slate-400">Ledger</span><div className="flex items-center gap-2"><LedgerIcon className="w-4 h-4 text-slate-400" /><span className="font-mono font-medium text-slate-900 dark:text-white">{transaction.ledger.toLocaleString()}</span></div></div>
                <div className="flex justify-between items-start"><span className="text-slate-600 dark:text-slate-400">Fee Charged</span><span className="font-mono font-medium text-slate-900 dark:text-white">{transaction.fee} XLM</span></div>
                <div className="flex justify-between items-start"><span className="text-slate-600 dark:text-slate-400">Timestamp</span><span className="font-medium text-slate-900 dark:text-white text-right">{formatDate(transaction.createdAt)}</span></div>
                {transaction.memo && (
                  <div><label className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1 block">Memo</label>
                    <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-lg">
                      <p className={clsx("text-slate-900 dark:text-slate-200 break-words", !showFullMemo && transaction.memo.length > 100 && "line-clamp-2")}>{transaction.memo}</p>
                      {transaction.memo.length > 100 && <button onClick={() => setShowFullMemo(!showFullMemo)} className="text-xs text-stellar-600 dark:text-stellar-400 hover:underline mt-1">{showFullMemo ? "Show less" : "Show more"}</button>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="card mt-6">
          <TransactionActions transactionHash={transaction.hash} transaction={transaction} />
        </div>
      </div>
    </div>
  );
}

export default withErrorBoundary(TransactionDetailPage, "TransactionDetailPage");