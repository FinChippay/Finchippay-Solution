import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { 
  UsersIcon, 
  CurrencyDollarIcon, 
  ExclamationCircleIcon,
  ShieldCheckIcon,
  ServerStackIcon,
  ChartBarIcon
} from "@heroicons/react/24/outline";

// We can define interfaces to match backend response shapes
interface SystemStats {
  totalUsers: number;
  activeUsers24h: number;
  totalTransactions: number;
  totalVolumeXLM: string;
  generatedAt: string;
}

interface ContractStats {
  escrows: number;
  streams: number;
  multisigs: number;
  tips: number;
  batches: number;
  generatedAt: string;
}

interface WebhookHealth {
  totalRegistered: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  deadDeliveries: number;
  successRate: string;
  generatedAt: string;
}

interface ErrorLogEntry {
  timestamp: string;
  level: string;
  code: string;
  message: string;
  correlationId: string | null;
  details: any;
}

interface RecentErrors {
  errors: ErrorLogEntry[];
  total: number;
  generatedAt: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [contractStats, setContractStats] = useState<ContractStats | null>(null);
  const [webhookHealth, setWebhookHealth] = useState<WebhookHealth | null>(null);
  const [recentErrors, setRecentErrors] = useState<RecentErrors | null>(null);

  // Check if we already have an API key in sessionStorage
  useEffect(() => {
    const savedKey = sessionStorage.getItem("admin_api_key");
    if (savedKey) {
      setApiKey(savedKey);
      validateAndFetch(savedKey);
    }
  }, []);

  const validateAndFetch = async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
      const headers = { Authorization: `Bearer ${key}` };

      // Fetch system stats first to validate auth
      const statsRes = await fetch(`${API_URL}/api/admin/stats`, { headers });
      
      if (!statsRes.ok) {
        if (statsRes.status === 401 || statsRes.status === 403) {
          throw new Error("Invalid admin credentials.");
        }
        throw new Error("Failed to load dashboard data.");
      }

      const statsData = await statsRes.json();
      setSystemStats(statsData.data);
      
      // If we got here, we're authenticated
      setIsAuthenticated(true);
      sessionStorage.setItem("admin_api_key", key);

      // Fetch the rest in parallel
      const [contractRes, webhookRes, errorsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/contract-stats`, { headers }),
        fetch(`${API_URL}/api/admin/webhook-health`, { headers }),
        fetch(`${API_URL}/api/admin/recent-errors`, { headers }),
      ]);

      if (contractRes.ok) {
        const d = await contractRes.json();
        setContractStats(d.data);
      }
      if (webhookRes.ok) {
        const d = await webhookRes.json();
        setWebhookHealth(d.data);
      }
      if (errorsRes.ok) {
        const d = await errorsRes.json();
        setRecentErrors(d.data);
      }
    } catch (err: any) {
      setError(err.message || "An error occurred.");
      setIsAuthenticated(false);
      sessionStorage.removeItem("admin_api_key");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;
    validateAndFetch(apiKey);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setApiKey("");
    sessionStorage.removeItem("admin_api_key");
    setSystemStats(null);
    setContractStats(null);
    setWebhookHealth(null);
    setRecentErrors(null);
  };

  // ─── LOGIN VIEW ─────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-cosmos-900 px-4">
        <Head>
          <title>Admin Login - Finchippay Solution</title>
        </Head>
        <div className="max-w-md w-full bg-white dark:bg-cosmos-800 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-stellar-500/30">
          <div className="text-center mb-8">
            <ShieldCheckIcon className="h-12 w-12 mx-auto text-stellar-500 mb-4" />
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Admin Dashboard</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">Enter your admin API key to continue.</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                API Key
              </label>
              <input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_admin_..."
                className="mt-1 block w-full rounded-lg border-slate-300 dark:border-cosmos-700 bg-white dark:bg-cosmos-900 px-4 py-2 text-slate-900 dark:text-white focus:border-stellar-500 focus:ring-stellar-500 transition-colors sm:text-sm"
                required
              />
            </div>
            
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-500/10 p-4 border border-red-200 dark:border-red-500/20">
                <div className="flex">
                  <ExclamationCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800 dark:text-red-400">{error}</h3>
                  </div>
                </div>
              </div>
            )}
            
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-stellar-500 hover:bg-stellar-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stellar-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Authenticating..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── DASHBOARD VIEW ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-cosmos-900 pt-16 pb-12">
      <Head>
        <title>Admin Dashboard - Finchippay Solution</title>
      </Head>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-cosmos-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-stellar-500/20">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheckIcon className="h-6 w-6 text-stellar-500" />
              Admin Dashboard
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">System health, metrics, and logs.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => validateAndFetch(apiKey)}
              disabled={loading}
              className="px-4 py-2 bg-slate-100 dark:bg-cosmos-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-cosmos-600 transition-colors disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh Data"}
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 border border-slate-200 dark:border-cosmos-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-cosmos-800 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Users */}
          <div className="bg-white dark:bg-cosmos-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-stellar-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Users</p>
                <p className="mt-2 text-3xl font-display font-bold text-slate-900 dark:text-white">
                  {systemStats ? systemStats.totalUsers.toLocaleString() : "-"}
                </p>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-xl">
                <UsersIcon className="h-6 w-6 text-blue-500" />
              </div>
            </div>
            <div className="mt-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-medium text-emerald-500">
                  {systemStats ? systemStats.activeUsers24h.toLocaleString() : "-"}
                </span> active (24h)
              </p>
            </div>
          </div>

          {/* Volume */}
          <div className="bg-white dark:bg-cosmos-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-stellar-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Volume</p>
                <p className="mt-2 text-3xl font-display font-bold text-slate-900 dark:text-white truncate">
                  {systemStats ? parseInt(systemStats.totalVolumeXLM).toLocaleString() : "-"}
                </p>
              </div>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl">
                <CurrencyDollarIcon className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
            <div className="mt-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {systemStats ? systemStats.totalTransactions.toLocaleString() : "-"}
                </span> total txs
              </p>
            </div>
          </div>

          {/* Contracts */}
          <div className="bg-white dark:bg-cosmos-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-stellar-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Contract Activity</p>
                <p className="mt-2 text-3xl font-display font-bold text-slate-900 dark:text-white">
                  {contractStats ? (contractStats.escrows + contractStats.streams + contractStats.multisigs).toLocaleString() : "-"}
                </p>
              </div>
              <div className="p-3 bg-purple-50 dark:bg-purple-500/10 rounded-xl">
                <ServerStackIcon className="h-6 w-6 text-purple-500" />
              </div>
            </div>
            <div className="mt-4 flex gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>{contractStats?.escrows || 0} E</span>
              <span>{contractStats?.streams || 0} S</span>
              <span>{contractStats?.multisigs || 0} M</span>
            </div>
          </div>

          {/* Webhooks */}
          <div className="bg-white dark:bg-cosmos-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-stellar-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Delivery Success</p>
                <p className="mt-2 text-3xl font-display font-bold text-slate-900 dark:text-white">
                  {webhookHealth ? `${webhookHealth.successRate}%` : "-"}
                </p>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl">
                <ChartBarIcon className="h-6 w-6 text-amber-500" />
              </div>
            </div>
            <div className="mt-4 flex gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="text-emerald-500">{webhookHealth?.successfulDeliveries || 0} OK</span>
              <span className="text-amber-500">{webhookHealth?.failedDeliveries || 0} Pnd</span>
              <span className="text-red-500">{webhookHealth?.deadDeliveries || 0} Ded</span>
            </div>
          </div>
        </div>

        {/* Errors Table */}
        <div className="bg-white dark:bg-cosmos-800 rounded-2xl shadow-sm border border-slate-200 dark:border-stellar-500/20 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 dark:border-cosmos-700 flex justify-between items-center bg-slate-50 dark:bg-cosmos-800/50">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
              Recent Errors
            </h3>
            <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-cosmos-700 px-2.5 py-0.5 text-xs font-medium text-slate-800 dark:text-slate-300">
              {recentErrors ? recentErrors.total : 0} Total
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-cosmos-700">
              <thead className="bg-white dark:bg-cosmos-800">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Time</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Code</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Message</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Correlation ID</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-cosmos-800 divide-y divide-slate-200 dark:divide-cosmos-700">
                {recentErrors?.errors && recentErrors.errors.length > 0 ? (
                  recentErrors.errors.map((error, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-cosmos-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                        {new Date(error.timestamp).toLocaleString(undefined, { 
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' 
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center rounded-md bg-red-50 dark:bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400 ring-1 ring-inset ring-red-600/10 dark:ring-red-500/20">
                          {error.code}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-900 dark:text-white max-w-md truncate" title={error.message}>
                        {error.message}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-500 dark:text-slate-400">
                        {error.correlationId || <span className="text-slate-300 dark:text-slate-600 italic">None</span>}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                      No recent errors found. System is healthy! ✨
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        
      </div>
    </div>
  );
}
