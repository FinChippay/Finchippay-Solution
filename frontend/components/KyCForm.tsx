/**
 * components/KyCForm.tsx
 * SEP-12 KYC form for submitting identity information to a Stellar anchor.
 *
 * Supported fields: first name, last name, email, date of birth, address, country.
 * Displays a status badge (ACCEPTED / PROCESSING / NEEDS_INFO / REJECTED / NONE).
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getJwtToken } from "@/lib/auth";

interface KyCFormProps {
  publicKey: string | null;
}

interface KyCFields {
  first_name: string;
  last_name: string;
  email_address: string;
  date_of_birth: string;
  address: string;
  country: string;
}

type KycStatus = "NONE" | "NEEDS_INFO" | "PROCESSING" | "ACCEPTED" | "REJECTED";

const STATUS_STYLES: Record<KycStatus, { bg: string; text: string; label: string }> = {
  NONE: {
    bg: "bg-slate-100 dark:bg-slate-700",
    text: "text-slate-500 dark:text-slate-400",
    label: "Not Submitted",
  },
  NEEDS_INFO: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-400",
    label: "Needs Info",
  },
  PROCESSING: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-400",
    label: "Processing",
  },
  ACCEPTED: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-400",
    label: "Accepted",
  },
  REJECTED: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-400",
    label: "Rejected",
  },
};

const ANCHOR_NAME = "anchorusd_testnet";

export default function KyCForm({ publicKey }: KyCFormProps) {
  const { t } = useTranslation("common");

  const [fields, setFields] = useState<KyCFields>({
    first_name: "",
    last_name: "",
    email_address: "",
    date_of_birth: "",
    address: "",
    country: "",
  });

  const [status, setStatus] = useState<KycStatus>("NONE");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ─── Fetch current KYC status on mount ─────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    if (!publicKey) return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
    const token = getJwtToken();
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${apiBase}/api/sep12/customer/status?anchorName=${encodeURIComponent(ANCHOR_NAME)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (res.ok) {
        const payload = await res.json();
        if (payload?.success) {
          setStatus(payload.data.status || "NONE");
          setMessage(payload.data.message || null);
        }
      }
    } catch {
      // Silently fail — status check is non-blocking
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ─── Field change handler ──────────────────────────────────────────────────

  const handleFieldChange = (key: keyof KyCFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(null);
  };

  // ─── Form submission ───────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey) {
      setError("Connect your wallet before submitting KYC information.");
      return;
    }

    // Basic client-side validation
    const requiredFields: (keyof KyCFields)[] = [
      "first_name",
      "last_name",
      "email_address",
    ];
    for (const key of requiredFields) {
      if (!fields[key].trim()) {
        setError(`${key.replace("_", " ")} is required.`);
        return;
      }
    }

    // Email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(fields.email_address.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
    const token = getJwtToken();

    try {
      // Build fields payload — only include non-empty values
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        const trimmed = value.trim();
        if (trimmed) {
          payload[key] = trimmed;
        }
      }

      const res = await fetch(`${apiBase}/api/sep12/customer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          anchorName: ANCHOR_NAME,
          fields: payload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit KYC information");
      }

      if (data?.success) {
        setStatus(data.data.status || "PROCESSING");
        setMessage(data.data.message || null);
        setSuccess("KYC information submitted successfully!");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit KYC information");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const statusStyle = STATUS_STYLES[status] || STATUS_STYLES.NONE;

  return (
    <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
      {/* Header with status badge */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <svg
              className="w-5 h-5 text-stellar-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            {t("settings.kycTitle", "KYC Verification")}
          </h2>
          <p className="text-sm text-slate-400 dark:text-slate-400 mt-1">
            {t(
              "settings.kycDescription",
              "Verify your identity to enable fiat deposits and withdrawals via Stellar anchors.",
            )}
          </p>
        </div>

        {/* Status badge */}
        {!loading && (
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === "ACCEPTED"
                  ? "bg-emerald-500"
                  : status === "PROCESSING"
                    ? "bg-blue-500 animate-pulse"
                    : status === "REJECTED"
                      ? "bg-red-500"
                      : status === "NEEDS_INFO"
                        ? "bg-amber-500"
                        : "bg-slate-400"
              }`}
            />
            {statusStyle.label}
          </span>
        )}
      </div>

      {/* Message from anchor */}
      {message && (
        <div className="mb-4 p-3 bg-stellar-500/5 border border-stellar-500/10 rounded-lg">
          <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <p className="text-sm text-emerald-400">{success}</p>
        </div>
      )}

      {/* KYC Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* First Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t("settings.kycFirstName", "First Name")} *
            </label>
            <input
              type="text"
              value={fields.first_name}
              onChange={(e) => handleFieldChange("first_name", e.target.value)}
              placeholder="John"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              disabled={submitting}
              maxLength={100}
            />
          </div>

          {/* Last Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t("settings.kycLastName", "Last Name")} *
            </label>
            <input
              type="text"
              value={fields.last_name}
              onChange={(e) => handleFieldChange("last_name", e.target.value)}
              placeholder="Doe"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              disabled={submitting}
              maxLength={100}
            />
          </div>

          {/* Email */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t("settings.kycEmail", "Email Address")} *
            </label>
            <input
              type="email"
              value={fields.email_address}
              onChange={(e) => handleFieldChange("email_address", e.target.value)}
              placeholder="john@example.com"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              disabled={submitting}
              maxLength={200}
            />
          </div>

          {/* Date of Birth */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t("settings.kycDob", "Date of Birth")}
            </label>
            <input
              type="date"
              value={fields.date_of_birth}
              onChange={(e) => handleFieldChange("date_of_birth", e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              disabled={submitting}
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t("settings.kycCountry", "Country")}
            </label>
            <input
              type="text"
              value={fields.country}
              onChange={(e) => handleFieldChange("country", e.target.value)}
              placeholder="United States"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              disabled={submitting}
              maxLength={100}
            />
          </div>

          {/* Address */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t("settings.kycAddress", "Address")}
            </label>
            <input
              type="text"
              value={fields.address}
              onChange={(e) => handleFieldChange("address", e.target.value)}
              placeholder="123 Main St, Apt 4B"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              disabled={submitting}
              maxLength={300}
            />
          </div>
        </div>

        {/* Submit + Refresh buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !publicKey}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-stellar-500 hover:bg-stellar-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t("settings.kycSubmitting", "Submitting…")}
              </>
            ) : (
              t("settings.kycSubmit", "Submit KYC")
            )}
          </button>

          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading || !publicKey}
            className="px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
          >
            {loading ? "Checking…" : t("settings.kycRefresh", "Refresh Status")}
          </button>
        </div>
      </form>
    </div>
  );
}
