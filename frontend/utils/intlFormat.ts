// frontend/utils/intlFormat.ts
/**
 * Locale-aware formatting built on the ECMA-402 `Intl` API.
 * Replaces ad-hoc toFixed()/toLocaleString() calls so numbers, currencies,
 * dates and relative times follow the conventions of the user's locale.
 */

export type SupportedLocale = 'en' | 'es' | 'fr' | 'ja' | 'pt' | 'ar' | 'he';

const DEFAULT_LOCALE: SupportedLocale = 'en';

/** BCP-47 tags used for each supported UI locale. */
const LOCALE_TAGS: Record<SupportedLocale, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ja: 'ja-JP',
  pt: 'pt-BR',
  ar: 'ar-SA',
  he: 'he-IL',
};

// ---- Intl feature detection (graceful fallback for older browsers) ----

export function isIntlSupported(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.NumberFormat !== 'undefined';
}

export function isDateTimeFormatSupported(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat !== 'undefined';
}

export function isRelativeTimeFormatSupported(): boolean {
  return typeof Intl !== 'undefined' && typeof (Intl as any).RelativeTimeFormat !== 'undefined';
}

function resolveLocaleTag(locale: string): string {
  return LOCALE_TAGS[locale as SupportedLocale] ?? locale ?? LOCALE_TAGS[DEFAULT_LOCALE];
}

// ---- Numbers ----

/**
 * en -> "1,234.56"   es -> "1.234,56"   fr -> "1 234,56"
 */
export function formatNumber(
  value: number,
  locale: string = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {}
): string {
  if (!isIntlSupported()) return value.toString();

  try {
    return new Intl.NumberFormat(resolveLocaleTag(locale), options).format(value);
  } catch {
    // Unknown locale tag -> fall back to English rather than throwing.
    return new Intl.NumberFormat(LOCALE_TAGS[DEFAULT_LOCALE], options).format(value);
  }
}

// ---- Currency ----

/**
 * Stellar-native assets (XLM, and other Soroban tokens) aren't registered
 * ISO-4217 currencies, so `currencyDisplay` defaults to "code" — this
 * renders "1.234,56 XLM" instead of guessing at (or failing to find) a
 * currency symbol. Pass `{ currencyDisplay: 'symbol' }` for real fiat
 * currencies (USD, EUR) where a symbol is wanted instead.
 */
export function formatCurrency(
  amount: number,
  currency: string = 'XLM',
  locale: string = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {}
): string {
  if (!isIntlSupported()) return `${amount.toFixed(2)} ${currency}`;

  const localeTag = resolveLocaleTag(locale);

  try {
    return new Intl.NumberFormat(localeTag, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 7, // Stellar amounts support up to 7 decimals
      ...options,
    }).format(amount);
  } catch {
    // Malformed currency code -> plain number + code, never throw to the UI.
    return `${formatNumber(amount, locale)} ${currency}`;
  }
}

// ---- Dates ----

/**
 * en -> "07/23/2026"   fr -> "23/07/2026"   es -> "23/7/2026"
 */
export function formatDate(
  date: Date | number | string,
  locale: string = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = date instanceof Date ? date : new Date(date);

  if (!isDateTimeFormatSupported()) return d.toISOString().slice(0, 10);

  try {
    return new Intl.DateTimeFormat(resolveLocaleTag(locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...options,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(LOCALE_TAGS[DEFAULT_LOCALE], options).format(d);
  }
}

// ---- Relative time ----

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

/**
 * "3 hours ago" (en) / "hace 3 horas" (es) / "il y a 3 heures" (fr)
 */
export function formatRelativeTime(
  date: Date | number | string,
  locale: string = DEFAULT_LOCALE
): string {
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = d.getTime() - Date.now();

  if (!isRelativeTimeFormatSupported()) return formatDate(d, locale);

  const rtf = new Intl.RelativeTimeFormat(resolveLocaleTag(locale), { numeric: 'auto' });

  for (const { unit, ms } of RELATIVE_UNITS) {
    const delta = diffMs / ms;
    if (Math.abs(delta) >= 1 || unit === 'second') {
      return rtf.format(Math.round(delta), unit);
    }
  }
  return rtf.format(0, 'second');
}
