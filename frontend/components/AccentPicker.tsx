/**
 * components/AccentPicker.tsx
 * Accent color selector for the settings page.
 */

import { useTheme, type Accent } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

const accentOptions: Array<{
  value: Accent;
  label: string;
  swatch: string;
  ring: string;
}> = [
  {
    value: "stellar",
    label: "settings.accentStellar",
    swatch: "bg-[#0ea5e9]",
    ring: "ring-stellar-500",
  },
  {
    value: "teal",
    label: "settings.accentTeal",
    swatch: "bg-[#14b8a6]",
    ring: "ring-[#14b8a6]",
  },
  {
    value: "amber",
    label: "settings.accentAmber",
    swatch: "bg-[#f59e0b]",
    ring: "ring-[#f59e0b]",
  },
  {
    value: "rose",
    label: "settings.accentRose",
    swatch: "bg-[#f43f5e]",
    ring: "ring-[#f43f5e]",
  },
  {
    value: "violet",
    label: "settings.accentViolet",
    swatch: "bg-[#8b5cf6]",
    ring: "ring-[#8b5cf6]",
  },
];

export default function AccentPicker() {
  const { t } = useTranslation("common");
  const { accent, setAccent } = useTheme();

  return (
    <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        {t("settings.accentTitle")}
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        {t("settings.accentDescription")}
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {accentOptions.map((option) => {
          const isSelected = accent === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setAccent(option.value)}
              className={`flex flex-col items-center gap-2 px-3 py-4 rounded-lg border text-sm font-medium transition-all ${
                isSelected
                  ? "border-stellar-500 bg-stellar-500/10 text-stellar-400"
                  : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
              }`}
              aria-label={t(option.label)}
              aria-pressed={isSelected}
            >
              <span
                className={`block h-8 w-8 rounded-full ${option.swatch} ${
                  isSelected
                    ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-cosmos-800"
                    : ""
                } ${option.ring}`}
                aria-hidden="true"
              />
              <span className="text-xs">{t(option.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}