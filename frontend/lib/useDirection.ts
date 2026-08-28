import { useMemo } from "react";

/** Locales whose base language is written right-to-left. */
export const RTL_LANGUAGES = ["ar", "he", "fa", "ur"] as const;

/**
 * Returns the document direction for a locale. Region subtags (for example
 * `ar-EG`) are intentionally supported as i18next may resolve to one.
 */
export function getDirection(locale?: string | null): "ltr" | "rtl" {
  const language = locale?.toLowerCase().split("-")[0];
  return RTL_LANGUAGES.includes(language as (typeof RTL_LANGUAGES)[number])
    ? "rtl"
    : "ltr";
}

/**
 * Memoized direction value for React components that receive a locale.
 */
/** Apply a locale's direction to the document without navigating or reloading. */
export function syncDocumentDirection(locale: string): "ltr" | "rtl" {
  const direction = getDirection(locale);
  if (typeof document !== "undefined") {
    document.documentElement.dir = direction;
    document.documentElement.lang = locale;
  }
  return direction;
}

export function useDirection(locale: string): "ltr" | "rtl" {
  return useMemo(() => getDirection(locale), [locale]);
}
