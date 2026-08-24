/**
 * @file lib/stellarConfig.ts
 * @description Centralized configuration and Horizon server instantiation for Finchippay Solution.
 *
 * This module delegates to NetworkContext for runtime network switching.
 * Module-scope exports (NETWORK, HORIZON_URL, NETWORK_PASSPHRASE) are read once
 * at import time from the stored/fallback network. React components should use
 * the useNetwork() hook from NetworkContext.tsx for reactive updates.
 */

import { Horizon, Networks } from "@stellar/stellar-sdk";
import { getStoredConfig } from "./NetworkContext";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NetworkConfig {
  network: "testnet" | "mainnet";
  horizonUrl: string;
}

// ─── Default configurations ─────────────────────────────────────────────────

export const DEFAULT_CONFIGS: Record<"testnet" | "mainnet", NetworkConfig> = {
  testnet: {
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  },
  mainnet: {
    network: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
  },
};

// ─── Runtime config resolution ──────────────────────────────────────────────

/**
 * Get the current network configuration from localStorage or env var fallback.
 * This is safe to call from both React components and module-scope code.
 */
export function getNetworkConfig(): NetworkConfig {
  const stored = getStoredConfig();
  return {
    network: stored.network,
    horizonUrl: stored.horizonUrl,
  };
}

/**
 * Persist a network configuration to localStorage.
 * Note: React components should prefer useNetwork().setNetwork() for reactive updates.
 */
export function setNetworkConfig(config: NetworkConfig): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("finchippay:network", config.network);
  }
}

// ─── Module-scope convenience values (read once at import time) ──────────────

// These are populated from stored/fallback config at module evaluation time.
// Components that need reactive updates should use the useNetwork() hook instead.
const config = getNetworkConfig();

// For backwards compatibility, keep these as computed values
export const NETWORK = config.network;
export const HORIZON_URL = config.horizonUrl;

/** The network passphrase is used to sign and verify transactions. */
export function getNetworkPassphrase(): string {
  const config = getNetworkConfig();
  return config.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

// For backwards compatibility (module-scope, non-reactive)
export const NETWORK_PASSPHRASE = getNetworkPassphrase();

/** Pre-configured Horizon server instance for the active network. */
let _server: Horizon.Server | null = null;
export function getServer(): Horizon.Server {
  const currentConfig = getNetworkConfig();
  if (!_server || _server.serverURL.toString() !== currentConfig.horizonUrl) {
    _server = new Horizon.Server(currentConfig.horizonUrl);
  }
  return _server;
}

// For backwards compatibility, export server as getter proxy
export const server = new Proxy({} as Horizon.Server, {
  get(target, prop) {
    return getServer()[prop as keyof Horizon.Server];
  },
});