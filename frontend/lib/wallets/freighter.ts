/**
 * lib/wallets/freighter.ts
 * Freighter wallet adapter implementing StellarWallet interface (#70).
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

export class FreighterWalletAdapter implements StellarWallet {
  readonly id: WalletId = "freighter";
  readonly name = "Freighter";
  readonly metadata: WalletMetadata = {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension wallet for Stellar developed by the SDF.",
    icon: "freighter",
    downloadUrl: "https://freighter.app",
    extensionSupported: true,
  };

  /** Lazy-load @stellar/freighter-api on demand */
  private async getSdk() {
    return await import("@stellar/freighter-api");
  }

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const sdk = await this.getSdk();
      const result = await sdk.isConnected();
      return Boolean(result && result.isConnected);
    } catch {
      return false;
    }
  }

  async isConnected(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const sdk = await this.getSdk();
      const allowed = await sdk.isAllowed();
      return Boolean(allowed && allowed.isAllowed);
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      return {
        publicKey: null,
        error: "Freighter wallet is not available in non-browser environments.",
      };
    }

    try {
      const sdk = await this.getSdk();
      const available = await this.isAvailable();
      if (!available) {
        return {
          publicKey: null,
          error: "Freighter wallet is not installed. Visit https://freighter.app to install it.",
        };
      }

      const access = await sdk.requestAccess();
      if (access.error) {
        return {
          publicKey: null,
          error:
            access.error.message ||
            "Connection rejected. Please approve the connection in Freighter.",
        };
      }

      const address = access.address || (await sdk.getAddress()).address;
      if (!address) {
        return { publicKey: null, error: "No public key returned from Freighter." };
      }

      return { publicKey: address, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("User declined") || message.includes("rejected")) {
        return {
          publicKey: null,
          error: "Connection rejected. Please approve the connection in Freighter.",
        };
      }
      return { publicKey: null, error: `Wallet connection failed: ${message}` };
    }
  }

  async getPublicKey(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    try {
      const connected = await this.isConnected();
      if (!connected) return null;
      const sdk = await this.getSdk();
      const { address } = await sdk.getAddress();
      return address || null;
    } catch {
      return null;
    }
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
      const signed = await sdk.signTransaction(transactionXDR, {
        networkPassphrase,
        accountToSign: opts?.accountToSign,
      });

      if (signed.error) {
        throw new Error(signed.error.message || "Freighter signing failed");
      }

      return { signedXDR: signed.signedTxXdr, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("User declined") || message.includes("rejected")) {
        return {
          signedXDR: null,
          error: "Transaction signing was rejected by the user.",
        };
      }
      return { signedXDR: null, error: `Signing failed: ${message}` };
    }
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't have an explicit programmatic session revoke API,
    // so disconnecting clears local cache and auth token.
  }
}
