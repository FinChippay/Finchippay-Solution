/**
 * components/TradeForm.tsx
 *
 * Token swap interface with Stellar path-payment support (Issue #249).
 *
 * Features:
 * - "You Pay" / "You Receive" token selectors
 * - Swap direction toggle
 * - Horizon strict-send and strict-receive path discovery (up to 6 hops)
 * - Visual route display: XLM → yXLM → USDC
 * - Configurable slippage (0.5 / 1 / 3 / custom %)
 * - Swap preview: exchange rate, estimated fee, min received, price impact
 * - Price-impact warning when impact > 3%
 * - Confirmation modal before signing
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Asset } from "@stellar/stellar-sdk";
import {
  buildPathPaymentTransaction,
  submitTransaction,
  NETWORK_PASSPHRASE,
  STELLAR_BASE_FEE_XLM,
} from "@/lib/stellar";
import {
  findStrictSendPaths,
  findStrictReceivePaths,
  applySlippage,
  calculatePriceImpact,
  pathAssetsToStellarAssets,
  type PathFinderResult,
} from "@/lib/pathFinder";
import { SwapIcon, AlertCircleIcon, Spinner } from "@/components/icons";

// ─── Constants ────────────────────────────────────────────────────────────────

const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/** Supported token codes for the swap UI. */
const SUPPORTED_TOKENS = ["XLM", "USDC"] as const;
type TokenCode = (typeof SUPPORTED_TOKENS)[number];

/** Preset slippage options shown as quick-select buttons. */
const SLIPPAGE_PRESETS = ["0.5", "1", "3"] as const;

/** Debounce delay (ms) before triggering a Horizon path lookup. */
const PATH_DEBOUNCE_MS = 600;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tokenToAsset(code: TokenCode): Asset {
  if (code === "XLM") return Asset.native();
  return new Asset("USDC", USDC_ISSUER);
}

function formatAmount(value: string, decimals = 7): string {
  const n = parseFloat(value);
  if (isNaN(n)) return "–";
  return n.toFixed(decimals);
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TradeFormProps {
  publicKey?: string | null;
  onTradeComplete: () => void;
  onError: (error: string) => void;
  onSuccess: (message: string) => void;
  /** Injected price impact for testing; overrides internal calculation. */
  priceImpact?: number;
}

/** Swap preview data derived from a successful path-finder result. */
interface SwapPreview {
  routeDisplay: string;
  sourceAmount: string;
  destinationAmount: string;
  minimumReceived: string;
  exchangeRate: string;
  estimatedFeeXLM: string;
  priceImpact: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TradeForm({
  publicKey,
  onTradeComplete,
  onError,
  onSuccess,
  priceImpact: externalPriceImpact,
}: TradeFormProps) {
  // ── Token selection ──────────────────────────────────────────────────────
  const [payToken, setPayToken] = useState<TokenCode>("XLM");
  const [receiveToken, setReceiveToken] = useState<TokenCode>("USDC");

  // ── Amounts ──────────────────────────────────────────────────────────────
  const [payAmount, setPayAmount] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");

  // ── Slippage ─────────────────────────────────────────────────────────────
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [isCustomSlippage, setIsCustomSlippage] = useState(false);

  // ── Path-finder state ────────────────────────────────────────────────────
  const [pathResult, setPathResult] = useState<PathFinderResult | null>(null);
  const [swapPreview, setSwapPreview] = useState<SwapPreview | null>(null);
  const [isLoadingPath, setIsLoadingPath] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  // ── Transaction state ────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Derived values ───────────────────────────────────────────────────────

  const activeSlippage = isCustomSlippage
    ? parseFloat(customSlippage) || 0
    : parseFloat(slippage);

  const isSlippageInvalid =
    isNaN(activeSlippage) || activeSlippage < 0 || activeSlippage > 50;

  const displayedPriceImpact =
    externalPriceImpact !== undefined
      ? externalPriceImpact
      : (swapPreview?.priceImpact ?? 0);

  const showPriceImpactWarning = displayedPriceImpact > 3;

  const canSwap =
    !!publicKey &&
    !!payAmount &&
    parseFloat(payAmount) > 0 &&
    !!pathResult?.bestPath &&
    !isLoadingPath &&
    !isSlippageInvalid;

  // ─── Path-finding ─────────────────────────────────────────────────────────

  /** Run strict-send path lookup and build the swap preview. */
  const runPathFinder = useCallback(
    async (amount: string, from: TokenCode, to: TokenCode) => {
      const parsed = parseFloat(amount);
      if (!parsed || parsed <= 0 || from === to) {
        setPathResult(null);
        setSwapPreview(null);
        setPathError(null);
        return;
      }

      setIsLoadingPath(true);
      setPathError(null);

      try {
        const srcAsset = tokenToAsset(from);
        const dstAsset = tokenToAsset(to);

        const result = await findStrictSendPaths(
          srcAsset,
          amount,
          dstAsset,
          publicKey ?? undefined
        );

        setPathResult(result);

        if (!result.bestPath) {
          setSwapPreview(null);
          setPathError("No path found for this token pair and amount.");
          return;
        }

        const destAmt = result.destinationAmount;
        const minReceived = applySlippage(destAmt, activeSlippage);

        // Exchange rate: how many destAsset per 1 srcAsset
        const srcNum = parseFloat(amount);
        const dstNum = parseFloat(destAmt);
        const rate = srcNum > 0 && dstNum > 0 ? dstNum / srcNum : 0;

        const impact =
          externalPriceImpact !== undefined
            ? externalPriceImpact
            : calculatePriceImpact(amount, destAmt);

        setSwapPreview({
          routeDisplay: result.routeDisplay,
          sourceAmount: amount,
          destinationAmount: destAmt,
          minimumReceived: minReceived,
          exchangeRate: rate > 0 ? rate.toFixed(7) : "–",
          estimatedFeeXLM: STELLAR_BASE_FEE_XLM.toFixed(7),
          priceImpact: impact,
        });

        setReceiveAmount(parseFloat(destAmt).toFixed(7));
      } catch (err) {
        setPathResult(null);
        setSwapPreview(null);
        setPathError(
          err instanceof Error ? err.message : "Path lookup failed"
        );
      } finally {
        setIsLoadingPath(false);
      }
    },
    [publicKey, activeSlippage, externalPriceImpact]
  );

  /** Debounce path lookups triggered by amount / token changes. */
  const schedulePathFind = useCallback(
    (amount: string, from: TokenCode, to: TokenCode) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runPathFinder(amount, from, to);
      }, PATH_DEBOUNCE_MS);
    },
    [runPathFinder]
  );

  // Re-run path-finder when pay amount, tokens, or slippage changes
  useEffect(() => {
    schedulePathFind(payAmount, payToken, receiveToken);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [payAmount, payToken, receiveToken, schedulePathFind]);

  // Recompute minimum received when slippage changes (without re-fetching paths)
  useEffect(() => {
    if (!swapPreview) return;
    const minReceived = applySlippage(swapPreview.destinationAmount, activeSlippage);
    setSwapPreview((prev) =>
      prev ? { ...prev, minimumReceived: minReceived } : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlippage]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSwapDirection = () => {
    setPayToken(receiveToken);
    setReceiveToken(payToken);
    setPayAmount(receiveAmount);
    setReceiveAmount(payAmount);
    setPathResult(null);
    setSwapPreview(null);
    setPathError(null);
  };

  const handlePayAmountChange = (val: string) => {
    setPayAmount(val);
    // Clear receive amount and preview until path-finder returns
    setReceiveAmount("");
    setSwapPreview(null);
  };

  const handleSlippagePreset = (preset: string) => {
    setSlippage(preset);
    setIsCustomSlippage(false);
    setCustomSlippage("");
  };

  const handleCustomSlippageChange = (val: string) => {
    setCustomSlippage(val);
    setIsCustomSlippage(true);
  };

  /** Open confirmation modal. */
  const handleReviewSwap = () => {
    if (!canSwap) return;
    setShowConfirmModal(true);
  };

  /** Sign and submit the path-payment transaction. */
  const handleConfirmSwap = async () => {
    if (!publicKey || !pathResult?.bestPath || !swapPreview) return;
    setShowConfirmModal(false);
    setIsSubmitting(true);

    try {
      const srcAsset = tokenToAsset(payToken);
      const dstAsset = tokenToAsset(receiveToken);
      const intermediateAssets = pathAssetsToStellarAssets(
        pathResult.bestPath.path
      );

      const minReceived = applySlippage(
        swapPreview.destinationAmount,
        activeSlippage
      );

      // Build path payment (strict-receive so user gets at least minReceived)
      const tx = await buildPathPaymentTransaction({
        fromPublicKey: publicKey,
        toPublicKey: publicKey,
        sendAsset: srcAsset,
        sendMax: payAmount,           // maximum we are willing to pay
        destAsset: dstAsset,
        destAmount: minReceived,      // minimum we must receive (slippage applied)
        path: intermediateAssets,
      });

      const { signTransaction } = await import("@stellar/freighter-api");
      const signed = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signed.error) {
        throw new Error(signed.error.message || "Transaction signing failed");
      }

      await submitTransaction(signed.signedTxXdr);

      onSuccess("Swap executed successfully!");
      onTradeComplete();

      // Reset form
      setPayAmount("");
      setReceiveAmount("");
      setPathResult(null);
      setSwapPreview(null);
    } catch (err) {
      console.error("Swap failed:", err);
      onError(err instanceof Error ? err.message : "Swap failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="card space-y-6">
        {/* ── You Pay ──────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            You Pay
          </label>
          <div className="flex gap-2">
            <select
              aria-label="Pay token"
              value={payToken}
              onChange={(e) => {
                const t = e.target.value as TokenCode;
                if (t !== receiveToken) {
                  setPayToken(t);
                } else {
                  // Flip tokens to avoid same-asset selection
                  setPayToken(t);
                  setReceiveToken(payToken);
                }
                setSwapPreview(null);
              }}
              className="w-28 px-3 py-2 bg-white dark:bg-cosmos-800 border border-slate-300 dark:border-stellar-500/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-stellar-400"
            >
              {SUPPORTED_TOKENS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              min="0"
              value={payAmount}
              onChange={(e) => handlePayAmountChange(e.target.value)}
              placeholder="0.00"
              aria-label="Pay amount"
              className="flex-1 px-3 py-2 bg-white dark:bg-cosmos-800 border border-slate-300 dark:border-stellar-500/20 rounded-lg text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400"
            />
          </div>
        </div>

        {/* ── Swap direction button ─────────────────────────────────────────── */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleSwapDirection}
            disabled={!publicKey}
            aria-label="Swap assets"
            className="p-2 rounded-lg bg-stellar-500/20 hover:bg-stellar-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SwapIcon className="w-5 h-5 text-stellar-700 dark:text-stellar-400" />
          </button>
        </div>

        {/* ── You Receive ───────────────────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            You Receive
          </label>
          <div className="flex gap-2">
            <select
              aria-label="Receive token"
              value={receiveToken}
              onChange={(e) => {
                const t = e.target.value as TokenCode;
                if (t !== payToken) {
                  setReceiveToken(t);
                } else {
                  setReceiveToken(t);
                  setPayToken(receiveToken);
                }
                setSwapPreview(null);
              }}
              className="w-28 px-3 py-2 bg-white dark:bg-cosmos-800 border border-slate-300 dark:border-stellar-500/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-stellar-400"
            >
              {SUPPORTED_TOKENS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="flex-1 px-3 py-2 bg-slate-100 dark:bg-cosmos-800 border border-slate-300 dark:border-stellar-500/20 rounded-lg text-slate-900 dark:text-white min-h-[2.5rem] flex items-center">
              {isLoadingPath ? (
                <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                  <Spinner className="w-4 h-4" />
                  Finding best path…
                </span>
              ) : receiveAmount ? (
                <span data-testid="receive-amount">{receiveAmount}</span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400 text-sm">
                  Estimated amount
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Path visualization ────────────────────────────────────────────── */}
        {swapPreview?.routeDisplay && (
          <div
            data-testid="route-display"
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-stellar-500/10 text-sm text-stellar-700 dark:text-stellar-300 flex-wrap"
          >
            <span className="font-medium">Route:</span>
            {swapPreview.routeDisplay.split(" → ").map((hop, idx, arr) => (
              <span key={idx} className="flex items-center gap-1">
                <span className="px-2 py-0.5 rounded bg-stellar-500/20 font-mono font-semibold">
                  {hop}
                </span>
                {idx < arr.length - 1 && (
                  <span className="text-slate-400">→</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* ── Path error ────────────────────────────────────────────────────── */}
        {pathError && (
          <p
            data-testid="path-error"
            className="text-sm text-amber-400 flex items-center gap-1"
          >
            <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
            {pathError}
          </p>
        )}

        {/* ── Slippage controls ─────────────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Slippage Tolerance
          </label>
          <div className="flex gap-2 flex-wrap">
            {SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSlippagePreset(preset)}
                aria-pressed={!isCustomSlippage && slippage === preset}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  !isCustomSlippage && slippage === preset
                    ? "bg-stellar-500 text-white"
                    : "bg-stellar-500/10 text-slate-700 dark:text-slate-300 hover:bg-stellar-500/20"
                }`}
              >
                {preset}%
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                value={customSlippage}
                onChange={(e) => handleCustomSlippageChange(e.target.value)}
                placeholder="Custom"
                aria-label="Custom slippage"
                className={`w-24 px-2 py-1.5 text-sm rounded-md border focus:outline-none focus:border-stellar-400 bg-white dark:bg-cosmos-800 text-slate-900 dark:text-white placeholder-slate-500 ${
                  isCustomSlippage
                    ? "border-stellar-400"
                    : "border-slate-300 dark:border-stellar-500/20"
                }`}
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
          {isSlippageInvalid && (
            <p className="text-xs text-red-400 mt-1">
              Slippage must be between 0% and 50%
            </p>
          )}
        </div>

        {/* ── Swap Preview ──────────────────────────────────────────────────── */}
        {swapPreview && (
          <div
            data-testid="swap-preview"
            className="rounded-lg border border-stellar-500/20 bg-slate-50 dark:bg-cosmos-800/50 p-4 space-y-2 text-sm"
          >
            <div className="flex justify-between text-slate-700 dark:text-slate-300">
              <span>Exchange rate</span>
              <span className="font-medium text-slate-900 dark:text-white">
                1 {payToken} ≈ {swapPreview.exchangeRate} {receiveToken}
              </span>
            </div>
            <div className="flex justify-between text-slate-700 dark:text-slate-300">
              <span>Minimum received</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {formatAmount(swapPreview.minimumReceived)} {receiveToken}
              </span>
            </div>
            <div className="flex justify-between text-slate-700 dark:text-slate-300">
              <span>Price impact</span>
              <span
                className={`font-medium ${
                  displayedPriceImpact > 3
                    ? "text-red-400"
                    : displayedPriceImpact > 1
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              >
                {displayedPriceImpact.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between text-slate-700 dark:text-slate-300">
              <span>Estimated network fee</span>
              <span className="font-medium text-slate-900 dark:text-white">
                ~{swapPreview.estimatedFeeXLM} XLM
              </span>
            </div>
          </div>
        )}

        {/* ── Price impact warning ──────────────────────────────────────────── */}
        {showPriceImpactWarning && (
          <div
            data-testid="price-impact-warning"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2"
          >
            <AlertCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">
              <span className="font-semibold">High price impact</span> —{" "}
              {displayedPriceImpact.toFixed(2)}% price impact detected. You may
              receive significantly less than expected.
            </p>
          </div>
        )}

        {/* ── Review Swap button ────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={handleReviewSwap}
          disabled={!canSwap || isSubmitting}
          aria-label="Review swap"
          className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting
            ? "Processing…"
            : isLoadingPath
            ? "Finding route…"
            : !publicKey
            ? "Connect wallet to swap"
            : "Review Swap"}
        </button>
      </div>

      {/* ── Confirmation Modal ────────────────────────────────────────────────── */}
      {showConfirmModal && swapPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-swap-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="w-full max-w-md bg-white dark:bg-cosmos-900 rounded-2xl shadow-xl p-6 space-y-5">
            <h2
              id="confirm-swap-title"
              className="text-xl font-semibold text-slate-900 dark:text-white"
            >
              Confirm Swap
            </h2>

            {/* Token pair */}
            <div className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-cosmos-800 px-4 py-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {formatAmount(swapPreview.sourceAmount, 4)}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {payToken}
                </p>
              </div>
              <SwapIcon className="w-6 h-6 text-stellar-500" />
              <div className="text-center">
                <p className="text-2xl font-bold text-stellar-700 dark:text-stellar-400">
                  {formatAmount(swapPreview.destinationAmount, 4)}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {receiveToken}
                </p>
              </div>
            </div>

            {/* Detail rows */}
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Route</dt>
                <dd
                  data-testid="confirm-route"
                  className="text-slate-900 dark:text-white font-medium text-right max-w-[60%]"
                >
                  {swapPreview.routeDisplay}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">
                  Exchange rate
                </dt>
                <dd className="text-slate-900 dark:text-white font-medium">
                  1 {payToken} ≈ {swapPreview.exchangeRate} {receiveToken}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">
                  Slippage tolerance
                </dt>
                <dd className="text-slate-900 dark:text-white font-medium">
                  {activeSlippage}%
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">
                  Minimum received
                </dt>
                <dd className="text-slate-900 dark:text-white font-medium">
                  {formatAmount(swapPreview.minimumReceived)} {receiveToken}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">
                  Price impact
                </dt>
                <dd
                  className={`font-medium ${
                    displayedPriceImpact > 3
                      ? "text-red-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {displayedPriceImpact.toFixed(2)}%
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">
                  Estimated fee
                </dt>
                <dd className="text-slate-900 dark:text-white font-medium">
                  ~{swapPreview.estimatedFeeXLM} XLM
                </dd>
              </div>
            </dl>

            {/* High-impact warning inside modal */}
            {showPriceImpactWarning && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
                <AlertCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-400">
                  Price impact is {displayedPriceImpact.toFixed(2)}%. Confirm
                  only if you understand the risk.
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-stellar-500/30 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-cosmos-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSwap()}
                className="flex-1 btn-primary"
                aria-label="Confirm swap"
              >
                Confirm Swap
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
