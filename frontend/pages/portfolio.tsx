/**

 * pages/portfolio.tsx
 * Interactive token portfolio dashboard (issue #362): total value, 24h
 * change, allocation donut, per-token price history, and adding custom
 * tokens by Soroban contract ID.
 *
 * Gated behind the "new_portfolio" feature flag (#103).
 * Renders a "coming soon" fallback when the flag is off.
 */

import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PortfolioOverview from "@/components/PortfolioOverview";
import { FeatureGate } from "@/lib/FeatureFlags";
import { logger } from "@/lib/logger";
import {
  getPortfolioHoldings,
  loadCustomTokens,
  addCustomToken,
  fetchTokenPrices,
  getPreferredFiatCurrency,
  setPreferredFiatCurrency,
  isValidContractId,
  SUPPORTED_FIAT_CURRENCIES,
  type PortfolioToken,
  type TokenPriceSnapshot,
  type FiatCurrency,
} from "@/lib/portfolio";
import { useWallet } from "@/lib/useWallet";

const WalletConnect = dynamic(() => import("@/components/WalletConnect"), { ssr: false });
// PortfolioAllocation + TokenPriceChart both depend on recharts (the heaviest
// client lib on this route); lazy-load them so recharts leaves the portfolio
// first-load chunk (issue #610).
const PortfolioAllocation = dynamic(() => import("@/components/PortfolioAllocation"), { ssr: false });
const TokenPriceChart = dynamic(() => import("@/components/TokenPriceChart"), { ssr: false });

export default function PortfolioPage() {
  const { t } = useTranslation("common");
  const { publicKey } = useWallet();

  const [holdings, setHoldings] = useState<PortfolioToken[]>([]);
  const [prices, setPrices] = useState<Record<string, TokenPriceSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>("USD");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const [addTokenInput, setAddTokenInput] = useState("");
  const [addTokenError, setAddTokenError] = useState<string | null>(null);

  useEffect(() => {
    setFiatCurrency(getPreferredFiatCurrency());
  }, []);

  const loadPortfolio = useCallback(async () => {
    if (!publicKey) {
      setHoldings([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let walletHoldings: PortfolioToken[] = [];
      try {
        walletHoldings = await getPortfolioHoldings(publicKey);
      } catch (err) {
        // Most commonly: the connected account hasn't been funded on this
        // network yet (no XLM balance exists to derive holdings from).
        logger.error("Failed to load wallet holdings:", {}, err instanceof Error ? err : undefined);
      }

      const customTokens = loadCustomTokens();
      const customHoldings: PortfolioToken[] = customTokens
        .filter((ct) => !walletHoldings.some((h) => h.contractId === ct.contractId))
        .map((ct) => ({
          code: ct.contractId,
          contractId: ct.contractId,
          balance: "0",
          isCustom: true,
        }));

      const allHoldings = [...walletHoldings, ...customHoldings];
      setHoldings(allHoldings);
      setSelectedCode((current) => current ?? allHoldings[0]?.code ?? null);

      const codes = [...new Set(allHoldings.map((h) => h.code))];
      try {
        const priceSnapshots = await fetchTokenPrices(codes);
        setPrices(priceSnapshots);
      } catch (err) {
        logger.error("Failed to load token prices:", {}, err instanceof Error ? err : undefined);
      }
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  const handleFiatChange = (currency: FiatCurrency) => {
    setFiatCurrency(currency);
    setPreferredFiatCurrency(currency);
  };

  const handleAddToken = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addTokenInput.trim();
    if (!isValidContractId(trimmed)) {
      setAddTokenError(t("portfolio.addTokenInvalid"));
      return;
    }
    setAddTokenError(null);
    addCustomToken(trimmed);
    setAddTokenInput("");
    void loadPortfolio();
  };

  const selectedHolding = holdings.find((h) => h.code === selectedCode) ?? holdings[0] ?? null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <Head>
        <title>{`${t("portfolio.title")} | Finchippay`}</title>
        <meta
          name="description"
          content="View your Stellar asset allocation, performance history, and portfolio breakdown."
        />
      </Head>

      <FeatureGate
        flag="new_portfolio"
        fallback={
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-stellar-500/10 border border-stellar-500/20 flex items-center justify-center mb-6">
              <ChartPieIcon className="w-8 h-8 text-stellar-500" />
            </div>
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">
              Portfolio — Coming Soon
            </h1>
            <p className="text-slate-600 dark:text-slate-400 max-w-md mb-6">
              The portfolio overview page is currently in limited preview. Check
              back soon or head to the dashboard for your current balances.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-stellar-500 hover:bg-stellar-600 text-white font-semibold text-sm py-2.5 px-5 rounded-lg transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        }
      >
        {/* ── Feature content (rendered when new_portfolio flag is on) ── */}
        {!publicKey ? (
          <div className="text-center py-16">
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">
              {t("portfolio.title")}
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mb-8">{t("dashboard.connectPrompt")}</p>
            <WalletConnect />
          </div>
        ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">
              {t("portfolio.title")}
            </h1>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                {t("portfolio.currency")}
                <select
                  value={fiatCurrency}
                  onChange={(e) => handleFiatChange(e.target.value as FiatCurrency)}
                  className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-cosmos-800 px-2 py-1.5 text-sm text-slate-900 dark:text-white"
                >
                  {SUPPORTED_FIAT_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <form onSubmit={handleAddToken} className="flex items-center gap-2">
                <input
                  type="text"
                  value={addTokenInput}
                  onChange={(e) => setAddTokenInput(e.target.value)}
                  placeholder={t("portfolio.addTokenPlaceholder")}
                  className="input-field w-64 text-xs font-mono"
                />
                <button type="submit" className="btn-primary px-4 py-1.5 text-sm min-h-0">
                  {t("portfolio.addTokenButton")}
                </button>
              </form>
            </div>
          </div>

          {addTokenError && <p className="text-sm text-red-500">{addTokenError}</p>}

          <PortfolioOverview holdings={holdings} prices={prices} fiatCurrency={fiatCurrency} loading={loading} />

          <div className="grid gap-6 md:grid-cols-2">
            <PortfolioAllocation
              holdings={holdings}
              prices={prices}
              fiatCurrency={fiatCurrency}
              selectedCode={selectedCode}
              onSelectToken={setSelectedCode}
              loading={loading}
            />

            {selectedHolding && (
              <TokenPriceChart contractId={selectedHolding.contractId} code={selectedHolding.code} />
            )}
          </div>
        </div>
        )}
      </FeatureGate>
    </div>
  );
}

function ChartPieIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z"
      />
    </svg>
  );
}
