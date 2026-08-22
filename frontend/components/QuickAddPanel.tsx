/**
 * components/QuickAddPanel.tsx
 * Quick-add panel showing available tokens with balances.
 * Users can drag tokens and preset amounts onto recipient rows.
 */

import { motion } from "framer-motion";

interface QuickAddPanelProps {
  xlmBalance: string;
  usdcBalance?: string | null;
  onTokenSelect?: (token: string) => void;
  onPresetAmount?: (amount: string) => void;
}

const PRESET_AMOUNTS = [
  { label: "10 XLM", value: "10" },
  { label: "50 XLM", value: "50" },
  { label: "100 XLM", value: "100" },
  { label: "500 XLM", value: "500" },
  { label: "10 USDC", value: "10" },
  { label: "100 USDC", value: "100" },
  { label: "1000 USDC", value: "1000" },
];

const TOKENS = [
  { code: "XLM", description: "Stellar Lumens" },
  { code: "USDC", description: "USD Coin" },
];

export default function QuickAddPanel({
  xlmBalance,
  usdcBalance,
  onTokenSelect,
  onPresetAmount,
}: QuickAddPanelProps) {
  const getTokenBalance = (code: string): string => {
    if (code === "XLM") return `${parseFloat(xlmBalance || "0").toFixed(2)} XLM`;
    if (code === "USDC") return `${parseFloat(usdcBalance || "0").toFixed(2)} USDC`;
    return "0";
  };

  const handleDragStart = (e: React.DragEvent, type: string, value: string) => {
    const payload = JSON.stringify({ type, value });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Add</h3>
        <p className="text-xs text-slate-500 mb-3">
          Drag tokens or preset amounts onto recipient rows
        </p>
      </div>

      {/* Available tokens */}
      <div>
        <h4 className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
          Tokens
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {TOKENS.map((token) => (
            <motion.div
              key={token.code}
              draggable
              onDragStart={(e) => handleDragStart(e, "token", token.code)}
              className="rounded-xl border border-stellar-500/20 bg-stellar-500/5 p-3 cursor-grab active:cursor-grabbing hover:border-stellar-500/40 transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-400"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onTokenSelect?.(token.code)}
              role="button"
              tabIndex={0}
              aria-label={`Drag ${token.code} to set token`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onTokenSelect?.(token.code);
                }
              }}
            >
              <div className="text-sm font-semibold text-stellar-300">{token.code}</div>
              <div className="text-xs text-slate-500 mt-1">{token.description}</div>
              <div className="text-xs text-slate-400 mt-1">
                Balance: {getTokenBalance(token.code)}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Preset amounts */}
      <div>
        <h4 className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
          Preset Amounts
        </h4>
        <div className="flex flex-wrap gap-2">
          {PRESET_AMOUNTS.map((preset) => (
            <motion.button
              key={preset.label}
              draggable
              onDragStart={(e) => handleDragStart(e, "amount", preset.value)}
              className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-slate-300 cursor-grab active:cursor-grabbing hover:border-stellar-500/30 hover:bg-stellar-500/5 transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-400"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onPresetAmount?.(preset.value)}
              type="button"
              aria-label={`Preset amount ${preset.label}`}
            >
              {preset.label}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
