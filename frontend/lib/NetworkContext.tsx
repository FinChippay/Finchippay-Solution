/**
 * @file lib/NetworkContext.tsx
 * @description React context for switching Stellar network (testnet/mainnet) at runtime.
 *
 * Many components and modules currently read NEXT_PUBLIC_STELLAR_NETWORK directly
 * from process.env, which is baked in at build time. This context provides a
 * reactive way to switch networks without rebuilding.
 *
 * Usage:
 *   <NetworkProvider>
 *     <App />
 *   </NetworkProvider>
 *
 *   const { network, setNetwork, config, isMainnet } = useNetwork();
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { Horizon, Networks } from "@stellar/stellar-sdk";

// ─── Types ──────────────────────────────────────────────────────────────────

export type NetworkName = "testnet" | "mainnet";

export interface NetworkConfig {
  network: NetworkName;
  horizonUrl: string;
  /** Stellar network passphrase for signing transactions */
  networkPassphrase: string;
  /** Soroban RPC URL for the active network */
  sorobanRpcUrl: string;
  /** Human-readable label */
  label: string;
}

export interface NetworkContextValue {
  /** Current network name */
  network: NetworkName;
  /** Full network configuration */
  config: NetworkConfig;
  /** Whether the active network is mainnet */
  isMainnet: boolean;
  /** Switch to a different network */
  setNetwork: (network: NetworkName) => void;
  /** Toggle between testnet and mainnet */
  toggleNetwork: () => void;
  /** Pre-configured Horizon.Server for the active network */
  getServer: () => Horizon.Server;
}

// ─── Default configurations ──────────────────────────────────────────────────

const NETWORK_CONFIGS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    network: "testnet",
    horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
    label: "Testnet",
  },
  mainnet: {
    network: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: Networks.PUBLIC,
    sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_MAINNET_RPC_URL || "https://soroban.stellar.org",
    label: "Mainnet",
  },
};

// ─── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "finchippay:network";

// ─── Context ─────────────────────────────────────────────────────────────────

const NetworkContext = createContext<NetworkContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<NetworkName>(() => {
    // 1. Check localStorage for persisted preference
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "mainnet" || stored === "testnet") {
          return stored;
        }
      } catch {
        // localStorage unavailable (SSR / private browsing)
      }
    }
    // 2. Fall back to build-time env var
    const envNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    return envNetwork === "mainnet" || envNetwork === "testnet" ? envNetwork : "testnet";
  });

  // Persist to localStorage whenever the network changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, network);
    } catch {
      // Silently ignore if localStorage is unavailable
    }
  }, [network]);

  const config = useMemo(() => NETWORK_CONFIGS[network], [network]);
  const isMainnet = network === "mainnet";

  const setNetwork = useCallback((next: NetworkName) => {
    setNetworkState(next);
    // Dispatch a custom event so non-React modules (e.g. stellar.ts singleton)
    // can react to network changes.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("networkchange", { detail: { network: next } }));
    }
  }, []);

  const toggleNetwork = useCallback(() => {
    setNetwork(network === "testnet" ? "mainnet" : "testnet");
  }, [network, setNetwork]);

  const getServer = useCallback(() => {
    return new Horizon.Server(config.horizonUrl);
  }, [config.horizonUrl]);

  const value = useMemo<NetworkContextValue>(
    () => ({ network, config, isMainnet, setNetwork, toggleNetwork, getServer }),
    [network, config, isMainnet, setNetwork, toggleNetwork, getServer],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetwork must be used within a <NetworkProvider>");
  }
  return ctx;
}

// ─── Non-React helper (for modules that run at module scope) ─────────────────

/**
 * Read the current network name from localStorage at runtime.
 * Falls back to the build-time env var.
 * This is a synchronous helper for module-scope code that cannot use React hooks.
 */
export function getStoredNetwork(): NetworkName {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "mainnet" || stored === "testnet") return stored;
    } catch {
      // ignore
    }
  }
  const envNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  return envNetwork === "mainnet" || envNetwork === "testnet" ? envNetwork : "testnet";
}

/**
 * Get the full NetworkConfig for the currently stored network.
 * Safe to call at module scope for non-React code.
 */
export function getStoredConfig(): NetworkConfig {
  return NETWORK_CONFIGS[getStoredNetwork()];
}