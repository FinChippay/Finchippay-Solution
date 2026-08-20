/**
 * lib/wallets/types.ts
 * Core types and unified StellarWallet interface for multi-wallet support (#70).
 */

export type WalletId = "freighter" | "albedo" | "xbull" | "lobstr" | "walletconnect";

export interface WalletMetadata {
  id: WalletId;
  name: string;
  description: string;
  icon: string;
  downloadUrl?: string;
  webSupported?: boolean;
  extensionSupported?: boolean;
  mobileSupported?: boolean;
}

export interface ConnectResult {
  publicKey: string | null;
  error: string | null;
}

export interface SignResult {
  signedXDR: string | null;
  error: string | null;
}

export interface SignOptions {
  networkPassphrase?: string;
  accountToSign?: string;
}

export interface StellarWallet {
  readonly id: WalletId;
  readonly name: string;
  readonly metadata: WalletMetadata;

  /** Check if the wallet provider is available in the current browser environment. */
  isAvailable(): Promise<boolean>;

  /** Initiate connection to the wallet and request account access. */
  connect(): Promise<ConnectResult>;

  /** Retrieve the currently connected account's public key without re-prompting if authorized. */
  getPublicKey(): Promise<string | null>;

  /** Request the wallet to sign a transaction XDR. */
  signTransaction(transactionXDR: string, opts?: SignOptions): Promise<SignResult>;

  /** Disconnect the active wallet session. */
  disconnect(): Promise<void>;

  /** Check if the wallet currently has an active connection with site permissions. */
  isConnected(): Promise<boolean>;
}
