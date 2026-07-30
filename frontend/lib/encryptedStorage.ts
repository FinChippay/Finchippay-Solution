/**
 * lib/encryptedStorage.ts
 * A generic, encrypted-at-rest localStorage collection.
 *
 * Data is stored as an envelope `{ v: 2, owner, data }` where `data` is the
 * AES-GCM ciphertext (base64) of the JSON-serialised item array. Callers keep a
 * synchronous API: `load`/`save` operate on an in-memory decrypted cache while
 * encryption and persistence happen asynchronously in the background.
 *
 * The cache is only populated once a wallet session key is available (via
 * `unlock`). Until then `load()` returns an empty list and `save()` no-ops on
 * persistence (it never writes plaintext).
 */

import { encrypt, decrypt } from "@/lib/encryption";

const ENVELOPE_VERSION = 2 as const;

interface Envelope {
  v: typeof ENVELOPE_VERSION;
  owner: string;
  data: string;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Envelope).v === ENVELOPE_VERSION &&
    typeof (value as Envelope).owner === "string" &&
    typeof (value as Envelope).data === "string"
  );
}

export interface EncryptedStoreOptions<T> {
  /** Primary localStorage key holding the encrypted envelope. */
  storageKey: string;
  /** Event dispatched on the window whenever the collection changes. */
  eventName: string;
  /** Legacy plaintext keys to migrate from on first unlock. */
  legacyKeys?: string[];
  /** Validate/normalise a single raw item; return null to drop it. */
  revive: (raw: unknown) => T | null;
  /** Optional de-duplication applied after merging sources. */
  dedupe?: (items: T[]) => T[];
}

export interface EncryptedStore<T> {
  load: () => T[];
  save: (items: T[]) => void;
  unlock: (key: CryptoKey, owner: string) => Promise<void>;
  reEncrypt: (key: CryptoKey, owner: string) => Promise<void>;
  lock: () => void;
  clear: () => void;
  subscribe: (callback: (items: T[]) => void) => () => void;
  /** True when a stored envelope was encrypted for a different wallet. */
  needsReEncryption: (owner: string) => boolean;
}

export function createEncryptedStore<T>(options: EncryptedStoreOptions<T>): EncryptedStore<T> {
  const { storageKey, eventName, legacyKeys = [], revive, dedupe } = options;

  // In-memory decrypted cache. `null` means "not yet unlocked this session".
  let cache: T[] | null = null;
  // Serialises background writes so rapid saves persist in order.
  let writeQueue: Promise<void> = Promise.resolve();

  function reviveArray(raw: unknown): T[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(revive).filter((item): item is T => item !== null);
  }

  function applyDedupe(items: T[]): T[] {
    return dedupe ? dedupe(items) : items;
  }

  function readRaw(key: string): unknown {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function readLegacyPlaintext(): T[] {
    const items: T[] = [];
    for (const key of legacyKeys) {
      items.push(...reviveArray(readRaw(key)));
    }
    return items;
  }

  function removeLegacy() {
    if (typeof window === "undefined") return;
    for (const key of legacyKeys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage failures.
      }
    }
  }

  function emit() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(eventName, { detail: cache ?? [] }));
  }

  function persist(items: T[], key: CryptoKey, owner: string) {
    if (typeof window === "undefined") return;
    // Chain onto the write queue so concurrent saves land in order.
    writeQueue = writeQueue
      .then(async () => {
        const data = await encrypt(items, key);
        const envelope: Envelope = { v: ENVELOPE_VERSION, owner, data };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(envelope));
        } catch {
          // Ignore storage failures (private browsing, quota).
        }
      })
      .catch(() => {
        // Swallow to keep the queue alive for subsequent writes.
      });
  }

  function load(): T[] {
    return cache ?? [];
  }

  function save(items: T[]) {
    cache = items;
    emit();

    const key = currentKey;
    const owner = currentOwner;
    if (key && owner) {
      persist(items, key, owner);
    }
    // Without a session key we never write plaintext — the cache holds the
    // change for this session only.
  }

  async function unlock(key: CryptoKey, owner: string): Promise<void> {
    currentKey = key;
    currentOwner = owner;

    const raw = readRaw(storageKey);

    if (isEnvelope(raw)) {
      if (raw.owner === owner) {
        // Same wallet — decrypt the stored ciphertext.
        try {
          const decrypted = await decrypt(raw.data, key);
          const items = reviveArray(JSON.parse(decrypted));
          const legacy = readLegacyPlaintext();
          cache = applyDedupe([...items, ...legacy]);
          if (legacy.length > 0) {
            persist(cache, key, owner);
            removeLegacy();
          }
        } catch {
          // Corrupt/undecryptable payload — start from legacy plaintext only.
          cache = applyDedupe(readLegacyPlaintext());
        }
      } else {
        // Different wallet: cannot decrypt. Preserve any in-memory data so the
        // user can re-encrypt it under the new key; otherwise show nothing.
        cache = cache ?? [];
      }
      emit();
      return;
    }

    // No envelope yet: migrate any plaintext (from this key or legacy keys).
    const plaintextHere = reviveArray(raw);
    const legacy = readLegacyPlaintext();
    cache = applyDedupe([...plaintextHere, ...legacy]);
    if (cache.length > 0) {
      persist(cache, key, owner);
      removeLegacy();
    }
    emit();
  }

  /** Write the current in-memory cache under a (new) key/owner. */
  async function reEncrypt(key: CryptoKey, owner: string): Promise<void> {
    currentKey = key;
    currentOwner = owner;
    const items = cache ?? [];
    persist(items, key, owner);
    await writeQueue;
    emit();
  }

  function lock() {
    cache = null;
    currentKey = null;
    currentOwner = null;
    emit();
  }

  /**
   * Empty the collection. This is a data operation, not a session one: the
   * session key/owner are retained so subsequent saves still persist. Forgetting
   * the key is `lock()`'s job (see `disconnectWallet`).
   */
  function clear() {
    cache = [];
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage failures.
      }
      removeLegacy();
    }
    emit();
  }

  function subscribe(callback: (items: T[]) => void): () => void {
    if (typeof window === "undefined") return () => undefined;

    const onChange = () => callback(load());
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || (event.key && legacyKeys.includes(event.key))) {
        callback(load());
      }
    };

    window.addEventListener(eventName, onChange);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(eventName, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }

  function needsReEncryption(owner: string): boolean {
    const raw = readRaw(storageKey);
    return isEnvelope(raw) && raw.owner !== owner;
  }

  // Session key/owner scoped to this store instance (mirrors the module-level
  // session key in encryption.ts but lets each store persist independently).
  let currentKey: CryptoKey | null = null;
  let currentOwner: string | null = null;

  return {
    load,
    save,
    unlock,
    reEncrypt,
    lock,
    clear,
    subscribe,
    needsReEncryption,
  };
}
