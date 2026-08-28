import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import arCommon from "@/public/locales/ar/common.json";
import enCommon from "@/public/locales/en/common.json";
import esCommon from "@/public/locales/es/common.json";
import frCommon from "@/public/locales/fr/common.json";
import heCommon from "@/public/locales/he/common.json";
import jaCommon from "@/public/locales/ja/common.json";
import ptCommon from "@/public/locales/pt/common.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ar", name: "Arabic", nativeName: "العربية", direction: "rtl" },
  { code: "he", name: "Hebrew", nativeName: "עברית", direction: "rtl" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const LANGUAGE_STORAGE_KEY = "finchippay:lang";

const detector = (LanguageDetector as any)?.default || LanguageDetector;
if (detector) {
  i18n.use(detector);
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    es: { common: esCommon },
    fr: { common: frCommon },
    ar: { common: arCommon },
    he: { common: heCommon },
    ja: { common: jaCommon },
    pt: { common: ptCommon },
  },
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  detection: {
    order: ["localStorage", "navigator"],
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    caches: ["localStorage"],
  },
  react: { useSuspense: false },
});

export function getCurrentLanguage(): SupportedLanguage {
  const lang = i18n.language?.split("-")[0];
  if (lang === "es" || lang === "fr" || lang === "ja" || lang === "pt" || lang === "ar" || lang === "he") return lang;
  return "en";
}

export function setLanguage(lang: SupportedLanguage): void {
  i18n.changeLanguage(lang);
  if (typeof window !== "undefined") localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

export default i18n;
