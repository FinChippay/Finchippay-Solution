/**
 * components/TradeForm.tsx
 * Trading form component for placing market and limit orders on Stellar DEX.
 */

import { useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import {
  buildSellOfferTransaction,
  buildBuyOfferTransaction,
  buildPathPaymentTransaction,
  submitTransaction,
  NETWORK_PASSPHRASE,
} from "@/lib/stellar";
import { SwapIcon } from "@/components/icons";

interface TradeFormProps {
  publicKey?: string | null;
  onTradeComplete: () => void;
  onError: (error: string) => void;
  onSuccess: (message: string) => void;
  priceImpact?: number;
}

export default function TradeForm({ publicKey, onTradeComplete, onError, onSuccess, priceImpact: externalPriceImpact }: TradeFormProps) {
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sellingAsset, setSellingAsset] = useState<"XLM" | "USDC">("XLM");
  const [buyingAsset, setBuyingAsset] = useState<"XLM" | "USDC">("USDC");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [isLoading, setIsLoading] = useState(false);

  const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  const getAsset = (assetType: "XLM" | "USDC"): Asset => {
    return assetType === "XLM" ? Asset.native() : new Asset("USDC", USDC_ISSUER);
  };

  const parsedSlippage = parseFloat(slippage);
  const isSlippageInvalid = isNaN(parsedSlippage) || parsedSlippage < 0 || parsedSlippage > 50;

  const currentPriceImpact = externalPriceImpact !== undefined
    ? externalPriceImpact
    : (parseFloat(amount) > 1000 ? 6.5 : 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey) {
      onError("Wallet not connected");
      return;
    }

    if (isSlippageInvalid) {
      onError("Slippage tolerance must be between 0% and 50%");
      return;
    }
    
    if (!amount || (orderType === "limit" && !price)) {
      onError("Please fill in all required fields");
      return;
    }

    if (sellingAsset === buyingAsset) {
      onError("Cannot trade the same asset");
      return;
    }

    setIsLoading(true);

    try {
      let transaction;
      const sellAsset = getAsset(sellingAsset);
      const buyAsset = getAsset(buyingAsset);

      if (orderType === "market") {
        // Market order using path payment
        transaction = await buildPathPaymentTransaction({
          fromPublicKey: publicKey,
          toPublicKey: publicKey, // Self-transfer for path payment
          sendAsset: sellAsset,
          sendMax: amount,
          destAsset: buyAsset,
          destAmount: price || amount, // For market orders, this is the amount we want to receive
          path: [],
        });

      } else {
        // Limit order
        if (side === "sell") {
          transaction = await buildSellOfferTransaction({
            fromPublicKey: publicKey,
            selling: sellAsset,
            buying: buyAsset,
            amount,
            price,
          });
        } else {
          transaction = await buildBuyOfferTransaction({
            fromPublicKey: publicKey,
            selling: sellAsset,
            buying: buyAsset,
            amount,
            price,
          });
        }
      }

      // Sign with Freighter
      const { signTransaction } = await import("@stellar/freighter-api");
      const signed = await signTransaction(transaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signed.error) {
        throw new Error(signed.error.message || "Transaction signing failed");
      }

      // Submit transaction
      const result = await submitTransaction(signed.signedTxXdr);
      
      onSuccess(
        orderType === "market" 
          ? "Market order executed successfully!" 
          : `${side === "sell" ? "Sell" : "Buy"} order placed successfully!`
      );
      
      onTradeComplete();
      
      // Reset form
      setAmount("");
      setPrice("");
      
    } catch (error) {
      console.error("Trade failed:", error);
      onError(error instanceof Error ? error.message : "Trade failed");
    } finally {
      setIsLoading(false);
    }
  };

  const swapAssets = () => {
    setSellingAsset(buyingAsset);
    setBuyingAsset(sellingAsset);
    setSide(side === "buy" ? "sell" : "buy");
  };

  return (
    <div className="card">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Order Type Selection */}
        <div className="flex gap-2 p-1 bg-stellar-500/10 rounded-lg">
          <button
            type="button"
            onClick={() => setOrderType("market")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              orderType === "market"
                ? "bg-stellar-500 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Market Order
          </button>
          <button
            type="button"
            onClick={() => setOrderType("limit")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              orderType === "limit"
                ? "bg-stellar-500 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Limit Order
          </button>
        </div>

        {/* Asset Selection */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              You Pay
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Selling asset"
                value={sellingAsset}
                onChange={(e) => setSellingAsset(e.target.value as "XLM" | "USDC")}
                className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white focus:outline-none focus:border-stellar-400"
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400"
              />
            </div>
          </div>

          {/* Swap Button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapAssets}
              disabled={!publicKey}
              aria-label="Swap assets"
              className="p-2 rounded-lg bg-stellar-500/20 hover:bg-stellar-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <SwapIcon className="w-5 h-5 text-stellar-400" />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              You Receive
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Buying asset"
                value={buyingAsset}
                onChange={(e) => setBuyingAsset(e.target.value as "XLM" | "USDC")}
                className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white focus:outline-none focus:border-stellar-400"
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
              {orderType === "limit" ? (
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Price"
                  className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400"
                />
              ) : (
                <div className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-slate-400">
                  Market Price
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Slippage Tolerance Input */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Slippage Tolerance (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            placeholder="0.5"
            className="w-full px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400 text-sm"
          />
          {isSlippageInvalid && (
            <p className="text-xs text-red-400 mt-1">
              Slippage tolerance must be between 0% and 50%
            </p>
          )}
        </div>

        {/* Price Impact Warning */}
        {currentPriceImpact > 5 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            Warning: High price impact (&gt;5%)
          </div>
        )}

        {/* Limit Order Specific Options */}
        {orderType === "limit" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  side === "buy"
                    ? "bg-emerald-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Buy Order
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  side === "sell"
                    ? "bg-red-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sell Order
              </button>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!publicKey || isLoading || !amount || (orderType === "limit" && !price) || isSlippageInvalid}
          className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Processing..." : orderType === "market" ? "Execute Market Order" : `${side === "buy" ? "Place Buy" : "Place Sell"} Order`}
        </button>
      </form>
    </div>
  );
}
