/**
 * @file __tests__/encryptedStorage.test.ts
 * @description Integration tests for the encrypted address-book store
 * (frontend/lib/encryptedStorage.ts via frontend/lib/addressBook.ts).
 *
 * Verifies the storage-level acceptance criteria:
 * - Contacts persisted to localStorage are an encrypted envelope, not plaintext
 * - Contacts are only readable once the store is unlocked with a session key
 * - Legacy plaintext contacts are migrated to ciphertext on unlock
 * - Switching wallets is detected as needing re-encryption
 */

import { deriveKey } from "@/lib/encryption";
import {
  addressBookNeedsReEncryption,
  clearAddressBook,
  getAddressBookStorageKey,
  loadAddressBookContacts,
  lockAddressBook,
  saveAddressBookContacts,
  unlockAddressBook,
  type AddressBookContact,
} from "@/lib/addressBook";

const PUBLIC_KEY_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
const PUBLIC_KEY_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7";
const STORAGE_KEY = getAddressBookStorageKey();

const contact: AddressBookContact = {
  id: "1",
  nickname: "Alice",
  address: PUBLIC_KEY_A,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

async function keyFor(publicKey: string) {
  return deriveKey(`mock-signature-for-${publicKey}`);
}

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
  clearAddressBook();
  window.localStorage.clear();
});

describe("encrypted address book storage", () => {
  it("persists saved contacts as an encrypted envelope, not plaintext", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key, PUBLIC_KEY_A);

    saveAddressBookContacts([contact]);
    const envelope = await waitForEnvelope();

    expect(envelope.owner).toBe(PUBLIC_KEY_A);
    expect(typeof envelope.data).toBe("string");

    // The encrypted payload must not leak the contact's name/address. (The
    // `owner` field intentionally holds the already-public wallet key as
    // rotation metadata, so we assert on the ciphertext `data` specifically.)
    expect(envelope.data).not.toContain("Alice");
    expect(envelope.data).not.toContain(PUBLIC_KEY_A.slice(0, 20));

    // The in-memory cache still exposes the decrypted contact.
    expect(loadAddressBookContacts()).toHaveLength(1);
    expect(loadAddressBookContacts()[0].nickname).toBe("Alice");
  });

  it("returns nothing until the store is unlocked", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key, PUBLIC_KEY_A);
    saveAddressBookContacts([contact]);
    await waitForEnvelope();

    // Simulate a disconnect: the decrypted cache is dropped.
    lockAddressBook();
    expect(loadAddressBookContacts()).toEqual([]);

    // Unlocking again with the correct key restores the contact.
    const key2 = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key2, PUBLIC_KEY_A);
    expect(loadAddressBookContacts()).toHaveLength(1);
  });

  it("migrates legacy plaintext contacts into ciphertext on unlock", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([contact]));

    const key = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key, PUBLIC_KEY_A);

    expect(loadAddressBookContacts()).toHaveLength(1);

    const envelope = await waitForEnvelope();
    expect(envelope.v).toBe(2);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain("Alice");
  });

  it("retains the encrypted envelope on disconnect (locks, does not wipe)", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key, PUBLIC_KEY_A);
    saveAddressBookContacts([contact]);
    await waitForEnvelope();

    // Disconnect: the decrypted cache is dropped but the ciphertext must remain.
    lockAddressBook();
    expect(loadAddressBookContacts()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Reconnecting the same wallet restores the contact from the retained envelope.
    const key2 = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key2, PUBLIC_KEY_A);
    expect(loadAddressBookContacts()).toHaveLength(1);
    expect(loadAddressBookContacts()[0].nickname).toBe("Alice");
  });

  it("empties without locking on clear(), so later saves still persist", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(key, PUBLIC_KEY_A);
    saveAddressBookContacts([contact]);
    await waitForEnvelope();

    clearAddressBook();
    expect(loadAddressBookContacts()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    // clear() is a data operation, not a session one: the session key survives,
    // so a subsequent save is still written as ciphertext (no unlock needed).
    saveAddressBookContacts([contact]);
    const envelope = await waitForEnvelope();
    expect(envelope.owner).toBe(PUBLIC_KEY_A);
    expect(envelope.data).not.toContain("Alice");
    expect(loadAddressBookContacts()).toHaveLength(1);
  });

  it("flags stored data as needing re-encryption after a wallet switch", async () => {
    const keyA = await keyFor(PUBLIC_KEY_A);
    await unlockAddressBook(keyA, PUBLIC_KEY_A);
    saveAddressBookContacts([contact]);
    await waitForEnvelope();

    expect(addressBookNeedsReEncryption(PUBLIC_KEY_A)).toBe(false);
    expect(addressBookNeedsReEncryption(PUBLIC_KEY_B)).toBe(true);
  });
});
