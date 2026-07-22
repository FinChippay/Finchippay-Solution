import type { Preview } from "@storybook/experimental-nextjs-vite";
import { INITIAL_VIEWPORTS } from "@storybook/addon-viewport";
import { createElement } from "react";
import { I18nextProvider } from "react-i18next";
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
      default: "dark",
      values: [
        { name: "dark", value: "#050a1a" },
        { name: "light", value: "#f0f6ff" },
      ],
    },
    viewport: {
      viewports: INITIAL_VIEWPORTS,
    },
    nextjs: {
      appDirectory: false,
    },
  },
  beforeAll: initializeStorybookI18n,
  decorators: [
    (Story) => {
      if (typeof document !== "undefined") {
        document.documentElement.classList.add("dark");
      }
      return createElement(
        I18nextProvider,
        { i18n },
        createElement(
          ToastProvider,
          null,
          createElement(WalletProvider, null, createElement(Story))
        )
      );
    },
  ],
};

export default preview;
