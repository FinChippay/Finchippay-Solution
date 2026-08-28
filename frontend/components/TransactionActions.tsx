/**

 * components/TransactionActions.tsx
 * Action buttons for transaction detail page — now includes Generate Invoice
 */

import { motion } from "framer-motion";
import { useState } from "react";
import InvoiceModal from "@/components/InvoiceModal";
import { ExternalLinkIcon, CopyIcon, CheckIcon, PrinterIcon } from "@/components/icons";
import { generatePDFReceipt } from "@/lib/generatePDF";
import type { TransactionReceipt } from "@/lib/generatePDF";
import { logger } from "@/lib/logger";
import { explorerUrl } from "@/lib/stellar";
import { copyToClipboard } from "@/utils/format";

interface TransactionActionsProps {
  transactionHash: string;
  transaction: TransactionReceipt;
}

export default function TransactionActions({
  transactionHash,
  transaction,
}: TransactionActionsProps) {
  const [copiedHash, setCopiedHash] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const handleCopyHash = async () => {
    const success = await copyToClipboard(transactionHash);
    if (success) {
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    const shareUrl = `${window.location.origin}/tx/${transactionHash}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Transaction Receipt",
          text: `View transaction on Finchippay`,
          url: shareUrl,
        });
      } catch {
        // User dismissed the native share sheet — not an error.
        logger.info("Share cancelled by user");
      }
    } else {
      await copyToClipboard(shareUrl);
    }
    setSharing(false);
  };

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      await generatePDFReceipt(transaction);
    } catch (err) {
      logger.error("Failed to generate PDF:", {}, err instanceof Error ? err : undefined);
      alert("Failed to generate PDF receipt. Please try again.");
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleViewOnExplorer = () => {
    const url = explorerUrl(transactionHash);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const prefilledInvoiceData = transaction
    ? {
        amount: transaction.amount || "",
        asset: transaction.asset || "XLM",
        description: transaction.memo || "Payment",
        transactionHash: transaction.hash,
        fromAddress: transaction.from || transaction.sourceAccount,
        toAddress: transaction.to,
      }
    : undefined;

  return (
    <>
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">
          Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleViewOnExplorer}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-900 dark:text-white font-medium text-sm transition-colors min-h-[44px]"
          >
            <ExternalLinkIcon className="w-5 h-5" />
            View on Explorer
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCopyHash}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-900 dark:text-white font-medium text-sm transition-colors min-h-[44px]"
          >
            {copiedHash ? (
              <>
                <CheckIcon className="w-5 h-5 text-emerald-500" />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon className="w-5 h-5" />
                Copy Hash
              </>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleShare}
            disabled={sharing}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-900 dark:text-white font-medium text-sm transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            {sharing ? "Sharing..." : "Share Receipt"}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleDownloadPDF}
            disabled={generatingPDF}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stellar-500/10 hover:bg-stellar-500/20 text-stellar-700 dark:text-stellar-400 font-medium text-sm transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generatingPDF ? (
              <>
                <div className="w-5 h-5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <PrinterIcon className="w-5 h-5" />
                Download PDF
              </>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowInvoiceModal(true)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-medium text-sm transition-colors min-h-[44px] sm:col-span-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Generate Invoice
          </motion.button>
        </div>
      </div>

      <InvoiceModal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        onCreated={() => {}}
        prefilledData={prefilledInvoiceData}
      />
    </>
  );
}