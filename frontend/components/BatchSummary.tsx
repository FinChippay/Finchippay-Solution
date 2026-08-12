/**
 * components/BatchSummary.tsx
 * Visual summary showing total amounts grouped by token,
 * a bar chart of token distribution, and estimated total fee.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";

type TokenInfo = {
  code: string;
  issuer?: string;
  type?: string;
};

interface BatchSummaryProps {
  recipients: Array<{
    token: TokenInfo;
    amount: string;
    address?: string;
  }>;
  maxRecipients?: number;
}

const ESTIMATED_FEE_XLM = 0.001;

export default function BatchSummary({
  recipients,
  maxRecipients = 10,
}: BatchSummaryProps) {
  const totals = useMemo(() => {
    const byToken: Record<string, number> = {};
    let validCount = 0;

    recipients.forEach((r) => {
      const amount = parseFloat(r.amount);
      if (Number.isFinite(amount) && amount > 0 && r.address) {
        const code = r.token.code;
        byToken[code] = (byToken[code] || 0) + amount;
        validCount++;
      }
    });

    return { byToken, validCount, totalCount: recipients.length };
  }, [recipients]);

  const tokenColors: Record<string, string> = {
    XLM: "bg-stellar-500",
    USDC: "bg-emerald-500",
  };

  const maxAmount = Math.max(...Object.values(totals.byToken), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Batch Summary</h3>
        <span className="text-xs text-slate-400">
          {totals.validCount} / {maxRecipients} recipients
        </span>
      </div>

      {/* Token totals */}
      {Object.keys(totals.byToken).length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          Add recipients with valid addresses and amounts to see the summary.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Bar chart */}
          <div className="space-y-2">
            {Object.entries(totals.byToken).map(([code, amount], index) => {
              const percentage = (amount / maxAmount) * 100;
              return (
                <div key={code} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">{code}</span>
                    <span className="text-slate-200 font-medium">
                      {amount.toFixed(2)} {code}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className={`h-full rounded-full ${
                        tokenColors[code] || "bg-blue-500"
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Estimated fee */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-xs text-slate-500">Estimated fee</span>
            <span className="text-xs text-slate-400">
              ~{ESTIMATED_FEE_XLM} XLM
            </span>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-300">Total</span>
            <span className="text-sm font-semibold text-white">
              {Object.entries(totals.byToken)
                .map(([code, amount]) => `${amount.toFixed(2)} ${code}`)
                .join(" + ") || "0"}
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
