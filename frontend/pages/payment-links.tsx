/**
 * pages/payment-links.tsx
 * Payment Links Management Dashboard — list all created payment links with
 * status, disable/re-enable, QR re-display, copy, and analytics.
 */
import clsx from "clsx";
import Head from "next/head";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState, useEffect } from "react";
import PaymentLinkAnalytics from "@/components/PaymentLinkAnalytics";
import {
  listPaymentLinks,
  disablePaymentLink,
  enablePaymentLink,
  type PaymentLinkRecord,
} from "@/lib/paymentLinks";
import { formatAsset, shortenAddress } from "@/utils/format";

type Filter = "all" | "active" | "disabled" | "expired" | "redeemed";

const STATUS_STYLES: Record<PaymentLinkRecord["status"], string> = {
  pending: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  redeemed: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  expired: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  disabled: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
};

const STATUS_LABEL: Record<PaymentLinkRecord["status"], string> = {
  pending: "Active",
  redeemed: "Redeemed",
  expired: "Expired",
  disabled: "Disabled",
};

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<PaymentLinkRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = () => setLinks(listPaymentLinks());

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return links;
    return links.filter((l) => l.status === filter);
  }, [links, filter]);

  const counts = useMemo(() => {
    const active = links.filter((l) => l.status === "pending").length;
    const disabled = links.filter((l) => l.status === "disabled").length;
    const redeemed = links.filter((l) => l.status === "redeemed").length;
    const expired = links.filter((l) => l.status === "expired").length;
    return { active, disabled, redeemed, expired };
  }, [links]);

  const handleToggle = (id: string, status: PaymentLinkRecord["status"]) => {
    if (status === "disabled") {
      enablePaymentLink(id);
    } else {
      disablePaymentLink(id);
    }
    refresh();
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore clipboard errors
    }
  };

  const tabs: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active", count: counts.active },
    { key: "redeemed", label: "Redeemed", count: counts.redeemed },
    { key: "disabled", label: "Disabled", count: counts.disabled },
    { key: "expired", label: "Expired", count: counts.expired },
  ];

  return (
    <>
      <Head>
        <title>Payment Links — Finchippay</title>
        <meta
          name="description"
          content="Manage your Finchippay payment links — view status, disable, and track analytics."
        />
      </Head>

      <div className="max-w-5xl mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Payment Links
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Manage and analyze the payment links you have created.
          </p>
        </header>

        <div className="space-y-6">
          <PaymentLinkAnalytics links={links} />

          {/* Filter tabs */}
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Filter payment links by status"
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={filter === tab.key}
                onClick={() => setFilter(tab.key)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                  filter === tab.key
                    ? "bg-stellar-400 text-black border-stellar-400"
                    : "border-white/10 bg-white/[0.03] text-slate-600 dark:text-slate-300 hover:bg-white/[0.06]",
                )}
              >
                {tab.label}
                {tab.count !== undefined ? (
                  <span className="ml-1.5 opacity-70">({tab.count})</span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Link list */}
          {filtered.length === 0 ? (
            <div className="card border-stellar-400/20 p-10 text-center">
              <p className="text-3xl mb-3">🔗</p>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                {links.length === 0
                  ? "No payment links yet"
                  : "No links in this view"}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                {links.length === 0
                  ? "Create a payment link from the dashboard to see it here."
                  : "Try a different filter to see your payment links."}
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {filtered.map((link) => (
                <PaymentLinkRow
                  key={link.id}
                  link={link}
                  expanded={expandedId === link.id}
                  onToggleExpand={() =>
                    setExpandedId(expandedId === link.id ? null : link.id)
                  }
                  onToggleStatus={() => handleToggle(link.id, link.status)}
                  onCopy={() => copyLink(link.url)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

interface PaymentLinkRowProps {
  link: PaymentLinkRecord;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleStatus: () => void;
  onCopy: () => void;
}

function PaymentLinkRow({
  link,
  expanded,
  onToggleExpand,
  onToggleStatus,
  onCopy,
}: PaymentLinkRowProps) {
  const canDisable = link.status === "pending";
  const canEnable = link.status === "disabled";
  const amount = formatAsset(link.payload.amount);
  const viewCount = link.viewCount ?? 0;
  const paymentCount = link.paymentCount ?? 0;
  const totalCollected = formatAsset(link.totalCollected ?? 0);

  return (
    <li className="card border-stellar-400/20 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={clsx(
                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
                STATUS_STYLES[link.status],
              )}
            >
              {STATUS_LABEL[link.status]}
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {amount}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {link.payload.memo ? `${link.payload.memo} · ` : ""}
            To: {shortenAddress(link.payload.destination)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Created {new Date(link.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right text-xs text-slate-500 dark:text-slate-400 mr-1">
            <p>{viewCount} views</p>
            <p>{paymentCount} paid</p>
            <p className="text-slate-700 dark:text-slate-200 font-medium">
              {totalCollected} collected
            </p>
          </div>
          <button
            onClick={onCopy}
            className="btn-secondary px-3 py-1.5 text-xs"
            aria-label={`Copy payment link ${amount}`}
          >
            Copy
          </button>
          <button
            onClick={onToggleExpand}
            className="btn-secondary px-3 py-1.5 text-xs"
            aria-expanded={expanded}
            aria-controls={`link-detail-${link.id}`}
          >
            {expanded ? "Hide" : "QR"}
          </button>
          {(canDisable || canEnable) && (
            <button
              onClick={onToggleStatus}
              className={clsx(
                "px-3 py-1.5 text-xs rounded-lg font-medium border transition-colors",
                canEnable
                  ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                  : "border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10",
              )}
            >
              {canEnable ? "Enable" : "Disable"}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          id={`link-detail-${link.id}`}
          className="mt-4 pt-4 border-t border-white/10 flex flex-col items-center gap-3 sm:flex-row sm:items-start"
        >
          <div className="bg-white p-3 rounded-lg w-fit">
            <QRCodeSVG value={link.url} size={132} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">
              Link URL
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-300 break-all mb-3">
              {link.url}
            </p>
            <button onClick={onCopy} className="btn-primary px-3 py-1.5 text-xs">
              Copy link URL
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
