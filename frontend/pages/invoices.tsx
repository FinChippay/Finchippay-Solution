/**
 * pages/invoices.tsx
 * Invoice Dashboard — list invoices by status, track payment, and send reminders.
 *
 * Issue #602 (GrantFox FWC26). Invoices are persisted in localStorage via
 * lib/invoices.ts (there is no backend invoice API yet). This page provides:
 *   - Status filter (All / Draft / Sent / Paid / Overdue) with per-status totals
 *   - Outstanding vs paid summary cards
 *   - Reminder action per invoice (mailto hand-off)
 *   - Deep-link into InvoiceDetail (via ?invoice=<id> query param)
 */
import { AnimatePresence, motion } from "framer-motion";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import InvoiceCard from "@/components/InvoiceCard";
import InvoiceDetail from "@/components/InvoiceDetail";
import InvoiceModal from "@/components/InvoiceModal";
import { useToastContext } from "@/lib/ToastContext";
import {
  loadInvoices,
  sendInvoiceReminder,
  summarizeInvoices,
  type Invoice,
  type InvoiceStatus,
} from "@/lib/invoices";
import { formatAsset } from "@/utils/format";

type Filter = "all" | InvoiceStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "invoices.filterAll" },
  { key: "draft", label: "invoices.filterDraft" },
  { key: "sent", label: "invoices.filterSent" },
  { key: "paid", label: "invoices.filterPaid" },
  { key: "overdue", label: "invoices.filterOverdue" },
];

export default function InvoicesPage() {
  const { t } = useTranslation("common");
  const router = useRouter();
  const { addToast } = useToastContext();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load persisted invoices once (browser only).
  useEffect(() => {
    setInvoices(loadInvoices());
    setLoaded(true);
  }, []);

  // Deep-link support: ?invoice=<id> opens the detail panel.
  useEffect(() => {
    const raw = router.query.invoice;
    if (typeof raw === "string" && raw) {
      setSelectedId(raw);
    }
  }, [router.query.invoice]);

  const refresh = useCallback(() => {
    setInvoices(loadInvoices());
  }, []);

  const selected = useMemo(
    () => invoices.find((inv) => inv.id === selectedId) ?? null,
    [invoices, selectedId],
  );

  const summary = useMemo(() => summarizeInvoices(invoices), [invoices]);

  const visible = useMemo(() => {
    if (filter === "all") return invoices;
    return invoices.filter((inv) => inv.status === filter);
  }, [invoices, filter]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: invoices.length,
      draft: 0,
      sent: 0,
      paid: 0,
      overdue: 0,
    };
    for (const inv of invoices) c[inv.status] += 1;
    return c;
  }, [invoices]);

  const handleReminder = (invoice: Invoice) => {
    sendInvoiceReminder(invoice);
    addToast(t("invoices.reminderSent"), "success");
    refresh();
  };

  const handleDownload = async (id: string) => {
    const inv = invoices.find((x) => x.id === id);
    if (!inv) return;
    try {
      const { generateInvoicePDF } = await import("@/lib/invoices");
      await generateInvoicePDF(inv);
    } catch {
      addToast(t("invoices.downloadFailed"), "error");
    }
  };

  const handleOpen = (id: string) => {
    setSelectedId(id);
    // Keep the URL in sync so the detail is deep-linkable / shareable.
    void router.replace({ query: { ...router.query, invoice: id } }, undefined, {
      shallow: true,
    });
  };

  const handleClose = () => {
    setSelectedId(null);
    const q = { ...router.query };
    delete q.invoice;
    void router.replace({ query: q }, undefined, { shallow: true });
  };

  const statCards = [
    {
      label: t("invoices.statOutstanding"),
      value: formatAsset(summary.outstanding, "XLM"),
      className:
        "from-amber-500/10 to-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400",
    },
    {
      label: t("invoices.statPaid"),
      value: formatAsset(summary.byStatus.paid, "XLM"),
      className:
        "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: t("invoices.statTotal"),
      value: formatAsset(summary.total, "XLM"),
      className:
        "from-stellar-500/10 to-stellar-500/5 border-stellar-500/20 text-stellar-600 dark:text-stellar-400",
    },
  ];

  return (
    <>
      <Head>
        <title>{t("invoices.title")} — Finchippay</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-8 dark:from-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                {t("invoices.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("invoices.subtitle")}
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-stellar-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-stellar-500/30 transition-colors hover:bg-stellar-700 min-h-[44px]"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {t("invoices.createNew")}
            </button>
          </div>

          {/* Summary cards */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`rounded-2xl border bg-gradient-to-br p-5 ${card.className}`}
              >
                <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
                  {card.label}
                </p>
                <p className="mt-2 text-2xl font-black">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label={t("invoices.filters")}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors min-h-[36px] ${
                  filter === f.key
                    ? "bg-stellar-600 text-white shadow-lg shadow-stellar-500/30"
                    : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {t(f.label)}
                <span className="ml-2 text-xs opacity-70">({counts[f.key]})</span>
              </button>
            ))}
          </div>

          {/* List */}
          {!loaded ? (
            <p className="py-16 text-center text-slate-400">{t("invoices.loading")}</p>
          ) : visible.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 py-16 text-center dark:border-slate-700 dark:bg-slate-900/40">
              <svg
                className="mx-auto mb-4 h-12 w-12 text-slate-300 dark:text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="font-medium text-slate-500 dark:text-slate-400">
                {filter === "all"
                  ? t("invoices.empty")
                  : t("invoices.emptyFilter")}
              </p>
              {filter === "all" && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-4 text-sm font-semibold text-stellar-600 hover:underline dark:text-stellar-400"
                >
                  {t("invoices.createFirst")}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visible.map((inv) => (
                <InvoiceCard
                  key={inv.id}
                  invoice={inv}
                  onView={handleOpen}
                  onDownload={handleDownload}
                  onReminder={handleReminder}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      <InvoiceModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          refresh();
          addToast(t("invoices.created"), "success");
        }}
      />

      {/* Detail overlay (deep-linked) */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:py-10"
            onClick={handleClose}
          >
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl">
              <InvoiceDetail
                invoice={selected}
                onClose={handleClose}
                onUpdate={refresh}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
