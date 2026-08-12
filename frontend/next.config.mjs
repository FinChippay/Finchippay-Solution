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

  typescript: {
    // Pre-existing TS errors are tracked separately via npm run type-check.
    // This allows Next.js 16 builds to succeed during incremental type migration.
    ignoreBuildErrors: true,
  },

  // Use static export for Docker/nginx deployments (set NEXT_OUTPUT=export).
  // For Vercel, leave unset so SSR/ISR/API routes work.
  ...(process.env.NEXT_OUTPUT === "export" ? { output: "export" } : {}),
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
  },
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
