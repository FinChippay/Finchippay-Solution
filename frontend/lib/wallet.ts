/**
 * lib/wallet.ts
 * Freighter wallet integration for Finchippay Solution.
 *
 * Freighter is a browser extension wallet for Stellar.
 * Install it at: https://freighter.app
 *
 * This module wraps the @stellar/freighter-api package with
 * friendly error messages and typed return values.
 */

import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
  isAllowed,
  signMessage,
} from "@stellar/freighter-api";
import { logger } from "@/lib/logger";

import {
  setJwtToken as persistAuthToken,
  clearJwtToken as clearAuthToken,
} from "./auth";
import { sdk } from "./sdk-instance";
import { getNetworkPassphrase } from "./stellar";
import {
  getOrCreateSalt,
  deriveKey,
  setSessionKey,
  getSessionKey,
  getSessionOwner,
} from "@/lib/encryption";
import {
  unlockAddressBook,
  reEncryptAddressBook,
  unlockFederationCache,
  reEncryptFederationCache,
} from "./addressBook";
import {
  unlockPaymentTemplates,
  reEncryptPaymentTemplates,
} from "./paymentTemplates";

// ─── SEP-0010 helpers ────────────────────────────────────────────────────────

let jwtToken: string | null = null;
export function setJwtToken(token: string | null) { jwtToken = token; }
export function getJwtToken() { return jwtToken; }

async function fetchAuthChallenge(publicKey: string): Promise<string> {
  const { transaction } = await sdk.getChallenge(publicKey);
  return transaction;
}

async function verifyAuthChallenge(signedXDR: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await sdk.verifyChallenge(signedXDR);
  const data = res as Record<string, string | undefined>;
  const accessToken = data.accessToken || data.token || null;
  const refreshToken = data.refreshToken ?? null;
  sdk.setToken(accessToken);
  return { accessToken: accessToken || '', refreshToken: refreshToken || '' };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  error: string | null;
}

// ─── Browser detection ───────────────────────────────────────────────────────

export type SupportedBrowser = "chrome" | "firefox" | "other";

export function detectBrowser(): SupportedBrowser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "firefox";
  if (ua.includes("Chrome")) return "chrome";
  return "other";
}

export const EXTENSION_URLS: Record<SupportedBrowser, string> = {
  chrome: "https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk",
  firefox: "https://addons.mozilla.org/en-US/firefox/addon/freighter/",
  other: "https://freighter.app",
};

// ─── Wallet detection ─────────────────────────────────────────────────────────

export async function isFreighterInstalled(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const result = await isConnected();
    return Boolean(result.isConnected);
  } catch {
    return false;
  }
}

export async function hasSiteAccess(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const result = await isAllowed();
    return Boolean(result.isAllowed);
  } catch {
    return false;
  }
}

// ─── Connect / Disconnect ────────────────────────────────────────────────────

export async function connectWallet(): Promise<{
  publicKey: string | null;
  error: string | null;
}> {
  const installed = await isFreighterInstalled();
  if (!installed) {
    return {
      publicKey: null,
      error: "Freighter wallet is not installed. Visit https://freighter.app to install it.",
    };
  }

  try {
    const access = await requestAccess();
    if (access.error) {
      return {
        publicKey: null,
        error: access.error.message || "Connection rejected. Please approve the connection in Freighter.",
      };
    }

    const publicKey = access.address || (await getAddress()).address;
    if (!publicKey) {
      return { publicKey: null, error: "No public key returned from Freighter." };
    }

    return { publicKey, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("User declined")) {
      return {
        publicKey: null,
        error: "Connection rejected. Please approve the connection in Freighter.",
      };
    }
    return { publicKey: null, error: `Wallet connection failed: ${message}` };
  }
}

export async function getConnectedPublicKey(): Promise<string | null> {
  try {
    const allowed = await hasSiteAccess();
    if (!allowed) return null;
    const { address } = await getAddress();
    return address || null;
  } catch {
    return null;
  }
}

// ─── SEP-0010 auth flow ──────────────────────────────────────────────────────

export async function performSEP0010Auth(
  publicKey: string
): Promise<{ token: string | null; error: string | null }> {
  try {
    const challengeXDR = await fetchAuthChallenge(publicKey);
    const { signedXDR, error: signError } = await signTransactionWithWallet(challengeXDR, publicKey);
    if (signError || !signedXDR) {
      return { token: null, error: signError || "Failed to sign challenge transaction" };
    }
    const { accessToken } = await verifyAuthChallenge(signedXDR);
    setJwtToken(accessToken);
    persistAuthToken(accessToken);
    return { token: accessToken, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { token: null, error: `Authentication failed: ${msg}` };
  }
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Active hardware-wallet type used to route signing. Defaults to "freighter"
 * and is switched after a successful Ledger/Trezor connection.
 */
export type SigningWalletType = "freighter" | "ledger" | "trezor";

let activeWalletType: SigningWalletType = "freighter";

export function setActiveWalletType(type: SigningWalletType): void {
  activeWalletType = type;
}

export function getActiveWalletType(): SigningWalletType {
  return activeWalletType;
}

export async function signTransactionWithWallet(
  transactionXDR: string,
  publicKey?: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  if (typeof window === "undefined") {
    return { signedXDR: null, error: "Wallet signing is not available during server-side rendering." };
  }

  // Route signing through the active hardware-wallet type when one is set and
  // we have the signer's public key. Defaults to Freighter.
  const activeType = getActiveWalletType();
  if (activeType === "trezor" && publicKey) {
    return signTransactionWithTrezor(transactionXDR, publicKey);
  }
  if (activeType === "ledger" && publicKey) {
    return signTransactionWithLedger(transactionXDR, publicKey);
  }

  try {
    const signed = await signTransaction(transactionXDR, {
      networkPassphrase: getNetworkPassphrase(),
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

// ─── Encrypted local-data session ────────────────────────────────────────────

export async function initEncryptionSession(publicKey: string): Promise<void> {
  if (typeof window === "undefined" || !publicKey) return;
  try {
    const message = "Finchippay Encryption Key Derivation\n\nSign this message to unlock your encrypted local data.";
    const { signedMessage, error } = await signMessage(message, { address: publicKey });
    if (error || !signedMessage) {
      throw new Error(error?.message || "User declined message signature.");
    }

    const key = await deriveKey(signedMessage);
    setSessionKey(key, publicKey);
    await Promise.all([
      unlockAddressBook(key, publicKey),
      unlockPaymentTemplates(key, publicKey),
      unlockFederationCache(key, publicKey),
    ]);
  } catch (err) {
    logger.error("Failed to initialise encryption session", {}, err instanceof Error ? err : undefined);
  }
}

export async function reEncryptLocalData(): Promise<void> {
  const key = getSessionKey();
  const owner = getSessionOwner();
  if (!key || !owner) return;
  await Promise.all([
    reEncryptAddressBook(key, owner),
    reEncryptPaymentTemplates(key, owner),
    reEncryptFederationCache(key, owner),
  ]);
}

export function disconnectWallet(): void {
  const aToken = getJwtToken();

  const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
  fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(aToken ? { "Authorization": `Bearer ${aToken}` } : {})
    },
  }).catch((err) => {
    logger.error("Failed to revoke token family on logout", {}, err instanceof Error ? err : undefined);
  });

  setJwtToken(null);
  clearAuthToken();
}

export { isLedgerSupported, signTransactionWithLedger, getLedgerPublicKey, connectLedger, disconnectLedger } from "./ledger";
export {
  isTrezorSupported,
  signTransactionWithTrezor,
  getTrezorPublicKey,
  disconnectTrezor,
  mapTrezorError,
  normalizeSignature,
  attachSignature,
} from "./trezor";
