import { withSentryConfig } from "@sentry/nextjs";
import { validateEnv } from "./scripts/validateEnv.mjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

if (process.env.npm_lifecycle_event !== "lint") {
  validateEnv();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the production Docker image (copies only what's needed)
  output: "export",
  // Allow Stellar SDK in browser
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    // Suppress Sentry CLI output during builds
    silent: true,
    // Disable source map upload unless SENTRY_AUTH_TOKEN is set
    disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
    disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  })
);
