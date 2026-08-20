/**
 * lib/wallets/lobstr.ts
 * Lobstr wallet adapter implementing StellarWallet interface (#70).
 * Supports Lobstr browser extension and signer.
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

interface LobstrSigner {
  isConnected?: () => Promise<boolean>;
  getPublicKey: () => Promise<string>;
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>;
}

export class LobstrWalletAdapter implements StellarWallet {
  readonly id: WalletId = "lobstr";
  readonly name = "Lobstr";
  readonly metadata: WalletMetadata = {
    id: "lobstr",
    name: "Lobstr",
    description: "Leading mobile & web wallet for Stellar with browser extension signer.",
    icon: "lobstr",
    downloadUrl: "https://lobstr.co",
    extensionSupported: true,
    mobileSupported: true,
  };

  private cachedPublicKey: string | null = null;

  /** Lazy-load @lobstr/signer-extension-api or retrieve window.lobstr */
  private async getSdk(): Promise<LobstrSigner> {
    if (typeof window !== "undefined" && (window as unknown as { lobstr?: LobstrSigner }).lobstr) {
      return (window as unknown as { lobstr: LobstrSigner }).lobstr;
    }
    try {
      // Dynamic import of @lobstr/signer-extension-api
      const sdkModule = await import("@lobstr/signer-extension-api" as string);
      return (sdkModule.default || sdkModule) as LobstrSigner;
    } catch {
      if (
        typeof window !== "undefined" &&
        (window as unknown as { lobstr?: LobstrSigner }).lobstr
      ) {
        return (window as unknown as { lobstr: LobstrSigner }).lobstr;
      }
      throw new Error("Lobstr extension is not installed. Visit https://lobstr.co to install it.");
    }
  }

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    return Boolean((window as unknown as { lobstr?: unknown }).lobstr);
  }

  async isConnected(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const sdk = await this.getSdk();
      if (typeof sdk.isConnected === "function") {
        return await sdk.isConnected();
      }
      return Boolean(this.cachedPublicKey);
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      return { publicKey: null, error: "Lobstr is not available in non-browser environments." };
    }

    try {
      const available = await this.isAvailable();
      if (!available) {
        return {
          publicKey: null,
          error:
            "Lobstr extension is not detected. Please install the Lobstr extension or connect via WalletConnect.",
        };
      }

      const sdk = await this.getSdk();
      const pubkey = await sdk.getPublicKey();
      if (!pubkey) {
        return { publicKey: null, error: "No public key returned from Lobstr." };
      }
      this.cachedPublicKey = pubkey;
      return { publicKey: pubkey, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("rejected") ||
        message.includes("closed") ||
        message.includes("User declined")
      ) {
        return {
          publicKey: null,
          error: "Connection rejected. Please approve the connection in Lobstr.",
        };
      }
      return { publicKey: null, error: `Lobstr connection failed: ${message}` };
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

    try {
      const sdk = await this.getSdk();
      const networkPassphrase = opts?.networkPassphrase || getNetworkPassphrase();
      const signedXdr = await sdk.signTransaction(transactionXDR, { networkPassphrase });

      if (!signedXdr) {
        return { signedXDR: null, error: "No signed transaction returned from Lobstr." };
      }

      return { signedXDR: signedXdr, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("rejected") ||
        message.includes("closed") ||
        message.includes("User declined")
      ) {
        return {
          signedXDR: null,
          error: "Transaction signing was rejected by the user in Lobstr.",
        };
      }
      return { signedXDR: null, error: `Lobstr signing failed: ${message}` };
    }
  }

  async disconnect(): Promise<void> {
    this.cachedPublicKey = null;
  }
}
