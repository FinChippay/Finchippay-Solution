import React from "react";
import { Invoice } from "@/lib/invoices";
import { formatAsset, formatDate } from "@/utils/format";

interface InvoiceCardProps {
  invoice: Invoice;
  onView: (id: string) => void;
  onDownload: (id: string) => void;
}

const statusStyles: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  sent: "bg-stellar-100 text-stellar-700 dark:bg-stellar-900/30 dark:text-stellar-400",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function InvoiceCard({ invoice, onView, onDownload }: InvoiceCardProps) {
  const isOverdue = invoice.status === "overdue" ||
    (invoice.status === "sent" && new Date(invoice.dueDate) < new Date());

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-5 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] backdrop-blur-md transition-all hover:-translate-y-1 hover:shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] dark:border-white/10 dark:bg-slate-900/40">
      <div className="absolute top-0 right-0 rounded-bl-xl bg-stellar-500/20 px-3 py-1 text-xs font-bold text-stellar-700 dark:text-stellar-300">
        {invoice.invoiceNumber}
      </div>

      <div className="mb-4 mt-2">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white truncate">
            {invoice.clientName}
          </h3>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusStyles[invoice.status]}`}
          >
            {invoice.status}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {invoice.clientEmail}
        </p>
      </div>

      <div className="mb-4">
        <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-1">
          {invoice.description}
        </p>
        <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
          {formatAsset(invoice.amount, invoice.asset)}
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Created</span>
          <span className="font-medium text-slate-900 dark:text-slate-200">
            {formatDate(invoice.createdAt)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Due</span>
          <span className={`font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-200"}`}>
            {formatDate(invoice.dueDate)}
          </span>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          onClick={() => onView(invoice.id)}
          className="flex-1 rounded-xl bg-stellar-500/10 py-2.5 text-sm font-semibold text-stellar-700 transition-colors hover:bg-stellar-500/20 dark:bg-stellar-500/20 dark:text-stellar-300 dark:hover:bg-stellar-500/30"
        >
          View Details
        </button>
        <button
          onClick={() => onDownload(invoice.id)}
          className="flex items-center justify-center rounded-xl bg-slate-100 px-3 py-2.5 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          title="Download PDF"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </div>
    </div>
  );
}