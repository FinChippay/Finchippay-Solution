import { useTheme, ACCENT_COLOURS, type AccentName, type FontSize, type ThemeMode } from "@/lib/ThemeContext";

const FONT_SIZES: Array<{ value: FontSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const MODES: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: "light", label: "Light", description: "Always light" },
  { value: "dark", label: "Dark", description: "Always dark" },
  { value: "system", label: "System", description: "Follow device" },
];

export default function ThemeSettings() {
  const { theme, accent, fontSize, highContrast, setTheme, setAccent, setFontSize, setHighContrast, resetToDefaults } = useTheme();

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Theme Mode</legend>
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((mode) => {
            const isActive = theme === mode.value && !highContrast;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => setTheme(mode.value)}
                className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                  isActive
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                    : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                }`}
              >
                <span className="block">{mode.label}</span>
                <span className="block text-xs mt-0.5 opacity-70">{mode.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Accent colour picker */}
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Accent Colour</legend>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {(Object.entries(ACCENT_COLOURS) as [AccentName, typeof ACCENT_COLOURS[AccentName]][]).map(([name, colours]) => (
            <button
              key={name}
              type="button"
              onClick={() => setAccent(name)}
              title={colours.label}
              className={`relative flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all ${
                accent === name
                  ? "ring-2 ring-offset-2 ring-[var(--color-accent)] dark:ring-offset-cosmos-900"
                  : "hover:ring-1 hover:ring-slate-300 dark:hover:ring-slate-600"
              }`}
              style={{ backgroundColor: colours.light }}
            >
              <span
                className="h-8 w-8 rounded-full border border-white/20"
                style={{ backgroundColor: colours.base }}
              />
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 truncate w-full text-center">
                {colours.label}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Font size selector */}
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Font Size</legend>
        <div className="grid grid-cols-3 gap-3">
          {FONT_SIZES.map((size) => {
            const isActive = fontSize === size.value;
            return (
              <button
                key={size.value}
                type="button"
                onClick={() => setFontSize(size.value)}
                className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                  isActive
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                    : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                }`}
              >
                <span className="block">{size.label}</span>
                <span className="block text-xs mt-1 opacity-70">
                  {size.value === "small" ? "14px" : size.value === "medium" ? "16px" : "18px"}
                </span>
                <span
                  className="block mt-1.5 text-slate-500 dark:text-slate-400 truncate"
                  style={{ fontSize: size.value === "small" ? "12px" : size.value === "medium" ? "14px" : "16px" }}
                >
                  The quick brown fox
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* High contrast toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">High Contrast</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Maximum readability (WCAG AAA)</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={highContrast}
          aria-label="Toggle high contrast mode"
          onClick={() => setHighContrast(!highContrast)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            highContrast ? "bg-[var(--color-accent)]" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ${
              highContrast ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Reset */}
      <button
        type="button"
        onClick={resetToDefaults}
        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        Reset to Defaults
      </button>
    </div>
  );
}
