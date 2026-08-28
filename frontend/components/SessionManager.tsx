/**

 * components/SessionManager.tsx
 * Session management component for viewing and revoking active sessions (#488).
 */

import React, { useEffect, useState, useCallback } from "react";
import { getSessions, revokeSession, revokeAllSessions, SessionInfo } from "@/lib/auth";
import { logger } from "@/lib/logger";

export default function SessionManager() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | string | null>(null);

  const fetchSessions = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (err) {
      logger.error("Failed to load sessions:", {}, err instanceof Error ? err : undefined);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevokeOne = async (id: number) => {
    setActionLoading(id);
    try {
      const success = await revokeSession(id);
      if (success) await fetchSessions(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeAll = async () => {
    setActionLoading("all");
    try {
      const success = await revokeAllSessions();
      if (success) await fetchSessions(false);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Active Sessions
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            View and manage active login sessions across your devices.
          </p>
        </div>
        {sessions.length > 0 && (
          <button
            onClick={handleRevokeAll}
            disabled={actionLoading === "all"}
            className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
          >
            {actionLoading === "all" ? "Revoking All..." : "Revoke All Other Sessions"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-4 animate-pulse">
          Loading active sessions...
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
          No active sessions found.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="py-3 flex items-center justify-between first:pt-0 last:pb-0"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {session.deviceInfo || "Unknown Device"}
                </p>
                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  {session.ipAddress && <span>IP: {session.ipAddress}</span>}
                  <span>
                    Created: {new Date(session.createdAt).toLocaleDateString()}
                  </span>
                  {session.lastUsedAt && (
                    <span>
                      Last active: {new Date(session.lastUsedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleRevokeOne(session.id)}
                disabled={actionLoading === session.id}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 border border-slate-200 dark:border-slate-700 rounded hover:border-red-200 dark:hover:border-red-800 transition-colors disabled:opacity-50"
              >
                {actionLoading === session.id ? "Revoking..." : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
