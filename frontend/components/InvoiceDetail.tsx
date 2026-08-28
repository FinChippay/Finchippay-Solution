import { motion } from "framer-motion";
import React, { useState } from "react";
import { Invoice, generateInvoicePDF, updateInvoiceStatus, deleteInvoice } from "@/lib/invoices";
import { logger } from "@/lib/logger";
import { formatAsset, formatDate } from "@/utils/format";

interface InvoiceDetailProps {
  invoice: Invoice;
  onClose: () => void;
  onUpdate: () => void;
}

const statusStyles: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  sent: "bg-stellar-100 text-stellar-700 dark:bg-stellar-900/30 dark:text-stellar-400",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function InvoiceDetail({ invoice, onClose, onUpdate }: InvoiceDetailProps) {
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await generateInvoicePDF(invoice);
    } catch (err) {
      logger.error("Failed to generate PDF:", {}, err instanceof Error ? err : undefined);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handleStatusChange = (newStatus: Invoice["status"]) => {
    updateInvoiceStatus(invoice.id, newStatus);
    onUpdate();
  };

  const handleDelete = () => {
    setDeleting(true);
    deleteInvoice(invoice.id);
    onUpdate();
    onClose();
  };

  const isOverdue = invoice.status === "overdue" ||
    (invoice.status === "sent" && new Date(invoice.dueDate) < new Date());

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="mx-auto w-full max-w-2xl rounded-3xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
    >
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Invoice</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusStyles[invoice.status]}`}>
              {invoice.status}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{invoice.invoiceNumber}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mb-8 rounded-2xl bg-slate-50 p-6 text-center dark:bg-slate-800/50">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Amount Due</p>
        <p className="text-4xl font-black text-stellar-600 dark:text-stellar-400">{formatAsset(invoice.amount, invoice.asset)}</p>
        {isOverdue && (
          <p className="mt-2 text-sm font-medium text-red-500">Overdue since {formatDate(invoice.dueDate)}</p>
        )}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-white/10">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Bill To</span>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{invoice.clientName}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{invoice.clientEmail}</p>
          </div>
          <div className="border-b border-slate-200 pb-4 dark:border-white/10">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">From</span>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Finchippay</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">Stellar Blockchain Payments</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-white/10">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Description</span>
            <p className="mt-1 text-sm text-slate-900 dark:text-slate-200">{invoice.description}</p>
          </div>
          <div className="border-b border-slate-200 pb-4 dark:border-white/10">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Dates</span>
            <div className="mt-1 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Created</span>
                <span className="text-slate-900 dark:text-slate-200">{formatDate(invoice.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Due</span>
                <span className={isOverdue ? "text-red-600 dark:text-red-400 font-medium" : "text-slate-900 dark:text-slate-200"}>
                  {formatDate(invoice.dueDate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="mb-8 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Notes</span>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{invoice.notes}</p>
        </div>
      )}

      {invoice.transactionHash && (
        <div className="mb-8 rounded-xl bg-stellar-50 p-4 dark:bg-stellar-900/20">
          <span className="text-xs font-semibold uppercase text-stellar-600 dark:text-stellar-400">Linked Transaction</span>
          <p className="mt-1 font-mono text-xs text-stellar-800 dark:text-stellar-300 break-all">{invoice.transactionHash}</p>
        </div>
      )}

      <div className="mb-6">
        <span className="mb-2 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Update Status</span>
        <div className="flex flex-wrap gap-2">
          {(["draft", "sent", "paid", "overdue"] as const).map((status) => (
            <button
              key={status}
              onClick={() => handleStatusChange(status)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                invoice.status === status
                  ? statusStyles[status] + " ring-2 ring-offset-1 ring-stellar-500"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stellar-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-stellar-500/30 transition-all hover:bg-stellar-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Generating...
            </>
          ) : (
            <>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download PDF
            </>
          )}
        </button>

        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/30 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Confirm Delete"}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}