/**
 * lib/wallets/xbull.ts
 * xBull wallet adapter implementing StellarWallet interface (#70).
 * Supports xBull browser extension and web bridge.
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

interface XBullSDK {
  getPublicKey(): Promise<string>;
  sign(params: { xdr: string; network?: string; publicKey?: string }): Promise<string>;
  signTransaction?: (xdr: string, opts?: { network?: string }) => Promise<string>;
  close?: () => void;
}

export class XBullWalletAdapter implements StellarWallet {
  readonly id: WalletId = "xbull";
  readonly name = "xBull";
  readonly metadata: WalletMetadata = {
    id: "xbull",
    name: "xBull",
    description: "Multi-platform Stellar wallet extension and web app.",
    icon: "xbull",
    downloadUrl: "https://xbull.app",
    extensionSupported: true,
    webSupported: true,
    mobileSupported: true,
  };

  private cachedPublicKey: string | null = null;

  /** Lazy-load @creit.tech/xbull-wallet-connect or retrieve window.xBullSDK */
  private async getSdk(): Promise<XBullSDK> {
    if (typeof window !== "undefined" && (window as unknown as { xBullSDK?: XBullSDK }).xBullSDK) {
      return (window as unknown as { xBullSDK: XBullSDK }).xBullSDK;
    }
    if (typeof window !== "undefined" && (window as unknown as { xBull?: XBullSDK }).xBull) {
      return (window as unknown as { xBull: XBullSDK }).xBull;
    }
    try {
      // Dynamic import of @creit.tech/xbull-wallet-connect
      const sdkModule = await import("@creit.tech/xbull-wallet-connect" as string);
      const XBullConnect = sdkModule.xBullWalletConnect || sdkModule.default || sdkModule;
      return new XBullConnect() as XBullSDK;
    } catch {
      if (
        typeof window !== "undefined" &&
        (window as unknown as { xBullSDK?: XBullSDK }).xBullSDK
      ) {
        return (window as unknown as { xBullSDK: XBullSDK }).xBullSDK;
      }
      throw new Error(
        "xBull SDK is not available. Please install the xBull extension at https://xbull.app",
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    return Boolean(
      (window as unknown as { xBullSDK?: unknown }).xBullSDK ||
      (window as unknown as { xBull?: unknown }).xBull,
    );
  }

  async isConnected(): Promise<boolean> {
    return Boolean(this.cachedPublicKey);
  }

  async connect(): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      return { publicKey: null, error: "xBull is not available in non-browser environments." };
    }

    try {
      const sdk = await this.getSdk();
      const pubkey = await sdk.getPublicKey();
      if (!pubkey) {
        return { publicKey: null, error: "No public key returned from xBull." };
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
          error: "Connection rejected. Please approve the connection in xBull.",
        };
      }
      return { publicKey: null, error: `xBull connection failed: ${message}` };
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

      let signedXdr: string;
      if (typeof sdk.sign === "function") {
        signedXdr = await sdk.sign({
          xdr: transactionXDR,
          network,
          publicKey: opts?.accountToSign || this.cachedPublicKey || undefined,
        });
      } else if (typeof sdk.signTransaction === "function") {
        signedXdr = await sdk.signTransaction(transactionXDR, { network });
      } else {
        throw new Error("xBull signing method not supported");
      }

      if (!signedXdr) {
        return { signedXDR: null, error: "No signed transaction returned from xBull." };
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
          error: "Transaction signing was rejected by the user in xBull.",
        };
      }
      return { signedXDR: null, error: `xBull signing failed: ${message}` };
    }
  }

  async disconnect(): Promise<void> {
    this.cachedPublicKey = null;
    try {
      const sdk = await this.getSdk();
      sdk.close?.();
    } catch {
      // Ignore cleanup error
    }
  }
}
