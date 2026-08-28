/**

 * components/DashboardPortfolioWidget.tsx
 * Integrates PortfolioOverview + PortfolioAllocation + a value-over-time
 * chart into the main dashboard (issue #482): total USD value, 24h change,
 * 7d/30d P&L, asset count, auto-refresh every 60s, graceful degradation
 * when price feeds are unavailable.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PortfolioAllocation from "@/components/PortfolioAllocation";
import PortfolioHistoryChart from "@/components/PortfolioHistoryChart";
import PortfolioOverview from "@/components/PortfolioOverview";
import { logger } from "@/lib/logger";
import {
  getPortfolioHoldings,
  fetchTokenPricesCached,
  getPreferredFiatCurrency,
  recordPortfolioValueSnapshot,
  loadPortfolioHistory,
  calculatePnL,
  type PortfolioToken,
  type TokenPriceSnapshot,
  type FiatCurrency,
  type PortfolioValueSnapshot,
} from "@/lib/portfolio";
import { formatAmount } from "@/utils/format";

const AUTO_REFRESH_MS = 60_000;

interface DashboardPortfolioWidgetProps {
  publicKey: string;
}

export default function DashboardPortfolioWidget({ publicKey }: DashboardPortfolioWidgetProps) {
  const { t, i18n } = useTranslation("common");

  const [holdings, setHoldings] = useState<PortfolioToken[]>([]);
  const [prices, setPrices] = useState<Record<string, TokenPriceSnapshot>>({});
  const [pricesUnavailable, setPricesUnavailable] = useState(false);
  const [pricesStale, setPricesStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fiatCurrency] = useState<FiatCurrency>(getPreferredFiatCurrency());
  const [history, setHistory] = useState<PortfolioValueSnapshot[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      let walletHoldings: PortfolioToken[] = [];
      try {
        walletHoldings = await getPortfolioHoldings(publicKey);
      } catch (err) {
        logger.error("DashboardPortfolioWidget: failed to load holdings:", {}, err instanceof Error ? err : undefined);
      }
      setHoldings(walletHoldings);

      const codes = [...new Set(walletHoldings.map((h) => h.code))];
      try {
        const { prices: priceSnapshots, stale } = await fetchTokenPricesCached(codes);
        setPrices(priceSnapshots);
        setPricesStale(stale);
        setPricesUnavailable(Object.keys(priceSnapshots).length === 0 && codes.length > 0);

        const totalValue = walletHoldings.reduce((sum, h) => {
          const price = priceSnapshots[h.code]?.prices[fiatCurrency];
          return price === undefined ? sum : sum + parseFloat(h.balance) * price;
        }, 0);
        if (totalValue > 0) {
          recordPortfolioValueSnapshot(totalValue);
        }
        setHistory(loadPortfolioHistory());
      } catch (err) {
        logger.error("DashboardPortfolioWidget: failed to load prices:", {}, err instanceof Error ? err : undefined);
        setPricesUnavailable(true);
      }
      setLastRefreshedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [publicKey, fiatCurrency]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadPortfolio();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  const totalValue = holdings.reduce((sum, h) => {
    const price = prices[h.code]?.prices[fiatCurrency];
    return price === undefined ? sum : sum + parseFloat(h.balance) * price;
  }, 0);

  const pnl7d = calculatePnL(totalValue, 7);
  const pnl30d = calculatePnL(totalValue, 30);
  const assetCount = holdings.filter((h) => {
    const price = prices[h.code]?.prices[fiatCurrency];
    return price !== undefined && parseFloat(h.balance) * price > 0;
  }).length;

  function pnlLabel(pnl: { absolute: number; percent: number | null }) {
    const sign = pnl.absolute >= 0 ? "+" : "";
    const amountStr = `${sign}${formatAmount(pnl.absolute, fiatCurrency, i18n.language)}`;
    if (pnl.percent === null) return amountStr;
    return `${amountStr} (${sign}${pnl.percent.toFixed(2)}%)`;
  }

  return (
    <div className="space-y-6 mb-8">
      {pricesUnavailable && (
        <div className="card border-amber-500/30 bg-amber-500/5 text-sm text-amber-800 dark:text-amber-200">
          {t("portfolio.pricesUnavailableBanner")}
        </div>
      )}
      {!pricesUnavailable && pricesStale && (
        <div className="card border-slate-300 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400">
          {t("portfolio.pricesStale")}
        </div>
      )}

      <PortfolioOverview
        holdings={holdings}
        prices={prices}
        fiatCurrency={fiatCurrency}
        loading={loading}
      />

      {!loading && holdings.length > 0 && (
        <div className="card">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("portfolio.assetCount")}</p>
              <p className="text-xl font-bold text-slate-900 dark:text-white">{assetCount}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("portfolio.pnl7d")}</p>
              <p className={pnl7d.absolute >= 0 ? "text-green-600 dark:text-green-400 font-semibold" : "text-red-600 dark:text-red-400 font-semibold"}>
                {pnlLabel(pnl7d)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("portfolio.pnl30d")}</p>
              <p className={pnl30d.absolute >= 0 ? "text-green-600 dark:text-green-400 font-semibold" : "text-red-600 dark:text-red-400 font-semibold"}>
                {pnlLabel(pnl30d)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadPortfolio()}
            className="mt-4 text-xs text-stellar-700 dark:text-stellar-400 hover:underline"
          >
            {t("portfolio.refreshPrices")}
          </button>
          {lastRefreshedAt && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              {t("portfolio.lastRefreshed")}: {new Date(lastRefreshedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {!loading && holdings.length > 0 && (
        <PortfolioAllocation
          holdings={holdings}
          prices={prices}
          fiatCurrency={fiatCurrency}
        />
      )}

      {!loading && history.length > 0 && (
        <PortfolioHistoryChart history={history} fiatCurrency={fiatCurrency} />
      )}
    </div>
  );
}
