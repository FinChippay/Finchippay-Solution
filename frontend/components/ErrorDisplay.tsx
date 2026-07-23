/**
 * components/ErrorDisplay.tsx
 * Consistent error display component for Finchippay Solution.
 *
 * Accepts errorCode, optional details, and renders a styled,
 * accessibility-friendly error message. Supports:
 *   - Warning / error / info severity levels
 *   - Expandable details section
 *   - Retry callback for retryable errors
 *   - "Contact Support" suggestion for support errors
 */

import { useState } from "react";
import clsx from "clsx";
import {
  AlertCircleIcon,
  ExternalLinkIcon,
} from "@/components/icons";
import {
  getErrorMessage,
  isRetryableError,
  isSupportError,
} from "@/lib/errorHandler";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ErrorSeverity = "error" | "warning" | "info";

export interface ErrorDisplayProps {
  /** The error code from the ERROR_CODES registry (e.g. "AUTH_MISSING_TOKEN"). */
  errorCode?: string;
  /** Fallback message when no errorCode is provided or is unknown. */
  message?: string;
  /** Optional structured details to show in the expandable section. */
  details?: unknown;
  /** Severity level — controls colours. Default: "error". */
  severity?: ErrorSeverity;
  /** Called when the user clicks Retry. Only shown for retryable errors. */
  onRetry?: () => void;
  /** Called when the user clicks Dismiss. */
  onDismiss?: () => void;
  /** Additional CSS classes for the wrapper. */
  className?: string;
  /** Show a compact inline variant instead of the full card. */
  compact?: boolean;
}

// ─── Severity styling maps ──────────────────────────────────────────────────

const severityStyles: Record<
  ErrorSeverity,
  { border: string; bg: string; icon: string; text: string; badge: string }
> = {
  error: {
    border: "border-red-500/20",
    bg: "bg-red-950/10",
    icon: "text-red-400",
    text: "text-red-300",
    badge: "bg-red-500/20 text-red-300 border-red-500/30",
  },
  warning: {
    border: "border-amber-500/20",
    bg: "bg-amber-950/10",
    icon: "text-amber-400",
    text: "text-amber-300",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
  info: {
    border: "border-blue-500/20",
    bg: "bg-blue-950/10",
    icon: "text-blue-400",
    text: "text-blue-300",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  },
};

// ─── Format details helper ──────────────────────────────────────────────────

function formatDetails(details: unknown): string {
  if (details === undefined || details === null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ErrorDisplay({
  errorCode,
  message,
  details,
  severity = "error",
  onRetry,
  onDismiss,
  className,
  compact = false,
}: ErrorDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Resolve the error message.
  const resolved = errorCode
    ? getErrorMessage(errorCode, details)
    : null;
  const displayMessage = message || resolved?.message || "An unexpected error occurred.";
  const displayCode = errorCode || resolved?.code || "GEN_UNKNOWN";
  const canRetry = onRetry && isRetryableError(displayCode);
  const showSupport = isSupportError(displayCode);

  const styles = severityStyles[severity];

  if (compact) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className={clsx(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          styles.border,
          styles.bg,
          className,
        )}
      >
        <AlertCircleIcon className={clsx("h-4 w-4 flex-shrink-0", styles.icon)} />
        <span className={clsx("flex-1", styles.text)}>{displayMessage}</span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
            aria-label="Dismiss error"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={clsx(
        "rounded-2xl border p-4 backdrop-blur-md shadow-xl animate-fade-in",
        styles.border,
        styles.bg,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={clsx(
            "flex-shrink-0 rounded-xl p-2",
            severity === "error" && "bg-red-500/10",
            severity === "warning" && "bg-amber-500/10",
            severity === "info" && "bg-blue-500/10",
          )}
        >
          <AlertCircleIcon className={clsx("h-5 w-5", styles.icon)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4
              className={clsx(
                "text-sm font-semibold",
                severity === "error" && "text-red-400",
                severity === "warning" && "text-amber-400",
                severity === "info" && "text-blue-400",
              )}
            >
              {displayCode.replace(/_/g, " ")}
            </h4>
            {displayCode !== "GEN_UNKNOWN" && (
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider",
                  styles.badge,
                )}
              >
                {displayCode}
              </span>
            )}
          </div>

          {/* Message */}
          <p className="mt-1 text-sm text-slate-300 leading-relaxed">
            {displayMessage}
          </p>

          {/* Details toggle */}
          {details != null && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
              >
                <svg
                  className={clsx(
                    "h-3 w-3 transition-transform",
                    showDetails && "rotate-90",
                  )}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                </svg>
                {showDetails ? "Hide details" : "Show details"}
              </button>

              {showDetails && (
                <pre className="mt-2 overflow-auto rounded-lg bg-black/40 border border-white/5 p-3 text-xs font-mono text-slate-400 max-h-40">
                  {formatDetails(details)}
                </pre>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canRetry && (
              <button
                type="button"
                onClick={onRetry}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                  severity === "error" &&
                    "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 active:bg-red-500/30",
                  severity === "warning" &&
                    "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 active:bg-amber-500/30",
                  severity === "info" &&
                    "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 active:bg-blue-500/30",
                )}
              >
                Retry
              </button>
            )}

            {showSupport && (
              <a
                href="https://github.com/FinChippay/Finchippay-Solution/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-white/20 hover:text-white transition-all"
              >
                Contact Support
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-white/20 hover:text-white transition-all ml-auto"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
