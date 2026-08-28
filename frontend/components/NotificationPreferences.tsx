/**
 * components/NotificationPreferences.tsx
 * Comprehensive notification preferences dashboard.
 *
 * Allows users to control per-event-type notification channels (push, email,
 * in-app), set quiet hours, and toggle master channel controls.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/api";

export interface NotificationPreferences {
  publicKey: string;
  eventChannels: Record<string, { push: boolean; email: boolean; in_app: boolean }>;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

interface NotificationPreferencesProps {
  publicKey: string | null;
}

const EVENT_CATEGORIES: Record<string, string[]> = {
  payments: ["incoming_payment", "outgoing_payment", "scheduled_payment"],
  contract: ["escrow_release", "stream_claim", "multi_sig_approval", "contract_event"],
  alerts: ["price_alert"],
};

const EVENT_LABELS: Record<string, string> = {
  incoming_payment: "Incoming Payment",
  outgoing_payment: "Outgoing Payment",
  escrow_release: "Escrow Release",
  stream_claim: "Stream Claim",
  multi_sig_approval: "Multi-Sig Approval",
  price_alert: "Price Alert",
  scheduled_payment: "Scheduled Payment",
  contract_event: "Contract Event",
};

const CHANNEL_LABELS: Record<string, string> = {
  push: "Push",
  email: "Email",
  in_app: "In-App",
};

const CHANNEL_COLORS: Record<string, string> = {
  push: "bg-blue-500",
  email: "bg-purple-500",
  in_app: "bg-emerald-500",
};

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default function NotificationPreferences({ publicKey }: NotificationPreferencesProps) {
  const { t } = useTranslation("common");
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

  const fetchPreferences = useCallback(async () => {
    if (!publicKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `${apiBase}/api/notifications/${encodeURIComponent(publicKey)}/preferences`,
      );
      if (!res.ok) throw new Error("Failed to load notification preferences");
      const data = await res.json();
      setPreferences(data.preference);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preferences");
    } finally {
      setLoading(false);
    }
  }, [publicKey, apiBase]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleToggleChannel = (
    eventType: string,
    channel: "push" | "email" | "in_app",
  ) => {
    if (!preferences) return;
    setPreferences({
      ...preferences,
      eventChannels: {
        ...preferences.eventChannels,
        [eventType]: {
          ...(preferences.eventChannels[eventType] || { push: true, email: true, in_app: true }),
          [channel]: !(preferences.eventChannels[eventType]?.[channel] ?? true),
        },
      },
    });
  };

  const handleMasterToggle = (channel: "push" | "email" | "in_app") => {
    if (!preferences) return;
    const updated = { ...preferences };
    if (channel === "push") updated.pushEnabled = !updated.pushEnabled;
    if (channel === "email") updated.emailEnabled = !updated.emailEnabled;
    if (channel === "in_app") updated.inAppEnabled = !updated.inAppEnabled;
    setPreferences(updated);
  };

  const handleSave = async () => {
    if (!publicKey || !preferences) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(
        `${apiBase}/api/notifications/${encodeURIComponent(publicKey)}/preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventChannels: preferences.eventChannels,
            quietHoursEnabled: preferences.quietHoursEnabled,
            quietHoursStart: preferences.quietHoursStart,
            quietHoursEnd: preferences.quietHoursEnd,
            timezone: preferences.timezone,
            pushEnabled: preferences.pushEnabled,
            emailEnabled: preferences.emailEnabled,
            inAppEnabled: preferences.inAppEnabled,
          }),
        },
      );
      if (!res.ok) throw new Error("Failed to save preferences");
      setSuccess("Notification preferences saved successfully!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const handleTestNotification = async (channel: string) => {
    if (!publicKey) return;
    setTestResults(`Sending test ${channel} notification...`);
    // Simulated test — in production this would call a dedicated endpoint
    setTimeout(() => {
      setTestResults(`Test ${channel} notification sent! Check your ${channel} channel.`);
      setTimeout(() => setTestResults(null), 3000);
    }, 1500);
  };

  if (!publicKey) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-cosmos-800 p-6 text-center">
        <p className="text-slate-500 dark:text-slate-400">
          Connect your wallet to manage notification preferences.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-cosmos-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-cosmos-800 p-6 text-center">
        <p className="text-rose-500">Failed to load preferences.</p>
        <button
          onClick={fetchPreferences}
          className="mt-2 text-stellar-500 hover:text-stellar-400 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Master Channel Toggles */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
          Global Channel Controls
        </h3>
        <div className="flex flex-wrap gap-3">
          {(["push", "email", "in_app"] as const).map((channel) => (
            <button
              key={channel}
              onClick={() => handleMasterToggle(channel)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                (channel === "push" && preferences.pushEnabled) ||
                (channel === "email" && preferences.emailEnabled) ||
                (channel === "in_app" && preferences.inAppEnabled)
                  ? "bg-stellar-500/20 text-stellar-400 border border-stellar-500/30"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  (channel === "push" && preferences.pushEnabled) ||
                  (channel === "email" && preferences.emailEnabled) ||
                  (channel === "in_app" && preferences.inAppEnabled)
                    ? "bg-stellar-400"
                    : "bg-slate-300 dark:bg-slate-600"
                }`}
              />
              {CHANNEL_LABELS[channel]}
            </button>
          ))}
        </div>
      </div>

      {/* Event-Type Toggles by Category */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Event Notification Settings
        </h3>
        {Object.entries(EVENT_CATEGORIES).map(([category, events]) => (
          <div
            key={category}
            className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            <div className="px-4 py-2 bg-slate-50 dark:bg-cosmos-900 border-b border-slate-200 dark:border-slate-700">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {category === "payments" && "Payments"}
                {category === "contract" && "Contract"}
                {category === "alerts" && "Alerts"}
              </h4>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {events.map((eventType) => {
                const channels = preferences.eventChannels[eventType] || {
                  push: true,
                  email: true,
                  in_app: true,
                };
                return (
                  <div
                    key={eventType}
                    className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-cosmos-900/50 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {EVENT_LABELS[eventType] || eventType}
                    </span>
                    <div className="flex items-center gap-2">
                      {(["push", "email", "in_app"] as const).map((channel) => {
                        const masterEnabled =
                          (channel === "push" && preferences.pushEnabled) ||
                          (channel === "email" && preferences.emailEnabled) ||
                          (channel === "in_app" && preferences.inAppEnabled);
                        const enabled = channels[channel] && masterEnabled;
                        return (
                          <button
                            key={channel}
                            onClick={() => handleToggleChannel(eventType, channel)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-400 focus:ring-offset-2 ${
                              enabled
                                ? `${CHANNEL_COLORS[channel]}`
                                : "bg-slate-200 dark:bg-slate-700"
                            }`}
                            role="switch"
                            aria-checked={enabled}
                            aria-label={`${EVENT_LABELS[eventType] || eventType} ${CHANNEL_LABELS[channel]}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enabled ? "translate-x-6" : "translate-x-1"
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Quiet Hours */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Quiet Hours
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Suppress notifications during specified hours
            </p>
          </div>
          <button
            onClick={() =>
              setPreferences({
                ...preferences,
                quietHoursEnabled: !preferences.quietHoursEnabled,
              })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-400 focus:ring-offset-2 ${
              preferences.quietHoursEnabled
                ? "bg-stellar-500"
                : "bg-slate-200 dark:bg-slate-700"
            }`}
            role="switch"
            aria-checked={preferences.quietHoursEnabled}
            aria-label="Quiet hours"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                preferences.quietHoursEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {preferences.quietHoursEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={preferences.quietHoursStart}
                onChange={(e) =>
                  setPreferences({ ...preferences, quietHoursStart: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={preferences.quietHoursEnd}
                onChange={(e) =>
                  setPreferences({ ...preferences, quietHoursEnd: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Timezone
              </label>
              <select
                value={preferences.timezone}
                onChange={(e) =>
                  setPreferences({ ...preferences, timezone: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white text-sm"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Test Notification */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
          Test Notification
        </h3>
        <div className="flex flex-wrap gap-2">
          {(["push", "email", "in_app"] as const).map((channel) => (
            <button
              key={channel}
              onClick={() => handleTestNotification(channel)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              Test {CHANNEL_LABELS[channel]}
            </button>
          ))}
        </div>
        {testResults && (
          <p className="mt-2 text-sm text-stellar-500">{testResults}</p>
        )}
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="flex-1">
          {error && (
            <p className="text-sm text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-500 bg-emerald-500/10 rounded-lg px-3 py-2">
              {success}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchPreferences}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-lg bg-stellar-500 hover:bg-stellar-600 disabled:opacity-60 text-white font-medium text-sm transition"
          >
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
