import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type AccentName =
  | "stellar"
  | "emerald"
  | "violet"
  | "amber"
  | "rose"
  | "teal"
  | "indigo"
  | "slate";
export type FontSize = "small" | "medium" | "large";
export type ResolvedTheme = "light" | "dark" | "high-contrast";

export const ACCENT_COLOURS: Record<AccentName, { base: string; hover: string; light: string; border: string; label: string }> = {
  stellar:  { base: "#0ea5e9", hover: "#0284c7", light: "rgba(14,165,233,0.1)", border: "rgba(14,165,233,0.2)", label: "Stellar" },
  emerald:  { base: "#10b981", hover: "#059669", light: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)", label: "Emerald" },
  violet:   { base: "#8b5cf6", hover: "#7c3aed", light: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.2)", label: "Violet" },
  amber:    { base: "#f59e0b", hover: "#d97706", light: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.2)",  label: "Amber" },
  rose:     { base: "#f43f5e", hover: "#e11d48", light: "rgba(244,63,94,0.1)",   border: "rgba(244,63,94,0.2)",   label: "Rose" },
  teal:     { base: "#14b8a6", hover: "#0d9488", light: "rgba(20,184,166,0.1)",  border: "rgba(20,184,166,0.2)",  label: "Teal" },
  indigo:   { base: "#6366f1", hover: "#4f46e5", light: "rgba(99,102,241,0.1)",  border: "rgba(99,102,241,0.2)",  label: "Indigo" },
  slate:    { base: "#64748b", hover: "#475569", light: "rgba(100,116,139,0.1)", border: "rgba(100,116,139,0.2)", label: "Slate" },
};

export interface ThemePreferences {
  mode: ThemeMode;
  accent: AccentName;
  fontSize: FontSize;
  highContrast: boolean;
}

interface ThemeContextValue {
  theme: ThemeMode;
  resolved: ResolvedTheme;
  accent: AccentName;
  fontSize: FontSize;
  highContrast: boolean;
  preferences: ThemePreferences;
  setTheme: (mode: ThemeMode) => void;
  setAccent: (accent: AccentName) => void;
  setFontSize: (size: FontSize) => void;
  setHighContrast: (enabled: boolean) => void;
  resetToDefaults: () => void;
}

interface ThemeProviderProps {
  children: ReactNode;
}

const THEME_STORAGE_KEY = "finchippay:theme";
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const LIGHT_THEME_COLOR = "#f0f6ff";
const DARK_THEME_COLOR = "#050a1a";

const DEFAULT_PREFERENCES: ThemePreferences = {
  mode: "system",
  accent: "stellar",
  fontSize: "medium",
  highContrast: false,
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function parseStoredPreferences(): ThemePreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      mode: ["light", "dark", "system"].includes(parsed.mode) ? parsed.mode : DEFAULT_PREFERENCES.mode,
      accent: Object.keys(ACCENT_COLOURS).includes(parsed.accent) ? parsed.accent : DEFAULT_PREFERENCES.accent,
      fontSize: ["small", "medium", "large"].includes(parsed.fontSize) ? parsed.fontSize : DEFAULT_PREFERENCES.fontSize,
      highContrast: typeof parsed.highContrast === "boolean" ? parsed.highContrast : DEFAULT_PREFERENCES.highContrast,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function getInitialResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}

function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

function applyThemeToDocument(prefs: ThemePreferences) {
  const root = document.documentElement;
  const systemPrefersDark = window.matchMedia(DARK_MODE_MEDIA_QUERY).matches;
  const effectiveMode = prefs.highContrast ? "high-contrast" : prefs.mode;
  const resolved = prefs.highContrast ? "high-contrast" : resolveTheme(prefs.mode, systemPrefersDark);

  root.classList.toggle("dark", resolved === "dark" || resolved === "high-contrast");
  root.dataset.theme = effectiveMode;
  root.dataset.accent = prefs.accent;
  root.dataset.fontSize = prefs.fontSize;
  root.style.colorScheme = resolved === "high-contrast" ? "dark" : resolved;

  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute(
      "content",
      resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
    );
  }
}

async function syncPreferencesToBackend(publicKey: string | null, prefs: ThemePreferences) {
  if (!publicKey) return;
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
    await fetch(`${apiBase}/api/users/${encodeURIComponent(publicKey)}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
  } catch {
    // Backend sync is best-effort
  }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preferences, setPreferencesState] = useState<ThemePreferences>(parseStoredPreferences);
  const [resolved, setResolved] = useState<ResolvedTheme>(getInitialResolvedTheme);

  const persist = useCallback((next: ThemePreferences) => {
    setPreferencesState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Session-only fallback
    }
    applyThemeToDocument(next);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    persist({ ...parseStoredPreferences(), mode, highContrast: false });
  }, [persist]);

  const setAccent = useCallback((accent: AccentName) => {
    persist({ ...parseStoredPreferences(), accent });
  }, [persist]);

  const setFontSize = useCallback((fontSize: FontSize) => {
    persist({ ...parseStoredPreferences(), fontSize });
  }, [persist]);

  const setHighContrast = useCallback((highContrast: boolean) => {
    persist({ ...parseStoredPreferences(), highContrast });
  }, [persist]);

  const resetToDefaults = useCallback(() => {
    persist({ ...DEFAULT_PREFERENCES });
  }, [persist]);

  useEffect(() => {
    applyThemeToDocument(preferences);
    setResolved(
      preferences.highContrast
        ? "high-contrast"
        : resolveTheme(preferences.mode, window.matchMedia(DARK_MODE_MEDIA_QUERY).matches),
    );
  }, [preferences]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);

    const handleSystemThemeChange = () => {
      if (preferences.mode === "system" && !preferences.highContrast) {
        const nextResolved = resolveTheme("system", mediaQuery.matches);
        setResolved(nextResolved);
        const root = document.documentElement;
        root.classList.toggle("dark", nextResolved === "dark");
        root.style.colorScheme = nextResolved;
        const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute(
            "content",
            nextResolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
          );
        }
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [preferences.mode, preferences.highContrast]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme: preferences.mode,
      resolved,
      accent: preferences.accent,
      fontSize: preferences.fontSize,
      highContrast: preferences.highContrast,
      preferences,
      setTheme,
      setAccent,
      setFontSize,
      setHighContrast,
      resetToDefaults,
    }),
    [preferences, resolved, setTheme, setAccent, setFontSize, setHighContrast, resetToDefaults],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
