/**
 * lib/encryption.ts
 * Client-side encryption primitives for Finchippay Solution.
 *
 * Sensitive local data (contacts, payment templates) is encrypted at rest in
 * localStorage using AES-GCM via the Web Crypto API. The encryption key is
 * derived from the connected Stellar public key plus a random salt (PBKDF2) and
 * is only held in memory while a wallet is connected.
 *
 * SECURITY NOTE
 * -------------
 * The public key and the salt both live in localStorage, so a local attacker
 * with localStorage read access (XSS, malicious extension) can reproduce the
 * derived key. This is obfuscation-at-rest, not strong confidentiality against
 * a local attacker. "Active session only" is enforced by convention: the key is
 * derived and cached in memory only while a wallet is connected and cleared on
 * disconnect. A stronger design would derive the key from a secret the browser
 * never stores (e.g. a wallet signature), which was intentionally out of scope
 * for this change.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** localStorage key holding the base64 PBKDF2 salt shared across encrypted stores. */
export const ENCRYPTION_SALT_STORAGE_KEY = "finchippay:enc-salt";

const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce recommended for AES-GCM
const PBKDF2_ITERATIONS = 150_000;
const AES_KEY_LENGTH = 256;

// ─── Environment helpers ────────────────────────────────────────────────────

/**
 * Resolve the Web Crypto SubtleCrypto implementation. Works in the browser and
 * under Node/jsdom test environments where `crypto` is polyfilled globally.
 */
function getSubtle(): SubtleCrypto {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error("Web Crypto (SubtleCrypto) is not available in this environment.");
  }
  return cryptoObj.subtle;
}

function getRandomBytes(length: number): Uint8Array {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoObj || !cryptoObj.getRandomValues) {
    throw new Error("Web Crypto (getRandomValues) is not available in this environment.");
  }
  return cryptoObj.getRandomValues(new Uint8Array(length));
}

// ─── Base64 helpers (SSR/Node safe) ─────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  // Node fallback (tests / SSR).
  return Buffer.from(bytes).toString("base64");
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// ─── Salt management ────────────────────────────────────────────────────────

/**
 * Return the persistent PBKDF2 salt, creating and storing one on first use.
 * The salt is intentionally shared across encrypted stores so a single wallet
 * session derives a single key. Reused across sessions so previously written
 * ciphertext stays decryptable.
 */
export function getOrCreateSalt(): Uint8Array {
  if (typeof window === "undefined") {
    // No persistent storage during SSR — return an ephemeral salt.
    return getRandomBytes(SALT_BYTES);
  }

  try {
    const existing = window.localStorage.getItem(ENCRYPTION_SALT_STORAGE_KEY);
    if (existing) {
      const bytes = base64ToBytes(existing);
      if (bytes.length > 0) return bytes;
    }
  } catch {
    // Fall through and generate a fresh (ephemeral) salt.
  }

  const salt = getRandomBytes(SALT_BYTES);
  try {
    window.localStorage.setItem(ENCRYPTION_SALT_STORAGE_KEY, bytesToBase64(salt));
  } catch {
    // Ignore storage failures (private browsing, quota) — key derivation still
    // works this session, but ciphertext won't survive a reload.
  }
  return salt;
}

// ─── Key derivation ─────────────────────────────────────────────────────────

/**
 * Derive a 256-bit AES-GCM key from the connected Stellar public key and salt.
 * Different public keys produce different keys, which drives key rotation when
 * the user switches wallets.
 */
export async function deriveKey(publicKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(publicKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Encrypt / Decrypt ──────────────────────────────────────────────────────

/**
 * Encrypt a string or JSON-serialisable object with AES-GCM.
 * Returns base64 of `iv || ciphertext` so it can be stored as text.
 */
export async function encrypt(data: string | object, key: CryptoKey): Promise<string> {
  const subtle = getSubtle();
  const plaintext = typeof data === "string" ? data : JSON.stringify(data);
  const iv = getRandomBytes(IV_BYTES);

  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );

  const cipherBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  return bytesToBase64(combined);
}

/**
 * Decrypt a base64 payload produced by {@link encrypt}. Rejects when the key is
 * wrong or the ciphertext has been tampered with (AES-GCM authentication).
 */
export async function decrypt(encryptedData: string, key: CryptoKey): Promise<string> {
  const subtle = getSubtle();
  const combined = base64ToBytes(encryptedData);
  if (combined.length <= IV_BYTES) {
    throw new Error("Invalid encrypted payload.");
  }

  const iv = combined.slice(0, IV_BYTES);
  const cipherBytes = combined.slice(IV_BYTES);

  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    cipherBytes as unknown as BufferSource
  );

  return new TextDecoder().decode(plaintext);
}

// ─── Session key holder (in-memory only) ────────────────────────────────────

let sessionKey: CryptoKey | null = null;
let sessionOwner: string | null = null;

/** Store the derived key for the active wallet session. Memory only. */
export function setSessionKey(key: CryptoKey, ownerPublicKey: string) {
  sessionKey = key;
  sessionOwner = ownerPublicKey;
}

/** The active session key, or null when no wallet is connected. */
export function getSessionKey(): CryptoKey | null {
  return sessionKey;
}

/** The public key the current session key was derived from. */
export function getSessionOwner(): string | null {
  return sessionOwner;
}

/** Forget the session key (called on wallet disconnect). */
export function clearSessionKey() {
  sessionKey = null;
  sessionOwner = null;
}
