/**
 * lib/wallet.ts
 * Unified Stellar multi-wallet integration for Finchippay Solution (#70).
 *
 * Abstracted wallet connection backing Freighter, Albedo, xBull, Lobstr,
 * and WalletConnect through the unified StellarWallet interface.
 */

import { setJwtToken as persistAuthToken, clearJwtToken as clearAuthToken } from "./auth";
import {
  setSessionKey,
  getSessionKey,
  getSessionOwner,
  unlockAddressBook,
  unlockPaymentTemplates,
  unlockFederationCache,
  reEncryptAddressBook,
  reEncryptPaymentTemplates,
  reEncryptFederationCache,
} from "./encryptedStorage";
import { deriveKey, getOrCreateSalt } from "./encryption";
import { sdk } from "./sdk-instance";
import {
  WalletId,
  ConnectResult,
  SignResult,
  SignOptions,
  getWallet,
  getActiveWallet,
  setActiveWallet,
  getActiveWalletId,
} from "./wallets";
import { logger } from "@/lib/logger";

// ─── SEP-0010 helpers ────────────────────────────────────────────────────────

let jwtToken: string | null = null;
export function setJwtToken(token: string | null) {
  jwtToken = token;
}
export function getJwtToken() {
  return jwtToken;
}

async function fetchAuthChallenge(publicKey: string): Promise<string> {
  const { transaction } = await sdk.getChallenge(publicKey);
  return transaction;
}

async function verifyAuthChallenge(
  signedXDR: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await sdk.verifyChallenge(signedXDR);
  const data = res as Record<string, string | undefined>;
  const accessToken = data.accessToken || data.token;
  const refreshToken = data.refreshToken;
  if (accessToken) {
    sdk.setToken(accessToken);
  }
  return { accessToken: accessToken || "", refreshToken: refreshToken || "" };
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
  return await getWallet("freighter").isAvailable();
}

export async function hasSiteAccess(): Promise<boolean> {
  return await getWallet("freighter").isConnected();
}

export async function isWalletInstalled(walletId: WalletId): Promise<boolean> {
  return await getWallet(walletId).isAvailable();
}

// ─── Connect / Disconnect ────────────────────────────────────────────────────

/**
 * Connect to a Stellar wallet. If walletId is not provided, uses the active
 * wallet (defaults to Freighter).
 */
export async function connectWallet(walletId?: WalletId): Promise<ConnectResult> {
  const targetId = walletId || getActiveWalletId();
  const adapter = getWallet(targetId);
  setActiveWallet(targetId);

  return await adapter.connect();
}

export async function getConnectedPublicKey(walletId?: WalletId): Promise<string | null> {
  const targetId = walletId || getActiveWalletId();
  const adapter = getWallet(targetId);
  return await adapter.getPublicKey();
}

// ─── SEP-0010 auth flow ──────────────────────────────────────────────────────

export async function performSEP0010Auth(
  publicKey: string,
  walletId?: WalletId,
): Promise<{ token: string | null; error: string | null }> {
  try {
    const challengeXDR = await fetchAuthChallenge(publicKey);
    const { signedXDR, error: signError } = await signTransactionWithWallet(
      challengeXDR,
      {
        accountToSign: publicKey,
      },
      walletId,
    );

    if (signError || !signedXDR) {
      return { token: null, error: signError || "Failed to sign challenge transaction" };
    }
    const { accessToken, refreshToken } = await verifyAuthChallenge(signedXDR);
    setJwtToken(accessToken);
    persistAuthToken(accessToken);
    if (typeof window !== "undefined" && refreshToken) {
      localStorage.setItem("finchippay_refresh_token", refreshToken);
    }
    return { token: accessToken, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { token: null, error: `Authentication failed: ${msg}` };
  }
}

// ─── Signing ─────────────────────────────────────────────────────────────────

export async function signTransactionWithWallet(
  transactionXDR: string,
  opts?: SignOptions,
  walletId?: WalletId,
): Promise<SignResult> {
  const targetId = walletId || getActiveWalletId();
  const adapter = getWallet(targetId);
  return await adapter.signTransaction(transactionXDR, opts);
}

// ─── Encrypted local-data session ────────────────────────────────────────────

export async function initEncryptionSession(publicKey: string): Promise<void> {
  if (typeof window === "undefined" || !publicKey) return;
  try {
    if (typeof getOrCreateSalt !== "function" || typeof deriveKey !== "function") return;
    const salt = getOrCreateSalt();
    const key = await deriveKey(publicKey, salt);
    if (typeof setSessionKey === "function") {
      setSessionKey(key, publicKey);
    }
    await Promise.all([
      typeof unlockAddressBook === "function"
        ? unlockAddressBook(key, publicKey)
        : Promise.resolve(),
      typeof unlockPaymentTemplates === "function"
        ? unlockPaymentTemplates(key, publicKey)
        : Promise.resolve(),
      typeof unlockFederationCache === "function"
        ? unlockFederationCache(key, publicKey)
        : Promise.resolve(),
    ]);
  } catch (err) {
    logger.error(
      "Failed to initialise encryption session",
      {},
      err instanceof Error ? err : undefined,
    );
  }
}

export async function reEncryptLocalData(): Promise<void> {
  if (typeof getSessionKey !== "function" || typeof getSessionOwner !== "function") return;
  const key = getSessionKey();
  const owner = getSessionOwner();
  if (!key || !owner) return;
  await Promise.all([
    typeof reEncryptAddressBook === "function"
      ? reEncryptAddressBook(key, owner)
      : Promise.resolve(),
    typeof reEncryptPaymentTemplates === "function"
      ? reEncryptPaymentTemplates(key, owner)
      : Promise.resolve(),
    typeof reEncryptFederationCache === "function"
      ? reEncryptFederationCache(key, owner)
      : Promise.resolve(),
  ]);
}

export function disconnectWallet(): void {
  const rToken =
    typeof window !== "undefined" ? localStorage.getItem("finchippay_refresh_token") : null;
  const aToken = getJwtToken();

  if (rToken || aToken) {
    const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(
      /\/+$/,
      "",
    );
    try {
      const res = fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(aToken ? { Authorization: `Bearer ${aToken}` } : {}),
        },
        body: JSON.stringify({ refreshToken: rToken }),
      });
      if (res && typeof (res as Promise<unknown>).catch === "function") {
        (res as Promise<unknown>).catch((err) => {
          logger.error(
            "Failed to revoke token family on logout",
            {},
            err instanceof Error ? err : undefined,
          );
        });
      }
    } catch (err) {
      logger.error(
        "Failed to revoke token family on logout",
        {},
        err instanceof Error ? err : undefined,
      );
    }
  }

  try {
    getActiveWallet()
      .disconnect()
      .catch(() => {});
  } catch {
    // Ignore wallet disconnect errors
  }

  setJwtToken(null);
  clearAuthToken();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export * from "./wallets";
export {
  isLedgerSupported,
  signTransactionWithLedger,
  getLedgerPublicKey,
  connectLedger,
  disconnectLedger,
} from "./ledger";
