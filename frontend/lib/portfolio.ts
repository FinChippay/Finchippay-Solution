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

export const CUSTOM_TOKENS_STORAGE_KEY = "finchippay:custom-tokens";
export const CUSTOM_TOKENS_STORAGE_VERSION = 1;
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

  let shouldPersist = false;
  try {
    const raw = localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed)
      ? parsed
      : parsed?.version === CUSTOM_TOKENS_STORAGE_VERSION && Array.isArray(parsed.tokens)
        ? parsed.tokens
        : [];
    shouldPersist = !Array.isArray(parsed) && source.length === 0;

    const tokens = source
      .map(reviveCustomToken)
      .filter((token): token is CustomToken => token !== null);
    const deduped = [...new Map(tokens.map((token) => [token.contractId, token])).values()];
    shouldPersist ||= !isCurrentTokenPayload(parsed, deduped);

    if (shouldPersist) saveCustomTokens(deduped);
    return deduped;
  } catch {
    saveCustomTokens([]);
    return [];
  }
}

function reviveCustomToken(value: unknown): CustomToken | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const contractId = typeof raw.contractId === "string" ? raw.contractId.trim() : "";
  if (!isValidContractId(contractId)) return null;

  const addedAt = typeof raw.addedAt === "number" ? raw.addedAt : Number(raw.addedAt);
  return {
    contractId,
    addedAt: Number.isFinite(addedAt) && addedAt >= 0 ? addedAt : 0,
  };
}

function isCurrentTokenPayload(value: unknown, tokens: CustomToken[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === CUSTOM_TOKENS_STORAGE_VERSION &&
    JSON.stringify(payload.tokens) === JSON.stringify(tokens)
  );
}

function saveCustomTokens(tokens: CustomToken[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CUSTOM_TOKENS_STORAGE_KEY,
      JSON.stringify({ version: CUSTOM_TOKENS_STORAGE_VERSION, tokens }),
    );
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
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
