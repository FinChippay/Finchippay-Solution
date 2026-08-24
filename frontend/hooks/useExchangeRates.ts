import { useCallback, useEffect, useState } from "react";
import { fetchTokenPricesCached, type TokenPriceSnapshot } from "@/lib/portfolio";

/**
 * Loads fiat exchange rates for a set of portfolio assets. The underlying
 * localStorage cache has a five-minute TTL and serves its last value if the
 * price provider is temporarily unavailable.
 */
export function useExchangeRates(codes: string[]) {
  const [prices, setPrices] = useState<Record<string, TokenPriceSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const codeKey = [...new Set(codes)].sort().join(",");

  const refresh = useCallback(async () => {
    const assetCodes = codeKey ? codeKey.split(",") : [];
    if (assetCodes.length === 0) {
      setPrices({});
      setUnavailable(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchTokenPricesCached(assetCodes);
      setPrices(result.prices);
      setStale(result.stale);
      setUnavailable(Object.keys(result.prices).length === 0);
    } catch {
      setPrices({});
      setStale(false);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [codeKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { prices, loading, stale, unavailable, refresh };
}
