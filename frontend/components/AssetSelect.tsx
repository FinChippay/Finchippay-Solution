import clsx from "clsx";
import { useTranslation } from "react-i18next";

/**
 * components/AssetSelect.tsx
 *
 * Reusable asset selection control for money-movement flows.
 *
 * Normalises Stellar asset selection (code + issuer) into a single component
 * so that send, batch, escrow and streaming forms can all pick SAC / classic
 * assets consistently instead of each implementing its own XLM-only or
 * XLM/USDC-only button group.
 *
 * The parent is responsible for loading the asset catalogue (e.g. via
 * `getKnownAssets` from `@/lib/assetDiscovery`); this component stays a pure
 * presentational + selection layer so it is easy to test and reuse.
 */

export interface AssetSelectOption {
  code: string;
  issuer?: string;
  /** Human-friendly label (defaults to code). */
  displayName?: string;
  /** Verified trustline present for this asset. */
  isTrusted?: boolean;
  balance?: string;
  /** Optional issuer short hint rendered next to the code. */
  issuerHint?: string;
}

interface AssetSelectProps {
  options: AssetSelectOption[];
  selectedCode: string;
  onSelect: (code: string, issuer?: string) => void;
  /** When provided, untrusted assets render an inline "Add trustline" action. */
  onAddTrustline?: (code: string, issuer: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  /** Optional per-code USD price feed used to render balance estimates. */
  prices?: Record<string, number>;
}

export default function AssetSelect({
  options,
  selectedCode,
  onSelect,
  onAddTrustline,
  disabled = false,
  className,
  prices,
}: AssetSelectProps) {
  const { t } = useTranslation("common");

  if (options.length === 0) {
    return (
      <div className={clsx("text-sm text-slate-500 dark:text-slate-400", className)}>
        {t("assetSelect.noAssets") ?? "No assets available."}
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {options.map((opt) => {
        const selected = selectedCode === opt.code;
        const price = prices?.[opt.code];
        const balanceNum =
          opt.balance !== undefined && opt.balance !== null && opt.balance !== ""
            ? Number(opt.balance)
            : NaN;
        const showFiat =
          price !== undefined && price > 0 && Number.isFinite(balanceNum);

        return (
          <div
            key={`${opt.code}-${opt.issuer ?? "native"}`}
            className={clsx(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-all",
              selected
                ? "bg-stellar-500/15 text-stellar-700 dark:text-stellar-300 border-stellar-500/30"
                : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(opt.code, opt.issuer)}
              disabled={disabled}
              className="flex items-center gap-1.5 disabled:cursor-not-allowed"
              aria-pressed={selected}
            >
              <span>{opt.displayName ?? opt.code}</span>
              {opt.issuerHint && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  {opt.issuerHint}
                </span>
              )}
              {showFiat && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  ~${(balanceNum * price).toFixed(2)}
                </span>
              )}
            </button>
            {opt.isTrusted === false && onAddTrustline && opt.issuer && (
              <button
                type="button"
                onClick={() => onAddTrustline(opt.code, opt.issuer!)}
                disabled={disabled}
                className="text-[10px] font-semibold text-amber-500 hover:text-amber-400 disabled:cursor-not-allowed"
                title={t("assetSelect.addTrustline") ?? "Add trustline"}
              >
                + {t("assetSelect.addTrustline") ?? "Trustline"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
