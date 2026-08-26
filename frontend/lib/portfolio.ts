/**
 * lib/portfolio.ts
 * Helpers for the token portfolio dashboard (issue #362): deriving each
 * wallet holding's Soroban contract ID, custom-token + fiat-currency
 * preferences (localStorage, no UI), and live USD/EUR/GBP price snapshots
 * from CoinGecko.
 */

import { Asset } from "@stellar/stellar-sdk";
import { getBalances, NETWORK_PASSPHRASE, type WalletBalance } from "@/lib/stellar";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioToken {
  code: string;
  issuer?: string;
  contractId: string;
  balance: string;
  isCustom?: boolean;
}

export type FiatCurrency = "USD" | "EUR" | "GBP";

export interface TokenPriceSnapshot {
  prices: Partial<Record<FiatCurrency, number>>;
  change24hPct: Partial<Record<FiatCurrency, number>>;
}

export interface CustomToken {
  contractId: string;
  addedAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUPPORTED_FIAT_CURRENCIES: FiatCurrency[] = ["USD", "EUR", "GBP"];

const CUSTOM_TOKENS_STORAGE_KEY = "finchippay:custom-tokens";
const FIAT_CURRENCY_STORAGE_KEY = "finchippay:fiat-currency";

/** Soroban contract ID: 'C' + 55 base-32 chars (StrKey format). */
const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

export function isValidContractId(contractId: string): boolean {
  return CONTRACT_ID_REGEX.test(contractId);
}

// ─── Portfolio holdings (Horizon balances -> contract IDs) ────────────────────

function assetFromBalance(balance: WalletBalance): Asset {
  if (balance.asset === "native") return Asset.native();
  const [code, issuer] = balance.asset.split(":");
  return new Asset(code, issuer);
}

/**
 * Load the connected wallet's holdings and derive each one's SEP-41
 * contract ID via `Asset.contractId()` — every classic Stellar asset (XLM,
 * trustlines) has a deterministic contract ID, so this is the bridge between
 * Horizon balances and the contract-ID-keyed price-history API.
 */
export async function getPortfolioHoldings(publicKey: string): Promise<PortfolioToken[]> {
  const balances = await getBalances(publicKey);
  return balances.map((b) => {
    const asset = assetFromBalance(b);
    const issuer = b.asset === "native" ? undefined : b.asset.split(":")[1];
    return {
      code: b.assetCode,
      issuer,
      contractId: asset.contractId(NETWORK_PASSPHRASE),
      balance: b.balance,
    };
  });
}

// ─── Custom tokens (localStorage) ─────────────────────────────────────────────

export function loadCustomTokens(): CustomToken[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is CustomToken => typeof t?.contractId === "string" && isValidContractId(t.contractId)
    );
  } catch {
    return [];
  }
}

function saveCustomTokens(tokens: CustomToken[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
}

/** Add a custom token by contract ID. Throws if the format is invalid. */
export function addCustomToken(contractId: string): CustomToken[] {
  const trimmed = contractId.trim();
  if (!isValidContractId(trimmed)) {
    throw new Error("Invalid Soroban contract ID");
  }
  const existing = loadCustomTokens();
  if (existing.some((t) => t.contractId === trimmed)) return existing;

  const updated = [...existing, { contractId: trimmed, addedAt: Date.now() }];
  saveCustomTokens(updated);
  return updated;
}

export function removeCustomToken(contractId: string): CustomToken[] {
  const updated = loadCustomTokens().filter((t) => t.contractId !== contractId);
  saveCustomTokens(updated);
  return updated;
}

// ─── Fiat currency preference (localStorage) ──────────────────────────────────

export function getPreferredFiatCurrency(): FiatCurrency {
  if (typeof window === "undefined") return "USD";
  const stored = localStorage.getItem(FIAT_CURRENCY_STORAGE_KEY);
  return (SUPPORTED_FIAT_CURRENCIES as string[]).includes(stored || "")
    ? (stored as FiatCurrency)
    : "USD";
}

export function setPreferredFiatCurrency(currency: FiatCurrency): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FIAT_CURRENCY_STORAGE_KEY, currency);
}

// ─── Live price snapshots (CoinGecko) ─────────────────────────────────────────

/**
 * CoinGecko asset IDs for the tokens we can price. Tokens without an entry
 * here (e.g. a custom token added by contract ID) simply won't have a price
 * snapshot — callers must render a graceful "unavailable" state.
 */
export const COINGECKO_ID_MAP: Record<string, string> = {
  XLM: "stellar",
  USDC: "usd-coin",
};

const VS_CURRENCY: Record<FiatCurrency, string> = {
  USD: "usd",
  EUR: "eur",
  GBP: "gbp",
};

/**
 * Fetch current price + 24h change (in every supported fiat currency, one
 * request) for the given asset codes. Codes with no CoinGecko mapping are
 * silently omitted from the result.
 */
export async function fetchTokenPrices(
  codes: string[]
): Promise<Record<string, TokenPriceSnapshot>> {
  const ids = [...new Set(codes.map((c) => COINGECKO_ID_MAP[c]).filter(Boolean))];
  if (ids.length === 0) return {};

  const vsCurrencies = SUPPORTED_FIAT_CURRENCIES.map((c) => VS_CURRENCY[c]).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(
    ","
  )}&vs_currencies=${vsCurrencies}&include_24hr_change=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);

  const data = (await res.json()) as Record<string, Record<string, number>>;

  const result: Record<string, TokenPriceSnapshot> = {};
  for (const code of codes) {
    const geckoId = COINGECKO_ID_MAP[code];
    const entry = geckoId ? data[geckoId] : undefined;
    if (!entry) continue;

    const prices: Partial<Record<FiatCurrency, number>> = {};
    const change24hPct: Partial<Record<FiatCurrency, number>> = {};
    for (const fiat of SUPPORTED_FIAT_CURRENCIES) {
      const vs = VS_CURRENCY[fiat];
      if (entry[vs] !== undefined) prices[fiat] = entry[vs];
      if (entry[`${vs}_24h_change`] !== undefined) change24hPct[fiat] = entry[`${vs}_24h_change`];
    }
    result[code] = { prices, change24hPct };
  }
  return result;
}


// --- Price cache (localStorage, 5-minute TTL) ---

const PRICE_CACHE_KEY = "finchippay:portfolio-price-cache";
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

interface PriceCacheEntry {
  prices: Record<string, TokenPriceSnapshot>;
  cachedAt: number;
}

function loadPriceCache(): PriceCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PriceCacheEntry;
    if (!parsed?.prices || typeof parsed.cachedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePriceCache(prices: Record<string, TokenPriceSnapshot>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ prices, cachedAt: Date.now() }));
}

export async function fetchTokenPricesCached(
  codes: string[]
): Promise<{ prices: Record<string, TokenPriceSnapshot>; stale: boolean }> {
  const cached = loadPriceCache();
  const isFresh = cached !== null && Date.now() - cached.cachedAt < PRICE_CACHE_TTL_MS;

  if (isFresh) {
    return { prices: cached.prices, stale: false };
  }

  try {
    const prices = await fetchTokenPrices(codes);
    savePriceCache(prices);
    return { prices, stale: false };
  } catch (err) {
    if (cached) {
      return { prices: cached.prices, stale: true };
    }
    throw err;
  }
}


// --- P&L tracking (daily portfolio value snapshots, localStorage) ---

export interface PortfolioValueSnapshot {
  date: string;
  totalValue: number;
}

const PORTFOLIO_HISTORY_KEY = "finchippay:portfolio-value-history";
const MAX_HISTORY_DAYS = 90;

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadPortfolioHistory(): PortfolioValueSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PORTFOLIO_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is PortfolioValueSnapshot =>
        typeof s?.date === "string" && typeof s?.totalValue === "number"
    );
  } catch {
    return [];
  }
}

/**
 * Records today's total portfolio value, replacing any existing snapshot
 * for today (idempotent per calendar day) and trimming to the last 90 days.
 */
export function recordPortfolioValueSnapshot(totalValue: number): void {
  if (typeof window === "undefined") return;
  const history = loadPortfolioHistory();
  const today = todayDateKey();
  const withoutToday = history.filter((s) => s.date !== today);
  const updated = [...withoutToday, { date: today, totalValue }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_HISTORY_DAYS);
  localStorage.setItem(PORTFOLIO_HISTORY_KEY, JSON.stringify(updated));
}

export interface PnLResult {
  absolute: number;
  percent: number | null;
}

/**
 * Computes P&L over the last N days by comparing the current total value
 * against the closest available snapshot at or before that many days ago.
 * Returns null percent (only absolute, treated as 0) when there's no
 * baseline snapshot old enough to compare against yet.
 */
export function calculatePnL(currentValue: number, days: number): PnLResult {
  const history = loadPortfolioHistory();
  if (history.length === 0) return { absolute: 0, percent: null };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const baseline = [...history].reverse().find((s) => s.date <= cutoffKey);
  if (!baseline) return { absolute: 0, percent: null };

  const absolute = currentValue - baseline.totalValue;
  const percent = baseline.totalValue > 0 ? (absolute / baseline.totalValue) * 100 : null;
  return { absolute, percent };
}

// ─── Tax reporting: FIFO cost basis (issue #605) ─────────────────────────────

/**
 * A single FIFO acquisition lot. `remaining` shrinks as later disposals
 * consume it from the oldest lot first.
 */
export interface TaxLot {
  asset: string;
  /** ISO date (YYYY-MM-DD) the lot was acquired on. */
  acquiredAt: string;
  /** Quantity acquired in this lot. */
  quantity: number;
  /** Fiat cost per unit at acquisition (from historical price). */
  unitCost: number;
  /** Quantity still held from this lot (after FIFO disposals). */
  remaining: number;
}

export interface AssetTaxPosition {
  asset: string;
  lots: TaxLot[];
  /** Total fiat spent acquiring this asset (all lots). */
  totalAcquired: number;
  /** Total fiat received from disposals (sales). */
  totalDisposed: number;
  /** Remaining quantity still held. */
  remainingQty: number;
  /** Fiat cost basis of the remaining held quantity. */
  costBasis: number;
  /** Realized gain/loss from disposals. */
  realizedGain: number;
  /** Unrealized gain/loss on the remaining held quantity. */
  unrealizedGain: number;
  /** True when any lot lacked a historical price (cost basis is incomplete). */
  unpriced: boolean;
}

export interface TaxReport {
  currency: FiatCurrency;
  positions: AssetTaxPosition[];
  totalRealizedGain: number;
  totalUnrealizedGain: number;
  generatedAt: string;
}

/** Minimal shape the FIFO engine needs from a payment/operation record. */
export interface TaxEventInput {
  type: string;
  amount: string;
  asset: string;
  createdAt: string;
}

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateKey(iso: string): string {
  return (iso || "").slice(0, 10);
}

/**
 * Compute FIFO cost basis + realized/unrealized gains from a chronological
 * feed of payment/operation events.
 *
 * - `received` events open a new acquisition lot priced at `priceAt(asset, date)`.
 * - `sent` events dispose against the oldest remaining lot (FIFO); sale
 *   proceeds are also valued at `priceAt(asset, date)`.
 * - Swap/trade operations are surfaced as paired sent (out) + received (in)
 *   records by the caller, so they are taxed naturally here.
 *
 * `priceAt` must return a fiat unit price for the asset on the given date, or
 * `null` when unavailable. When a price is missing the position is flagged
 * `unpriced` and that event's contribution to gains is skipped (cost basis is
 * reported as incomplete rather than wrong).
 */
export function computeFIFOTaxReport(
  records: TaxEventInput[],
  priceAt: (asset: string, date: string) => number | null,
  currency: FiatCurrency = "USD"
): TaxReport {
  const byAsset = new Map<string, TaxLot[]>();
  const unpricedAssets = new Set<string>();
  let totalRealized = 0;
  let totalUnrealized = 0;

  const sorted = [...records].sort((a, b) =>
    (a.createdAt || "").localeCompare(b.createdAt || "")
  );

  for (const rec of sorted) {
    const asset = rec.asset;
    const qty = toNumber(rec.amount);
    if (qty <= 0) continue;
    const date = dateKey(rec.createdAt);
    const price = priceAt(asset, date);
    const priced = price !== null && price > 0;

    if (!priced) unpricedAssets.add(asset);

    let lots = byAsset.get(asset);
    if (!lots) {
      lots = [];
      byAsset.set(asset, lots);
    }

    if (rec.type === "received") {
      lots.push({
        asset,
        acquiredAt: date,
        quantity: qty,
        unitCost: priced ? price : 0,
        remaining: qty,
      });
    } else if (rec.type === "sent") {
      // Dispose FIFO from oldest lot.
      let remainingToSell = qty;
      let costBasisSold = 0;
      while (remainingToSell > 1e-9 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.remaining, remainingToSell);
        costBasisSold += take * lot.unitCost;
        lot.remaining -= take;
        remainingToSell -= take;
        if (lot.remaining <= 1e-9) lots.shift();
      }
      if (priced) {
        const proceeds = qty * price;
        // If some quantity couldn't be matched to a lot (no prior buy), treat
        // it as zero-cost for a conservative realized gain.
        totalRealized += proceeds - costBasisSold;
      }
    }
  }

  const positions: AssetTaxPosition[] = [];
  // Find the latest event date for unrealized-gain valuation.
  const latestDate = sorted.length > 0 ? dateKey(sorted[sorted.length - 1].createdAt) : "";
  for (const [asset, lots] of byAsset) {
    const remainingQty = lots.reduce((s, l) => s + l.remaining, 0);
    const costBasis = lots.reduce((s, l) => s + l.remaining * l.unitCost, 0);
    const totalAcquired = lots.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const unpriced = unpricedAssets.has(asset);
    // Value remaining lots at the latest available price.
    const currentPrice = priceAt(asset, latestDate);
    const unrealizedGain =
      currentPrice !== null && currentPrice > 0 && !unpriced
        ? remainingQty * currentPrice - costBasis
        : 0;
    totalUnrealized += unrealizedGain;

    positions.push({
      asset,
      lots,
      totalAcquired,
      totalDisposed: 0,
      remainingQty,
      costBasis,
      realizedGain: 0,
      unrealizedGain,
      unpriced,
    });
  }

  // Realized gain is tracked at the report level because it spans matched lots.
  return {
    currency,
    positions,
    totalRealizedGain: totalRealized,
    totalUnrealizedGain: totalUnrealized,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Fetch ~daily historical prices for a CoinGecko-mapped asset and return a
 * lookup `dateKey(YYYY-MM-DD) -> price` for the requested fiat currency.
 * Falls back to the live price for recent dates when the series is sparse.
 */
export async function fetchHistoricalPrices(
  code: string,
  currency: FiatCurrency,
  days = 365
): Promise<Record<string, number>> {
  const geckoId = COINGECKO_ID_MAP[code];
  if (!geckoId) return {};
  const vs = VS_CURRENCY[currency];
  const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=${vs}&days=${days}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const data = (await res.json()) as { prices?: [number, number][] };
  const map: Record<string, number> = {};
  for (const [ts, price] of data.prices || []) {
    const d = new Date(ts).toISOString().slice(0, 10);
    map[d] = price;
  }
  return map;
}

/** Build a `priceAt` closure from a preloaded per-asset historical map. */
export function historicalPriceLookup(
  history: Record<string, Record<string, number>>,
  live: Record<string, number>
): (asset: string, date: string) => number | null {
  return (asset, date) => {
    const series = history[asset];
    if (series) {
      if (series[date] !== undefined) return series[date];
      // Walk backwards a few days for weekend/holiday gaps.
      const d = new Date(date + "T00:00:00Z");
      for (let i = 1; i <= 5; i++) {
        d.setUTCDate(d.getUTCDate() - 1);
        const k = d.toISOString().slice(0, 10);
        if (series[k] !== undefined) return series[k];
      }
    }
    return live[asset] ?? null;
  };
}
