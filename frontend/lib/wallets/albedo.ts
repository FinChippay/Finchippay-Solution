/**
 * lib/wallets/albedo.ts
 * Albedo wallet adapter implementing StellarWallet interface (#70).
 * Albedo provides frictionless web & extension signing for Stellar.
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

interface AlbedoIntent {
  publicKey(
    params?: Record<string, unknown>,
  ): Promise<{ pubkey: string; signed_message?: string; signature?: string }>;
  tx(params: {
    xdr: string;
    network?: string;
    submit?: boolean;
  }): Promise<{ signed_envelope_xdr: string; tx_hash?: string }>;
  isImplicitSessionAllowed?: (sessionToken: string) => boolean;
}

export class AlbedoWalletAdapter implements StellarWallet {
  readonly id: WalletId = "albedo";
  readonly name = "Albedo";
  readonly metadata: WalletMetadata = {
    id: "albedo",
    name: "Albedo",
    description: "Web & extension signer for Stellar. Works without installing extensions.",
    icon: "albedo",
    downloadUrl: "https://albedo.link",
    webSupported: true,
    extensionSupported: true,
    mobileSupported: true,
  };

  private cachedPublicKey: string | null = null;

  /** Lazy-load @albedo-link/intent or retrieve window.albedo */
  private async getSdk(): Promise<AlbedoIntent> {
    if (typeof window !== "undefined" && (window as unknown as { albedo?: AlbedoIntent }).albedo) {
      return (window as unknown as { albedo: AlbedoIntent }).albedo;
    }
    try {
      // Dynamic import of @albedo-link/intent if available in runtime
      const sdkModule = await import("@albedo-link/intent" as string);
      return (sdkModule.default || sdkModule) as AlbedoIntent;
    } catch {
      // Fallback: If npm package is not installed, use window.albedo
      if (
        typeof window !== "undefined" &&
        (window as unknown as { albedo?: AlbedoIntent }).albedo
      ) {
        return (window as unknown as { albedo: AlbedoIntent }).albedo;
      }
      throw new Error("Albedo SDK is not available. Please visit https://albedo.link");
    }
  }

  async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined";
  }

  async isConnected(): Promise<boolean> {
    return Boolean(this.cachedPublicKey);
  }

  async connect(): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      return { publicKey: null, error: "Albedo is not available in non-browser environments." };
    }

    try {
      const sdk = await this.getSdk();
      const res = await sdk.publicKey();
      if (!res || !res.pubkey) {
        return { publicKey: null, error: "No public key returned from Albedo." };
      }
      this.cachedPublicKey = res.pubkey;
      return { publicKey: res.pubkey, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("canceled") ||
        message.includes("rejected") ||
        message.includes("User declined")
      ) {
        return {
          publicKey: null,
          error: "Connection rejected. Please approve the connection in Albedo.",
        };
      }
      return { publicKey: null, error: `Albedo connection failed: ${message}` };
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
      const network = opts?.networkPassphrase || getNetworkPassphrase();
      const res = await sdk.tx({
        xdr: transactionXDR,
        network,
      });

      if (!res || !res.signed_envelope_xdr) {
        return { signedXDR: null, error: "No signed transaction returned from Albedo." };
      }

      return { signedXDR: res.signed_envelope_xdr, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("canceled") ||
        message.includes("rejected") ||
        message.includes("User declined")
      ) {
        return {
          signedXDR: null,
          error: "Transaction signing was rejected by the user in Albedo.",
        };
      }
      return { signedXDR: null, error: `Albedo signing failed: ${message}` };
    }
  }

  async disconnect(): Promise<void> {
    this.cachedPublicKey = null;
  }
}
