import { motion } from "framer-motion";
import React, { useState } from "react";
import { generatePDFReceipt } from "@/lib/generatePDF";
import type { TransactionReceipt } from "@/lib/generatePDF";
import { logger } from "@/lib/logger";

interface PDFReceiptProps {
  transaction: TransactionReceipt;
  variant?: "button" | "icon" | "full";
  className?: string;
}

export default function PDFReceipt({
  transaction,
  variant = "button",
  className = "",
}: PDFReceiptProps) {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!transaction) return;
    setGenerating(true);
    try {
      await generatePDFReceipt(transaction);
    } catch (err) {
      logger.error("Failed to generate PDF receipt:", {}, err instanceof Error ? err : undefined);
      alert("Failed to generate PDF receipt. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  if (variant === "icon") {
    return (
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleGenerate}
        disabled={generating}
        className={`flex items-center justify-center rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
        title="Download PDF Receipt"
      >
        {generating ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}
      </motion.button>
    );
  }

  if (variant === "full") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border border-white/20 bg-white/10 p-5 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] backdrop-blur-md dark:border-white/10 dark:bg-slate-900/40 ${className}`}
      >
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          PDF Receipt
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-stellar-500/10 text-stellar-600 dark:text-stellar-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Transaction Receipt</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Download a formatted PDF with QR code and timestamp
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 rounded-xl bg-stellar-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-stellar-500/30 transition-all hover:bg-stellar-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Generating...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={handleGenerate}
      disabled={generating}
      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stellar-500/10 hover:bg-stellar-500/20 text-stellar-700 dark:text-stellar-400 font-medium text-sm transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {generating ? (
        <>
          <div className="w-5 h-5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
          Generating...
        </>
      ) : (
        <>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Download PDF Receipt
        </>
      )}
    </motion.button>
  );
}