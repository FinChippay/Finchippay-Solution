import type { Config } from "tailwindcss";
import { colors } from "./tokens/colors";

const config: Config = {
  // Issue #19 — Add dark/light mode toggle | FinChippay/Finchippay-Solution
  // Enable class-based dark mode so toggling 'dark' on <html> activates dark styles
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./stories/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        textPrimary: {
          light: colors.textPrimary.light,
          dark: colors.textPrimary.dark,
          high: colors.textPrimary.highContrast,
        },
        textSecondary: {
          light: colors.textSecondary.light,
          dark: colors.textSecondary.dark,
          high: colors.textSecondary.highContrast,
        },
        bgPrimary: {
          light: colors.bgPrimary.light,
          dark: colors.bgPrimary.dark,
          high: colors.bgPrimary.highContrast,
        },
        bgSecondary: {
          light: colors.bgSecondary.light,
          dark: colors.bgSecondary.dark,
          high: colors.bgSecondary.highContrast,
        },
        border: {
          light: colors.border.light,
          dark: colors.border.dark,
          high: colors.border.highContrast,
        },
        link: {
          light: colors.link.light,
          dark: colors.link.dark,
          high: colors.link.highContrast,
        },
        focusRing: {
          light: colors.focusRing.light,
          dark: colors.focusRing.dark,
          high: colors.focusRing.highContrast,
        },
        stellar: {
          50:  "var(--stellar-50)",
          100: "var(--stellar-100)",
          200: "var(--stellar-200)",
          300: "var(--stellar-300)",
          400: "var(--stellar-400)",
          500: "var(--stellar-500)",
          600: "var(--stellar-600)",
          700: "var(--stellar-700)",
          800: "var(--stellar-800)",
          900: "var(--stellar-900)",
        },
        cosmos: {
          900: "#050a1a",
          800: "#0a1628",
          700: "#0f2040",
          600: "#142a58",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-in-out",
        "slide-up": "slideUp 0.4s ease-out",
        "slide-down": "slideDown 0.4s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [
    ({ addVariant }: { addVariant: (name: string, selector: string) => void }) => {
      // Prefix utilities with `rtl:` when an ancestor (normally <html>) is RTL.
      addVariant("rtl", '[dir="rtl"] &');
    },
  ],
};

export default config;
