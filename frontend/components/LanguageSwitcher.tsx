/**
 * components/LanguageSwitcher.tsx
 * Compact language switcher with built-in RTL support (#357).
 *
 * Renders a dropdown of all supported languages, calling setLanguage() to
 * update i18next on change. Right-to-left languages (Arabic, Hebrew)
 * additionally call syncDocumentDirection() so flow root carries
 * `dir="rtl"` — once that attribute is set the existing
 * [dir="rtl"] rules in globals.css and rtl.css do the rest.
 *
 * The button itself uses bidi-ltr so it stays in logical left-to-right
 * order even when the surrounding UI is RTL.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  setLanguage,
  type SupportedLanguage,
} from "@/lib/i18n";
import { syncDocumentDirection } from "@/lib/useDirection";

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current =
    (i18n.language?.split("-")[0] as SupportedLanguage) || "en";

  const handleChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as SupportedLanguage;
    setLanguage(next);
    syncDocumentDirection(next);
  }, []);

  return (
    <label className="flex items-center gap-2 bidi-ltr">
      <span className="sr-only">Language</span>
      <select
        value={current}
        onChange={handleChange}
        aria-label="Select language"
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-stellar-400 dark:border-slate-700 dark:bg-cosmos-800 dark:text-slate-100"
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
