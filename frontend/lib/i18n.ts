/**
 * lib/i18n.ts
 * i18n configuration using i18next with browser language detection.
 *
 * Language preference is persisted in localStorage under "finchippay:lang"
 * and falls back to browser preference, then English.
 *
 * Supported locales: English (en), Spanish (es), French (fr), Arabic (ar), Hebrew (he)
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "@/public/locales/en/common.json";
import esCommon from "@/public/locales/es/common.json";
import frCommon from "@/public/locales/fr/common.json";
import arCommon from "@/public/locales/ar/common.json";
import heCommon from "@/public/locales/he/common.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "ar", name: "Arabic", nativeName: "العربية", direction: "rtl" },
  { code: "he", name: "Hebrew", nativeName: "עברית", direction: "rtl" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const LANGUAGE_STORAGE_KEY = "finchippay:lang";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon },
      es: { common: esCommon },
      fr: { common: frCommon },
      ar: { common: arCommon },
      he: { common: heCommon },
    },
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    react: {
      useSuspense: false,
    },
  });

/**
 * Get the currently active language code from i18next.
 */
export function getCurrentLanguage(): SupportedLanguage {
  const lang = i18n.language?.split("-")[0];
  if (lang === "es" || lang === "fr" || lang === "ar" || lang === "he") return lang;
  return "en";
}

/**
 * Change the application language and persist to localStorage.
 */
export function setLanguage(lang: SupportedLanguage): void {
  i18n.changeLanguage(lang);
  if (typeof window !== "undefined") {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }
}

export default i18n;
