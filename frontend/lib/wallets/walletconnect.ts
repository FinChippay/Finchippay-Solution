/**
 * lib/wallets/walletconnect.ts
 * WalletConnect adapter implementing StellarWallet interface (#70).
 * Supports connecting mobile Stellar wallets (e.g. LOBSTR mobile, Solar) via WalletConnect.
 */

import {
  StellarWallet,
  WalletId,
  WalletMetadata,
  ConnectResult,
  SignResult,
  SignOptions,
} from "./types";
import { getNetworkPassphrase } from "@/lib/stellar";

export interface WalletConnectSession {
  topic: string;
  namespaces: {
    stellar?: {
      accounts: string[];
      methods: string[];
      events: string[];
    };
  };
}

export interface WalletConnectClient {
  connect: (params: { requiredNamespaces: Record<string, unknown> }) => Promise<{
    uri?: string;
    approval: () => Promise<WalletConnectSession>;
  }>;
  request: <T = unknown>(params: {
    topic: string;
    chainId: string;
    request: { method: string; params: unknown };
  }) => Promise<T>;
  disconnect: (params: {
    topic: string;
    reason: { code: number; message: string };
  }) => Promise<void>;
  session?: {
    getAll: () => WalletConnectSession[];
  };
}

export class WalletConnectAdapter implements StellarWallet {
  readonly id: WalletId = "walletconnect";
  readonly name = "WalletConnect";
  readonly metadata: WalletMetadata = {
    id: "walletconnect",
    name: "WalletConnect",
    description: "Scan QR code with mobile wallets like LOBSTR or Solar.",
    icon: "walletconnect",
    webSupported: true,
    mobileSupported: true,
  };

  private client: WalletConnectClient | null = null;
  private currentSession: WalletConnectSession | null = null;
  private cachedPublicKey: string | null = null;

  /** Lazy-load @walletconnect/sign-client or retrieve window.walletConnect */
  private async getClient(): Promise<WalletConnectClient> {
    if (
      typeof window !== "undefined" &&
      (window as unknown as { walletConnect?: WalletConnectClient }).walletConnect
    ) {
      return (window as unknown as { walletConnect: WalletConnectClient }).walletConnect;
    }

    if (this.client) return this.client;

    try {
      // Dynamic import for WalletConnect client
      const SignClient =
        (await import("@walletconnect/sign-client" as string)).default ||
        (await import("@walletconnect/sign-client" as string));
      const projectId =
        process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "finchippay-walletconnect";

      const client = await SignClient.init({
        projectId,
        metadata: {
          name: "Finchippay Solution",
          description: "Stellar Payment & Escrow Platform",
          url: typeof window !== "undefined" ? window.location.origin : "https://finchippay.com",
          icons: ["https://finchippay.com/favicon.ico"],
        },
      });
      this.client = client as WalletConnectClient;
      return this.client;
    } catch {
      throw new Error("WalletConnect client is not initialized or unavailable.");
    }
  }

  async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined";
  }

  async isConnected(): Promise<boolean> {
    return Boolean(this.cachedPublicKey && this.currentSession);
  }

  async connect(): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      return {
        publicKey: null,
        error: "WalletConnect is not available in non-browser environments.",
      };
    }

    try {
      const client = await this.getClient();
      const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
      const chainId = `stellar:${network === "mainnet" || network === "pubnet" ? "pubnet" : "testnet"}`;

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          stellar: {
            methods: ["stellar_signTransaction", "stellar_signXDR"],
            chains: [chainId],
            events: [],
          },
        },
      });

      if (uri && typeof window !== "undefined") {
        // Emit custom event for UI / QR display modal if registered
        window.dispatchEvent(new CustomEvent("walletconnect:uri", { detail: { uri } }));
      }

      const session = await approval();
      this.currentSession = session;

      // Extract account from session namespaces (format: "stellar:pubnet:G...")
      const accounts = session.namespaces?.stellar?.accounts || [];
      if (accounts.length === 0) {
        return { publicKey: null, error: "No Stellar account provided by WalletConnect session." };
      }

      const rawAccount = accounts[0];
      const parts = rawAccount.split(":");
      const pubkey = parts[parts.length - 1];

      if (!pubkey || !/^G[A-Z2-7]{55}$/.test(pubkey)) {
        return { publicKey: null, error: "Invalid public key received from WalletConnect." };
      }

      this.cachedPublicKey = pubkey;
      return { publicKey: pubkey, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("rejected") ||
        message.includes("User rejected") ||
        message.includes("User disapproved")
      ) {
        return {
          publicKey: null,
          error: "Connection rejected. Please approve the connection in your mobile wallet.",
        };
      }
      return { publicKey: null, error: `WalletConnect connection failed: ${message}` };
    }
  }

  async getPublicKey(): Promise<string | null> {
    return this.cachedPublicKey;
  }

  async signTransaction(transactionXDR: string, opts?: SignOptions): Promise<SignResult> {
    if (typeof window === "undefined") {
      return {
        signedXDR: null,
        error: "Wallet signing is not available during server-side rendering.",
      };
    }

    if (!this.currentSession || !this.cachedPublicKey) {
      return { signedXDR: null, error: "WalletConnect session is not active. Please reconnect." };
    }

    try {
      const client = await this.getClient();
      const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
      const chainId = `stellar:${network === "mainnet" || network === "pubnet" ? "pubnet" : "testnet"}`;
      const networkPassphrase = opts?.networkPassphrase || getNetworkPassphrase();

      const response = await client.request<{ signedXDR?: string; xdr?: string }>({
        topic: this.currentSession.topic,
        chainId,
        request: {
          method: "stellar_signTransaction",
          params: {
            xdr: transactionXDR,
            networkPassphrase,
            accountToSign: opts?.accountToSign || this.cachedPublicKey,
          },
        },
      });

      const signedXDR =
        response?.signedXDR || response?.xdr || (typeof response === "string" ? response : null);
      if (!signedXDR) {
        return { signedXDR: null, error: "No signed transaction returned from WalletConnect." };
      }

      return { signedXDR, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("rejected") || message.includes("User rejected")) {
        return {
          signedXDR: null,
          error: "Transaction signing was rejected by the user in WalletConnect.",
        };
      }
      return { signedXDR: null, error: `WalletConnect signing failed: ${message}` };
    }
  }

  async disconnect(): Promise<void> {
    try {
      const client = await this.getClient();
      if (client && this.currentSession) {
        await client.disconnect({
          topic: this.currentSession.topic,
          reason: { code: 6000, message: "User disconnected session" },
        });
      }
    } catch {
      // Ignore disconnect errors
    } finally {
      this.currentSession = null;
      this.cachedPublicKey = null;
    }
  }
}
