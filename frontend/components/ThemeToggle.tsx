/**
 * components/ThemeToggle.tsx
 * Accessible light, dark, and system theme selector.
 */

import { useEffect, useRef, useState } from "react";
import { MoonIcon, SunIcon } from "@/components/icons";
import { useTheme, type Theme } from "@/lib/ThemeContext";

interface SystemIconProps {
  className?: string;
}

function SystemIcon({ className }: SystemIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5.75A1.75 1.75 0 015.75 4h12.5A1.75 1.75 0 0120 5.75v9.5A1.75 1.75 0 0118.25 17H5.75A1.75 1.75 0 014 15.25v-9.5z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 20h6M12 17v3"
      />
    </svg>
  );
}

const themeOptions: Array<{
  value: Theme;
  label: string;
  description: string;
}> = [
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme",
  },
  {
    value: "system",
    label: "System",
    description: "Follow your device preference",
  },
];

function ThemeOptionIcon({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  if (theme === "light") {
    return <SunIcon className={className} />;
  }

  if (theme === "dark") {
    return <MoonIcon className={className} />;
  }

  return <SystemIcon className={className} />;
}

export default function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  if (!isMounted) {
    return (
      <div
        className="h-9 w-9 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-cosmos-800"
        aria-hidden="true"
      />
    );
  }

  const currentThemeLabel =
    theme === "system"
      ? `System theme, currently ${resolved}`
      : `${theme} theme`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        aria-label={`Change theme. Current selection: ${currentThemeLabel}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={`Theme: ${currentThemeLabel}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors duration-200 hover:border-stellar-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-stellar-400 focus:ring-offset-2 focus:ring-offset-white dark:border-slate-700 dark:bg-cosmos-800 dark:text-slate-100 dark:hover:border-stellar-500 dark:hover:bg-cosmos-700 dark:focus:ring-offset-cosmos-900"
      >
        <ThemeOptionIcon theme={theme} className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Theme options"
          className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-cosmos-800"
        >
          {themeOptions.map((option) => {
            const isSelected = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setTheme(option.value);
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-white/5 dark:focus:bg-white/5"
              >
                <span
                  className={
                    isSelected
                      ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stellar-100 text-stellar-700 dark:bg-stellar-500/15 dark:text-stellar-300"
                      : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-cosmos-700 dark:text-slate-300"
                  }
                >
                  <ThemeOptionIcon
                    theme={option.value}
                    className="h-4 w-4"
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 dark:text-white">
                    {option.label}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {option.description}
                  </span>
                </span>

                <span
                  className={
                    isSelected
                      ? "h-2 w-2 rounded-full bg-stellar-500"
                      : "h-2 w-2 rounded-full bg-transparent"
                  }
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
