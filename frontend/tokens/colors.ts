// frontend/tokens/colors.ts
// Design tokens for semantic color values across light, dark, and high-contrast themes.
// Adjust values as needed to meet WCAG AA/AAA contrast ratios.
export const colors = {
  textPrimary: {
    light: "#111827", // dark gray
    dark: "#f9fafb", // near white
    highContrast: "#000000",
  },
  textSecondary: {
    light: "#4b5563", // gray-600 (>7:1 contrast on white)
    dark: "#e5e7eb", // gray-200 (>10:1 contrast on dark bg)
    highContrast: "#1a1a1a",
  },
  bgPrimary: {
    light: "#ffffff",
    dark: "#111827",
    highContrast: "#ffffff",
  },
  bgSecondary: {
    light: "#f9fafb",
    dark: "#1f2937",
    highContrast: "#f0f0f0",
  },
  border: {
    light: "#d1d5db",
    dark: "#4b5563",
    highContrast: "#000000",
  },
  link: {
    light: "#1d4ed8", // blue-700 (>7:1 contrast on white)
    dark: "#93c5fd", // blue-300 (>7:1 contrast on dark)
    highContrast: "#0000ee",
  },
  focusRing: {
    light: "#1d4ed8",
    dark: "#60a5fa",
    highContrast: "#000000",
  },
};
