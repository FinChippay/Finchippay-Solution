/**
 * @file __tests__/encryptedStorage.test.ts
 * @description Integration tests for the encrypted storage layer
 * (frontend/lib/encryptedStorage.ts).
 *
 * Verifies the storage-level acceptance criteria:
 * - Data persisted to localStorage is an encrypted envelope, not plaintext
 * - Data is only readable once the store is unlocked with a session key
 * - Legacy plaintext data is migrated to ciphertext on unlock
 * - Switching wallets is detected as needing re-encryption
 * - Decryption errors are handled gracefully with user-friendly messages
 */

import { deriveKey, getOrCreateSalt, TamperDetectedError, WrongKeyError, DecryptionError } from "@/lib/encryption";
import { createEncryptedStore } from "@/lib/encryptedStorage";

const PUBLIC_KEY_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
const PUBLIC_KEY_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7";
const STORAGE_KEY = "test-encrypted-storage";

interface TestItem {
  id: string;
  name: string;
  value: string;
}

const testItem: TestItem = {
  id: "1",
  name: "Alice",
  value: PUBLIC_KEY_A,
};

async function keyFor(publicKey: string) {
  return deriveKey(publicKey, getOrCreateSalt());
}

// Create a test store for each test
let testStore: ReturnType<typeof createEncryptedStore<TestItem>>;

/** Wait for the background write queue to flush an envelope to storage. */
async function waitForEnvelope(): Promise<{ v: number; owner: string; data: string }> {
  for (let i = 0; i < 50; i++) {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 2) return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Encrypted envelope was never written to storage.");
}

beforeEach(() => {
  window.localStorage.clear();
  testStore = createEncryptedStore<TestItem>({
    storageKey: STORAGE_KEY,
    eventName: "test-updated",
    revive: (raw: unknown): TestItem | null => {
      const item = raw as Partial<TestItem>;
      if (typeof item?.id === "string" && typeof item?.name === "string") {
        return { id: item.id, name: item.name, value: item.value || "" };
      }
      return null;
    },
  });
});

describe("encrypted storage", () => {
  it("persists saved items as an encrypted envelope, not plaintext", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key, PUBLIC_KEY_A);

    testStore.save([testItem]);
    const envelope = await waitForEnvelope();

    expect(envelope.owner).toBe(PUBLIC_KEY_A);
    expect(typeof envelope.data).toBe("string");

    // The encrypted payload must not leak the item's name/value. (The
    // `owner` field intentionally holds the already-public wallet key as
    // rotation metadata, so we assert on the ciphertext `data` specifically.)
    expect(envelope.data).not.toContain("Alice");
    expect(envelope.data).not.toContain(PUBLIC_KEY_A.slice(0, 20));

    // The in-memory cache still exposes the decrypted item.
    expect(testStore.load()).toHaveLength(1);
    expect(testStore.load()[0].name).toBe("Alice");
  });

  it("returns nothing until the store is unlocked", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key, PUBLIC_KEY_A);
    testStore.save([testItem]);
    await waitForEnvelope();

    // Simulate a disconnect: the decrypted cache is dropped.
    testStore.lock();
    expect(testStore.load()).toEqual([]);

    // Unlocking again with the correct key restores the item.
    const key2 = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key2, PUBLIC_KEY_A);
    expect(testStore.load()).toHaveLength(1);
  });

  it("migrates legacy plaintext items into ciphertext on unlock", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([testItem]));

    const key = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key, PUBLIC_KEY_A);

    expect(testStore.load()).toHaveLength(1);

    const envelope = await waitForEnvelope();
    expect(envelope.v).toBe(2);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain("Alice");
  });

  it("retains the encrypted envelope on disconnect (locks, does not wipe)", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key, PUBLIC_KEY_A);
    testStore.save([testItem]);
    await waitForEnvelope();

    // Disconnect: the decrypted cache is dropped but the ciphertext must remain.
    testStore.lock();
    expect(testStore.load()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Reconnecting the same wallet restores the item from the retained envelope.
    const key2 = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key2, PUBLIC_KEY_A);
    expect(testStore.load()).toHaveLength(1);
    expect(testStore.load()[0].name).toBe("Alice");
  });

  it("empties without locking on clear(), so later saves still persist", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(key, PUBLIC_KEY_A);
    testStore.save([testItem]);
    await waitForEnvelope();

    testStore.clear();
    expect(testStore.load()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    // clear() is a data operation, not a session one: the session key survives,
    // so a subsequent save is still written as ciphertext (no unlock needed).
    testStore.save([testItem]);
    const envelope = await waitForEnvelope();
    expect(envelope.owner).toBe(PUBLIC_KEY_A);
    expect(envelope.data).not.toContain("Alice");
    expect(testStore.load()).toHaveLength(1);
  });

  it("flags stored data as needing re-encryption after a wallet switch", async () => {
    const keyA = await keyFor(PUBLIC_KEY_A);
    await testStore.unlock(keyA, PUBLIC_KEY_A);
    testStore.save([testItem]);
    await waitForEnvelope();

    expect(testStore.needsReEncryption(PUBLIC_KEY_A)).toBe(false);
    expect(testStore.needsReEncryption(PUBLIC_KEY_B)).toBe(true);
  });

  it("handles decryption errors gracefully with error callback", async () => {
    let errorCallback: DecryptionError | null = null;
    
    const errorStore = createEncryptedStore<TestItem>({
      storageKey: STORAGE_KEY,
      eventName: "test-error",
      revive: (raw: unknown): TestItem | null => {
        const item = raw as Partial<TestItem>;
        if (typeof item?.id === "string" && typeof item?.name === "string") {
          return { id: item.id, name: item.name, value: item.value || "" };
        }
        return null;
      },
      onDecryptionError: (error) => {
        errorCallback = error;
      },
    });

    const keyA = await keyFor(PUBLIC_KEY_A);
    await errorStore.unlock(keyA, PUBLIC_KEY_A);
    errorStore.save([testItem]);
    await waitForEnvelope();

    // Manually corrupt the stored data to simulate tampering
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Corrupt the encrypted data
      parsed.data = parsed.data.slice(0, -5) + "XXXXX";
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }

    // This should handle the error gracefully without crashing
    const keyA2 = await keyFor(PUBLIC_KEY_A);
    await errorStore.unlock(keyA2, PUBLIC_KEY_A);
    
    // The error callback should have been called
    expect(errorCallback).toBeInstanceOf(DecryptionError);
    
    // The cache should be empty or fallback to legacy data
    const loaded = errorStore.load();
    expect(Array.isArray(loaded)).toBe(true);
    
    // The store should expose the last error
    expect(errorStore.getLastError()).toBeInstanceOf(DecryptionError);
    
    // Clearing the error should work
    errorStore.clearLastError();
    expect(errorStore.getLastError()).toBeNull();
  });
});
