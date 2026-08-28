/**
 * components/PortfolioOverview.tsx
 * Total portfolio value, 24h change, and a per-token summary list (issue #362).
 */

import clsx from "clsx";
import { useTranslation } from "react-i18next";
import Skeleton from "@/components/Skeleton";
import type { PortfolioToken, TokenPriceSnapshot, FiatCurrency } from "@/lib/portfolio";
import { formatAmount, shortenAddress } from "@/utils/format";

interface PortfolioOverviewProps {
  holdings: PortfolioToken[];
  prices: Record<string, TokenPriceSnapshot>;
  fiatCurrency: FiatCurrency;
  loading?: boolean;
}

function holdingValue(holding: PortfolioToken, prices: Record<string, TokenPriceSnapshot>, fiatCurrency: FiatCurrency): number {
  const price = prices[holding.code]?.prices[fiatCurrency];
  if (price === undefined) return 0;
  return parseFloat(holding.balance) * price;
}

export default function PortfolioOverview({ holdings, prices, fiatCurrency, loading = false }: PortfolioOverviewProps) {
  const { t, i18n } = useTranslation("common");

  if (loading) {
    return <Skeleton height="h-40" />;
  }

  if (holdings.length === 0) {
    return (
      <div className="card text-center text-slate-500 dark:text-slate-400">
        {t("portfolio.noHoldings")}
      </div>
    );
  }

  const totalValue = holdings.reduce((sum, h) => sum + holdingValue(h, prices, fiatCurrency), 0);

  const weighted24h = holdings.reduce((sum, h) => {
    const value = holdingValue(h, prices, fiatCurrency);
    const change = prices[h.code]?.change24hPct[fiatCurrency];
    return change === undefined ? sum : sum + value * change;
  }, 0);
  const change24hPct = totalValue > 0 ? weighted24h / totalValue : 0;
  const changeColor = change24hPct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  const changeArrow = change24hPct >= 0 ? "↑" : "↓";

  return (
    <div className="card space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("portfolio.totalValue")}</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white">
            {formatAmount(totalValue, fiatCurrency, i18n.language)}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("portfolio.change24h")}</p>
          <p className={clsx("text-3xl font-bold", changeColor)}>
            {changeArrow} {Math.abs(change24hPct).toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-white/10">
        {holdings.map((holding) => {
          const snapshot = prices[holding.code];
          const price = snapshot?.prices[fiatCurrency];
          const change = snapshot?.change24hPct[fiatCurrency];
          const rowChangeColor =
            change === undefined
              ? "text-slate-400 dark:text-slate-500"
              : change >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400";

          return (
            <div key={holding.contractId} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {holding.isCustom ? shortenAddress(holding.contractId, 4) : holding.code}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {holding.balance} {holding.code}
                </p>
              </div>
              <div className="text-right">
                {price !== undefined ? (
                  <>
                    <p className="font-mono text-sm text-slate-900 dark:text-white">
                      {formatAmount(parseFloat(holding.balance) * price, fiatCurrency, i18n.language)}
                    </p>
                    <p className={clsx("text-xs", rowChangeColor)}>
                      {change === undefined ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500">{t("portfolio.priceUnavailable")}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
