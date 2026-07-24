/**
 * lib/ThemeContext.tsx
 * Application-wide light, dark, and system theme management.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

interface ThemeProviderProps {
  children: ReactNode;
}

const THEME_STORAGE_KEY = "finchippay:theme";
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const LIGHT_THEME_COLOR = "#f0f6ff";
const DARK_THEME_COLOR = "#050a1a";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function getInitialResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return theme;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(
    getInitialResolvedTheme,
  );

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still works for the current session when
      // localStorage is unavailable.
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);

    const applyResolvedTheme = () => {
      const nextResolvedTheme = resolveTheme(theme, mediaQuery.matches);
      const root = document.documentElement;

      setResolved(nextResolvedTheme);

      root.classList.toggle("dark", nextResolvedTheme === "dark");
      root.dataset.theme = theme;
      root.style.colorScheme = nextResolvedTheme;

      const themeColorMeta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]',
      );

      themeColorMeta?.setAttribute(
        "content",
        nextResolvedTheme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
      );
    };

    const handleSystemThemeChange = () => {
      if (theme === "system") {
        applyResolvedTheme();
      }
    };

    applyResolvedTheme();

    if (theme === "system") {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
    }

    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, [theme]);

  const contextValue = useMemo(
    () => ({
      theme,
      resolved,
      setTheme,
    }),
    [resolved, setTheme, theme],
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
