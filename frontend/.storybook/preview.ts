import type { Preview } from "@storybook/nextjs-vite";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "../lib/ThemeContext";
import { ToastProvider } from "../lib/ToastContext";
import { WalletProvider } from "../lib/useWallet";
import i18n, { initializeStorybookI18n } from "./i18n";
import "../styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      options: {
        dark: { name: "dark", value: "#050a1a" },
        light: { name: "light", value: "#f0f6ff" },
      },
    },
    viewport: {
      options: INITIAL_VIEWPORTS,
    },
    nextjs: {
      appDirectory: false,
    },
  },

  beforeAll: initializeStorybookI18n,

  decorators: [
    (Story) =>
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          ThemeProvider,
          null,
          createElement(
            ToastProvider,
            null,
            createElement(WalletProvider, null, createElement(Story)),
          ),
        ),
      ),
  ],

  initialGlobals: {
    backgrounds: {
      value: "light",
    },
  },
};

export default preview;
