/**
 * components/PriceAlertForm.tsx
 *
 * Form for creating a new price alert on a Stellar asset.
 *
 * Acceptance criteria covered:
 * ✓ Asset selector (XLM, USDC, custom)
 * ✓ Condition selector (above / below)
 * ✓ Threshold price input
 * ✓ Notification preference (browser / in-app / both)
 * ✓ Requests Notification.requestPermission() on first browser-alert creation
 */

import clsx from "clsx";
import { useState } from "react";
import {
  createAlert,
  requestNotificationPermission,
  type AlertAsset,
  type AlertCondition,
  type NotificationPreference,
  type PriceAlert,
} from "@/lib/priceAlerts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceAlertFormProps {
  onAlertCreated: (alert: PriceAlert) => void;
  onCancel: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_ASSETS: AlertAsset[] = ["XLM", "USDC"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PriceAlertForm({ onAlertCreated, onCancel }: PriceAlertFormProps) {
  const [asset, setAsset] = useState<AlertAsset>("XLM");
  const [customAsset, setCustomAsset] = useState("");
  const [condition, setCondition] = useState<AlertCondition>("below");
  const [threshold, setThreshold] = useState("");
  const [notificationPreference, setNotificationPreference] =
    useState<NotificationPreference>("both");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resolvedAsset = asset === "custom" ? customAsset.trim().toUpperCase() : asset;

  const validate = (): string | null => {
    if (!resolvedAsset) return "Please enter an asset code.";
    if (resolvedAsset.length > 12) return "Asset code must be 12 characters or fewer.";
    const price = parseFloat(threshold);
    if (isNaN(price) || price <= 0) return "Enter a valid positive threshold price.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      // Request notification permission when the user wants browser alerts.
      if (
        notificationPreference === "browser" ||
        notificationPreference === "both"
      ) {
        const granted = await requestNotificationPermission();
        if (!granted && notificationPreference === "browser") {
          // Downgrade to in-app if the user denied permission.
          setNotificationPreference("in-app");
        }
      }

      const alert = createAlert({
        asset: resolvedAsset,
        condition,
        threshold: parseFloat(threshold),
        notificationPreference:
          notificationPreference === "browser" &&
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission !== "granted"
            ? "in-app"
            : notificationPreference,
      });

      onAlertCreated(alert);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="price-alert-form"
      aria-label="New price alert"
    >
      {/* ── Asset selector ── */}
      <div>
        <label className="label mb-1 block" htmlFor="alert-asset">
          Asset
        </label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_ASSETS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAsset(a)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                asset === a
                  ? "bg-stellar-500/15 border-stellar-500/40 text-stellar-700 dark:text-stellar-300"
                  : "bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              )}
              data-testid={`asset-btn-${a}`}
            >
              {a}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAsset("custom")}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
              asset === "custom"
                ? "bg-stellar-500/15 border-stellar-500/40 text-stellar-700 dark:text-stellar-300"
                : "bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
            )}
            data-testid="asset-btn-custom"
          >
            Custom…
          </button>
        </div>
        {asset === "custom" && (
          <input
            id="alert-custom-asset"
            type="text"
            value={customAsset}
            onChange={(e) => setCustomAsset(e.target.value)}
            placeholder="e.g. yXLM"
            maxLength={12}
            className="mt-2 input w-full"
            data-testid="custom-asset-input"
            aria-label="Custom asset code"
          />
        )}
      </div>

      {/* ── Condition selector ── */}
      <div>
        <label className="label mb-1 block" htmlFor="alert-condition">
          Condition
        </label>
        <div className="flex gap-2">
          {(["below", "above"] as AlertCondition[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCondition(c)}
              className={clsx(
                "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
                condition === c
                  ? c === "below"
                    ? "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300"
                    : "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  : "bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              )}
              data-testid={`condition-btn-${c}`}
            >
              {c === "below" ? "↓ Below" : "↑ Above"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Threshold price ── */}
      <div>
        <label className="label mb-1 block" htmlFor="alert-threshold">
          Threshold price (USD)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm select-none pointer-events-none">
            $
          </span>
          <input
            id="alert-threshold"
            type="number"
            step="any"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="0.00"
            className="input w-full pl-7"
            data-testid="threshold-input"
            aria-label="Threshold price in USD"
          />
        </div>
      </div>

      {/* ── Notification preference ── */}
      <div>
        <label className="label mb-1 block" htmlFor="alert-notification">
          Notification
        </label>
        <select
          id="alert-notification"
          value={notificationPreference}
          onChange={(e) =>
            setNotificationPreference(e.target.value as NotificationPreference)
          }
          className="input w-full"
          data-testid="notification-select"
        >
          <option value="both">Browser + In-app</option>
          <option value="browser">Browser only</option>
          <option value="in-app">In-app only</option>
        </select>
      </div>

      {/* ── Preview ── */}
      {resolvedAsset && threshold && parseFloat(threshold) > 0 && (
        <p
          className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2 border border-slate-200 dark:border-white/10"
          data-testid="alert-preview"
        >
          Alert when{" "}
          <span className="font-semibold text-slate-900 dark:text-white">
            {resolvedAsset}
          </span>{" "}
          is{" "}
          <span
            className={clsx(
              "font-semibold",
              condition === "below"
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {condition}
          </span>{" "}
          <span className="font-semibold text-slate-900 dark:text-white">
            ${parseFloat(threshold).toFixed(6)}
          </span>
        </p>
      )}

      {/* ── Error message ── */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert" data-testid="form-error">
          {error}
        </p>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary flex-1 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          data-testid="submit-alert-btn"
        >
          {submitting ? "Creating…" : "Create Alert"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary flex-1 py-2 text-sm"
          data-testid="cancel-alert-btn"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
