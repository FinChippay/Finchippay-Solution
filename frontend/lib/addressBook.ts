import { createEncryptedStore } from "@/lib/encryptedStorage";
import { isValidStellarAddress } from "@/lib/stellar";

// ─── Address Book ──────────────────────────────────────────────────────────

const ADDRESS_BOOK_KEY = "finchippay:address-book";
const ADDRESS_BOOK_UPDATED_EVENT = "finchippay:address-book-updated";

export interface AddressBookContact {
  id: string;
  nickname: string;
  address: string;
  createdAt: number;
  updatedAt: number;
}

function makeContact(raw: unknown): AddressBookContact | null {
  const entry = (raw ?? {}) as Partial<AddressBookContact>;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const nickname = typeof entry.nickname === "string" ? entry.nickname.trim() : "";
  const address = typeof entry.address === "string" ? entry.address.trim() : "";

  if (!id || !nickname || !isValidStellarAddress(address)) return null;

  return {
    id,
    nickname,
    address,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
  };
}

function dedupeContacts(items: AddressBookContact[]): AddressBookContact[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

const store = createEncryptedStore<AddressBookContact>({
  storageKey: ADDRESS_BOOK_KEY,
  eventName: ADDRESS_BOOK_UPDATED_EVENT,
  revive: makeContact,
  dedupe: dedupeContacts,
});

export function getAddressBookStorageKey(): string {
  return ADDRESS_BOOK_KEY;
}

export function loadAddressBookContacts(): AddressBookContact[] {
  return store.load();
}

export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  store.save(contacts);
}

export function clearAddressBook() {
  store.clear();
}

// ─── Federation Cache ──────────────────────────────────────────────────────

const FEDERATION_CACHE_KEY = "finchippay:federation-cache";
const FEDERATION_CACHE_UPDATED_EVENT = "finchippay:federation-cache-updated";
const FEDERATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FederationCacheEntry {
  /** Normalised (trimmed, lowercased) federation address, e.g. `bob*stellar.org`. */
  federationAddress: string;
  address: string;
  resolvedAt: number;
}

function normaliseFederationAddress(address: string): string {
  return address.trim().toLowerCase();
}

function now() {
  return Date.now();
}

function makeFederationEntry(input: unknown): FederationCacheEntry | null {
  const entry = (input ?? {}) as Partial<FederationCacheEntry>;
  const federationAddress =
    typeof entry.federationAddress === "string" ? normaliseFederationAddress(entry.federationAddress) : "";
  const address = typeof entry.address === "string" ? entry.address.trim() : "";

  if (!federationAddress || !isValidStellarAddress(address)) return null;

  return {
    federationAddress,
    address,
    resolvedAt: typeof entry.resolvedAt === "number" ? entry.resolvedAt : now(),
  };
}

/** Keep the first (most recently written) entry per federation address. */
function dedupeFederationEntries(entries: FederationCacheEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.federationAddress)) return false;
    seen.add(entry.federationAddress);
    return true;
  });
}

const federationStore = createEncryptedStore<FederationCacheEntry>({
  storageKey: FEDERATION_CACHE_KEY,
  eventName: FEDERATION_CACHE_UPDATED_EVENT,
  revive: makeFederationEntry,
  dedupe: dedupeFederationEntries,
});

export function getCachedFederationAddress(federationAddress: string): string | null {
  const key = normaliseFederationAddress(federationAddress);
  const entry = federationStore.load().find((item) => item.federationAddress === key);
  if (!entry) return null;
  if (now() - entry.resolvedAt > FEDERATION_CACHE_TTL_MS) return null;
  return entry.address;
}

export function setCachedFederationAddress(federationAddress: string, stellarAddress: string) {
  const key = normaliseFederationAddress(federationAddress);
  const entry = makeFederationEntry({
    federationAddress: key,
    address: stellarAddress,
    resolvedAt: now(),
  });
  if (!entry) return;

  const existing = federationStore.load().filter((item) => item.federationAddress !== key);
  federationStore.save([entry, ...existing]);
}

export async function resolveFederationWithCache(
  federationAddress: string
): Promise<string | null> {
  const cached = getCachedFederationAddress(federationAddress);
  if (cached) return cached;

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
  const url = `${apiBase}/federation?q=${encodeURIComponent(federationAddress)}&type=name`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data?.account_id && isValidStellarAddress(data.account_id)) {
      setCachedFederationAddress(federationAddress, data.account_id);
      return data.account_id;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearFederationCache() {
  federationStore.clear();
}

// ─── Session lifecycle (called from the wallet layer) ───────────────────────

/** Decrypt the address book into memory for the given wallet session. */
export function unlockAddressBook(key: CryptoKey, owner: string) {
  return store.unlock(key, owner);
}

/** Re-encrypt the in-memory contacts under a new wallet key (rotation). */
export function reEncryptAddressBook(key: CryptoKey, owner: string) {
  return store.reEncrypt(key, owner);
}

/** Drop the decrypted contacts from memory (on disconnect). */
export function lockAddressBook() {
  store.lock();
}

/** True when the stored contacts were encrypted for a different wallet. */
export function addressBookNeedsReEncryption(owner: string) {
  return store.needsReEncryption(owner);
}

/** Decrypt the federation cache into memory for the given wallet session. */
export function unlockFederationCache(key: CryptoKey, owner: string) {
  return federationStore.unlock(key, owner);
}

/** Re-encrypt the cached federation resolutions under a new wallet key. */
export function reEncryptFederationCache(key: CryptoKey, owner: string) {
  return federationStore.reEncrypt(key, owner);
}

/** Drop the decrypted federation cache from memory (on disconnect). */
export function lockFederationCache() {
  federationStore.lock();
}
