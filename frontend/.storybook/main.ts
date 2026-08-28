import type { StorybookConfig } from "@storybook/experimental-nextjs-vite";
import path from "node:path";

process.env.NEXT_PUBLIC_STELLAR_NETWORK ??= "testnet";
process.env.NEXT_PUBLIC_HORIZON_URL ??= "https://horizon-testnet.stellar.org";
process.env.NEXT_PUBLIC_API_URL ??= "http://localhost:4000";

const config: StorybookConfig = {
  stories: [
    "../stories/**/*.stories.@(js|jsx|ts|tsx|mdx)",
    "../stories/**/*.mdx",
  ],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
  ],
  framework: {
    name: "@storybook/experimental-nextjs-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  staticDirs: ["../public"],
  viteFinal: async (viteConfig) => {
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...(viteConfig.resolve?.alias as Record<string, string>),
        "@": path.resolve(__dirname, ".."),
      },
    };
    return viteConfig;
  },
};

export default config;
