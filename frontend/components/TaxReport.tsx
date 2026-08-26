/**
 * components/TaxReport.tsx
 * FIFO cost-basis tax report with CSV export (issue #605).
 *
 * Loads payment history + historical prices, computes FIFO cost basis
 * and realized/unrealized gains, and renders a summary + per-asset detail.
 */
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "@/components/Skeleton";
import { downloadCSV } from "@/lib/exportTransactions";
import {
  type FiatCurrency,
  type TaxReport as TaxReportT,
  type TaxEventInput,
  COINGECKO_ID_MAP,
  fetchTokenPricesCached,
  fetchHistoricalPrices,
  computeFIFOTaxReport,
  historicalPriceLookup,
} from "@/lib/portfolio";
import { getPaymentHistory } from "@/lib/stellar";
import { useWallet } from "@/lib/useWallet";
import { formatAmount } from "@/utils/format";

interface TaxReportProps {
  fiatCurrency: FiatCurrency;
}

export default function TaxReport({ fiatCurrency }: TaxReportProps) {
  const { t, i18n } = useTranslation("common");
  const { publicKey } = useWallet();
  const [report, setReport] = useState<TaxReportT | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Load all payment history
      const events: TaxEventInput[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const { records, nextCursor } = await getPaymentHistory(publicKey, 200, cursor);
        for (const r of records) {
          events.push({
            type: r.type,
            amount: r.amount,
            asset: r.asset,
            createdAt: r.createdAt,
          });
        }
        if (!nextCursor || records.length === 0) break;
        cursor = nextCursor;
      }

      if (events.length === 0) {
        setReport(null);
        setLoading(false);
        return;
      }

      // 2. Collect unique asset codes that have CoinGecko mappings
      const codes = [...new Set(events.map((e) => e.asset))].filter(
        (c) => COINGECKO_ID_MAP[c]
      );

      // 3. Load live prices (for recent dates and fallback)
      const { prices: livePrices } = await fetchTokenPricesCached(codes);

      // 4. Load historical prices per asset
      const history: Record<string, Record<string, number>> = {};
      await Promise.all(
        codes.map(async (code) => {
          const hist = await fetchHistoricalPrices(code, fiatCurrency, 365);
          history[code] = hist;
        })
      );

      // 5. Build the lookup: live prices as fallback
      const liveFlat: Record<string, number> = {};
      for (const code of codes) {
        const sp = livePrices[code]?.prices[fiatCurrency];
        if (sp !== undefined) liveFlat[code] = sp;
      }

      const priceAt = historicalPriceLookup(history, liveFlat);
      const result = computeFIFOTaxReport(events, priceAt, fiatCurrency);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tax report");
    } finally {
      setLoading(false);
    }
  }, [publicKey, fiatCurrency]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  // ── CSV export ────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!report || report.positions.length === 0) return;

    const headers = [
      "Asset",
      "Remaining Qty",
      "Cost Basis",
      "Unrealized Gain",
      "Realized Gain",
      "Total Acquired",
      "Unpriced",
    ];
    const rows = report.positions.map((p) => [
      p.asset,
      p.remainingQty.toFixed(6),
      p.costBasis.toFixed(2),
      p.unrealizedGain.toFixed(2),
      "—", // realized is per-report, not per-asset in current model
      p.totalAcquired.toFixed(2),
      p.unpriced ? "Yes" : "No",
    ]);

    // Summary row
    rows.push([
      "TOTAL",
      "",
      "",
      report.totalUnrealizedGain.toFixed(2),
      report.totalRealizedGain.toFixed(2),
      "",
      "",
    ]);

    const bom = "\uFEFF";
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
      .join("\n");

    downloadCSV(bom + csv, `finchippay-tax-report-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!publicKey) {
    return (
      <div className="card text-center py-12 text-slate-500 dark:text-slate-400">
        {t("dashboard.connectPrompt")}
      </div>
    );
  }

  if (loading) {
    return <Skeleton height="h-64" />;
  }

  if (error) {
    return (
      <div className="card text-center py-12 text-red-500">{error}</div>
    );
  }

  if (!report || report.positions.length === 0) {
    return (
      <div className="card text-center py-12 text-slate-500 dark:text-slate-400">
        {t("taxReport.noData") || "No transaction history available for tax reporting."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t("taxReport.summary") || "Tax Summary (FIFO)"}
          </h2>
          <button
            onClick={handleExportCSV}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            {t("taxReport.exportCSV") || "Export CSV"}
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("taxReport.realizedGain") || "Realized Gains"}
            </p>
            <p
              className={clsx(
                "text-xl font-bold font-mono",
                report.totalRealizedGain >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {report.totalRealizedGain >= 0 ? "+" : ""}
              {formatAmount(
                report.totalRealizedGain,
                fiatCurrency,
                i18n.language
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("taxReport.unrealizedGain") || "Unrealized Gains"}
            </p>
            <p
              className={clsx(
                "text-xl font-bold font-mono",
                report.totalUnrealizedGain >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {report.totalUnrealizedGain >= 0 ? "+" : ""}
              {formatAmount(
                report.totalUnrealizedGain,
                fiatCurrency,
                i18n.language
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("taxReport.positions") || "Assets"}
            </p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">
              {report.positions.length}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          {t("taxReport.generatedAt") || "Generated"}: {new Date(report.generatedAt).toLocaleDateString()}
          &nbsp;·&nbsp;
          {t("taxReport.currency") || "Currency"}: {fiatCurrency}
        </p>
      </div>

      {/* Per-asset Table */}
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10 text-left text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <th className="py-2 pr-3 font-medium">{t("taxReport.asset") || "Asset"}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("taxReport.remaining") || "Remaining"}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("taxReport.costBasis") || "Cost Basis"}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("taxReport.unrealized") || "Unrealized"}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("taxReport.lots") || "Lots"}</th>
              <th className="py-2 font-medium text-center">{t("taxReport.priced") || "Priced"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-white/10">
            {report.positions.map((p) => {
              const gainColor =
                p.unrealizedGain >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400";
              return (
                <tr key={p.asset} className="text-slate-900 dark:text-white">
                  <td className="py-2.5 pr-3 font-semibold">{p.asset}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">
                    {p.remainingQty.toFixed(4)}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono">
                    {formatAmount(p.costBasis, fiatCurrency, i18n.language)}
                  </td>
                  <td className={clsx("py-2.5 pr-3 text-right font-mono", gainColor)}>
                    {p.unrealizedGain >= 0 ? "+" : ""}
                    {formatAmount(p.unrealizedGain, fiatCurrency, i18n.language)}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono">{p.lots.length}</td>
                  <td className="py-2.5 text-center">
                    {p.unpriced ? (
                      <span className="text-amber-500 text-xs">{t("taxReport.incomplete") || "⚠ Unpriced"}</span>
                    ) : (
                      <span className="text-green-500">✓</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
        {t("taxReport.disclaimer") || (
          <>
            <strong>Note:</strong> Cost basis uses FIFO (First-In, First-Out) and
            CoinGecko historical prices. Realized gains are computed from sent
            payments where historical prices are available. Swaps and trades are
            not yet tracked as paired events. This report is for informational
            purposes and should be verified by a tax professional.
          </>
        )}
      </p>
    </div>
  );
}