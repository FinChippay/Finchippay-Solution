/**
 * components/PriceAlertsPanel.tsx
 *
 * Dashboard panel that shows:
 * - Active price alerts (pending, waiting for threshold)
 * - Recently triggered alerts (history)
 * - Inline button to open PriceAlertForm
 * - Starts the polling engine while mounted
 *
 * Acceptance criteria covered:
 * ✓ Alert history visible
 * ✓ Active alerts listed
 * ✓ Polling worker started on mount
 * ✓ In-app bubble on trigger (via onTriggered prop)
 */

import clsx from "clsx";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import {
  loadAlerts,
  deleteAlert,
  startPriceAlertPoller,
  type PriceAlert,
} from "@/lib/priceAlerts";

// Lazy-load the form to keep initial bundle small.
const PriceAlertForm = dynamic(() => import("./PriceAlertForm"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceAlertsPanelProps {
  /** Called when an alert is triggered (for in-app notification bubble). */
  onTriggered?: (alert: PriceAlert, priceUsd: number) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlertRow({
  alert,
  onDelete,
}: {
  alert: PriceAlert;
  onDelete: (id: string) => void;
}) {
  const conditionColor =
    alert.condition === "below"
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border text-sm",
        alert.active
          ? "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10"
          : "bg-slate-50 dark:bg-white/[0.02] border-slate-100 dark:border-white/5 opacity-70"
      )}
      data-testid="alert-row"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-slate-900 dark:text-white">
            {alert.asset}
          </span>
          <span className={clsx("font-medium", conditionColor)}>
            {alert.condition}
          </span>
          <span className="text-slate-700 dark:text-slate-300">
            ${alert.threshold.toFixed(alert.threshold < 1 ? 6 : 4)}
          </span>
          {!alert.active && alert.triggeredPrice !== null && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">
              — triggered @ ${alert.triggeredPrice.toFixed(alert.triggeredPrice < 1 ? 6 : 4)}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {alert.active ? (
            <>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1"
                aria-hidden="true"
              />
              Active · Created {formatDate(alert.createdAt)}
            </>
          ) : (
            <>
              Triggered {alert.triggeredAt ? formatDate(alert.triggeredAt) : "–"}
            </>
          )}
        </div>
      </div>

      <button
        onClick={() => onDelete(alert.id)}
        aria-label={`Delete alert for ${alert.asset} ${alert.condition} $${alert.threshold}`}
        className="flex-shrink-0 p-1.5 rounded-md text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
        data-testid="delete-alert-btn"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PriceAlertsPanel({ onTriggered }: PriceAlertsPanelProps) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [showForm, setShowForm] = useState(false);

  /** Reload alerts from localStorage. */
  const refresh = useCallback(() => {
    setAlerts(loadAlerts());
  }, []);

  // Initial load.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Start the price poller.
  useEffect(() => {
    const stop = startPriceAlertPoller((triggered, priceUsd) => {
      refresh();
      onTriggered?.(triggered, priceUsd);
    });
    return stop;
  }, [refresh, onTriggered]);

  const handleAlertCreated = (alert: PriceAlert) => {
    refresh();
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    deleteAlert(id);
    refresh();
  };

  const activeAlerts = alerts.filter((a) => a.active);
  const triggeredAlerts = alerts.filter((a) => !a.active);

  return (
    <section
      className="card mb-6 border-stellar-500/20"
      data-testid="price-alerts-panel"
      aria-label="Price Alerts"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          {/* Bell icon */}
          <svg
            className="w-5 h-5 text-stellar-700 dark:text-stellar-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          Price Alerts
          {activeAlerts.length > 0 && (
            <span
              className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1 rounded-full bg-stellar-500 text-white text-xs font-bold"
              data-testid="active-alert-count-badge"
            >
              {activeAlerts.length}
            </span>
          )}
        </h2>

        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm font-medium text-stellar-700 dark:text-stellar-400 hover:text-stellar-600 dark:hover:text-stellar-300 transition-colors flex items-center gap-1"
            data-testid="new-alert-btn"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New alert
          </button>
        )}
      </div>

      {/* ── Form (inline) ── */}
      {showForm && (
        <div className="mb-4 p-4 rounded-xl border border-stellar-500/20 bg-stellar-500/5">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-3 text-sm">
            New price alert
          </h3>
          <PriceAlertForm
            onAlertCreated={handleAlertCreated}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* ── Active alerts ── */}
      {activeAlerts.length > 0 ? (
        <div className="space-y-2 mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Active
          </p>
          {activeAlerts.map((a) => (
            <AlertRow key={a.id} alert={a} onDelete={handleDelete} />
          ))}
        </div>
      ) : !showForm ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
          No active alerts.{" "}
          <button
            onClick={() => setShowForm(true)}
            className="text-stellar-700 dark:text-stellar-400 hover:underline"
            data-testid="no-alerts-cta"
          >
            Create one
          </button>{" "}
          to get notified when a price threshold is crossed.
        </p>
      ) : null}

      {/* ── History ── */}
      {triggeredAlerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            History
          </p>
          {triggeredAlerts.slice(0, 5).map((a) => (
            <AlertRow key={a.id} alert={a} onDelete={handleDelete} />
          ))}
          {triggeredAlerts.length > 5 && (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center pt-1">
              +{triggeredAlerts.length - 5} more triggered alerts removed for brevity
            </p>
          )}
        </div>
      )}
    </section>
  );
}
