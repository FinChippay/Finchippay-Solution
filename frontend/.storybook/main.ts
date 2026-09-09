import { createRequire } from "node:module";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import path, { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

process.env.NEXT_PUBLIC_STELLAR_NETWORK ??= "testnet";
process.env.NEXT_PUBLIC_HORIZON_URL ??= "https://horizon-testnet.stellar.org";
process.env.NEXT_PUBLIC_API_URL ??= "http://localhost:4000";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(js|jsx|ts|tsx|mdx)", "../stories/**/*.mdx"],

  addons: [getAbsolutePath("@storybook/addon-a11y"), getAbsolutePath("@storybook/addon-docs")],

  framework: {
    name: getAbsolutePath("@storybook/nextjs-vite"),
    options: {},
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
    // lib/ledger.ts and lib/trezor.ts load their hardware-wallet SDKs via
    // optional dynamic imports that are not installed (see package.json).
    // Externalize them so Vite/Rollup leaves the import as a runtime
    // statement; the modules' try/catch guards handle their absence.
    viteConfig.build = {
      ...(viteConfig.build ?? {}),
      rollupOptions: {
        ...(viteConfig.build?.rollupOptions ?? {}),
        external: [
          ...(viteConfig.build?.rollupOptions?.external ?? []),
          "@ledgerhq/hw-transport-webusb",
          "@ledgerhq/hw-app-str",
          "@trezor/connect",
        ],
      },
    };
    return viteConfig;
  },
};

export default config;

function getAbsolutePath(value: string): any {
  return dirname(require.resolve(join(value, "package.json")));
}
