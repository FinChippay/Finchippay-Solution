/**

 * components/admin/RateLimitRuleEditor.tsx
 * Table component for managing rate limit rules with toggles and test buttons.
 */

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { logger } from "@/lib/logger";

interface RateLimitRule {
  id: number;
  route: string;
  method: string;
  limit: number;
  window_ms: number;
  enabled: boolean;
}

interface RateLimitRuleEditorProps {
  rules: RateLimitRule[];
  onUpdate: () => void;
}

export default function RateLimitRuleEditor({ rules, onUpdate }: RateLimitRuleEditorProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<RateLimitRule>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

  const handleEdit = (rule: RateLimitRule) => {
    setEditingId(rule.id);
    setEditValues({
      limit: rule.limit,
      window_ms: rule.window_ms,
      enabled: rule.enabled,
    });
  };

  const handleSave = async (rule: RateLimitRule) => {
    setSaving(true);
    try {
      const res = await apiFetch(`${apiBase}/api/admin/rate-limits`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, ...editValues }),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      setEditingId(null);
      onUpdate();
    } catch (err) {
      logger.error("Failed to update rule:", {}, err instanceof Error ? err : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (rule: RateLimitRule) => {
    setTestResult(`Testing ${rule.method} ${rule.route}...`);
    try {
      const res = await apiFetch(`${apiBase}/api/admin/rate-limits/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: rule.method,
          route: rule.route,
          limit: rule.limit,
          windowMs: rule.window_ms,
        }),
      });
      const data = await res.json();
      setTestResult(
        `Test: ${data.result.wouldBlock ? "Would BLOCK" : "Would ALLOW"} (${rule.limit} req / ${rule.window_ms / 1000}s)`,
      );
      setTimeout(() => setTestResult(null), 3000);
    } catch (err) {
      setTestResult("Test failed");
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-cosmos-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Route</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Method</th>
              <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Limit</th>
              <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Window</th>
              <th className="px-4 py-3 text-center font-medium text-slate-500 dark:text-slate-400">Enabled</th>
              <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-cosmos-900/50 transition-colors">
                <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">{rule.route}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{rule.method}</td>
                <td className="px-4 py-3 text-right">
                  {editingId === rule.id ? (
                    <input
                      type="number"
                      value={editValues.limit || ""}
                      onChange={(e) =>
                        setEditValues({ ...editValues, limit: parseInt(e.target.value, 10) })
                      }
                      className="w-20 px-2 py-1 text-right rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                  ) : (
                    <span className="text-slate-700 dark:text-slate-300">{rule.limit}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {editingId === rule.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        value={(editValues.window_ms || 60000) / 1000}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            window_ms: parseInt(e.target.value, 10) * 1000,
                          })
                        }
                        className="w-16 px-2 py-1 text-right rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                      />
                      <span className="text-xs text-slate-400">s</span>
                    </div>
                  ) : (
                    <span className="text-slate-700 dark:text-slate-300">
                      {rule.window_ms / 1000}s
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {editingId === rule.id ? (
                    <button
                      onClick={() =>
                        setEditValues({ ...editValues, enabled: !editValues.enabled })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        editValues.enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          editValues.enabled ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  ) : (
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        rule.enabled ? "bg-emerald-400" : "bg-slate-300 dark:bg-slate-600"
                      }`}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleTest(rule)}
                      className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Test
                    </button>
                    {editingId === rule.id ? (
                      <>
                        <button
                          onClick={() => handleSave(rule)}
                          disabled={saving}
                          className="px-2 py-1 text-xs rounded bg-stellar-500 text-white hover:bg-stellar-600 disabled:opacity-60"
                        >
                          {saving ? "..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleEdit(rule)}
                        className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {testResult && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 text-sm">
          {testResult}
        </div>
      )}
    </div>
  );
}
