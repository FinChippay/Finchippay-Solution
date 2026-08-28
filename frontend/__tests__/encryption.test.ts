/**
 * @file __tests__/encryption.test.ts
 * @description Unit tests for frontend/lib/encryption.ts
 *
 * Covers the encryption acceptance criteria:
 * - AES-GCM round-trips strings and objects
 * - Stored ciphertext is Base64-encoded and not plaintext
 * - Decryption fails with the wrong key (only decryptable with the session key)
 * - Tampered ciphertext is rejected (GCM authentication)
 * - Each encryption uses a fresh IV
 */

import {
  encrypt,
  decrypt,
  deriveKey,
} from "@/lib/encryption";

const PUBLIC_KEY_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
const PUBLIC_KEY_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

async function keyFor(publicKey: string) {
  // simulate a signature
  return deriveKey(`mock-signature-for-${publicKey}`);
}

describe("encryption round-trip", () => {
  it("decrypts a string back to the original plaintext", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    const message = "Alice — GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";

    const encrypted = await encrypt(message, key);
    const decrypted = await decrypt(encrypted, key);

    expect(decrypted).toBe(message);
  });

  it("decrypts an object back to the original JSON", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    const contacts = [
      { id: "1", nickname: "Alice", address: PUBLIC_KEY_A },
      { id: "2", nickname: "Bob", address: PUBLIC_KEY_B },
    ];

    const encrypted = await encrypt(contacts, key);
    const decrypted = JSON.parse(await decrypt(encrypted, key));

    expect(decrypted).toEqual(contacts);
  });
});

describe("ciphertext format", () => {
  it("is Base64-encoded and does not contain the plaintext", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    const secret = "super-secret-nickname";

    const encrypted = await encrypt(secret, key);

    expect(encrypted).toMatch(BASE64_PATTERN);
    expect(encrypted).not.toContain(secret);
  });

  it("produces a different IV/ciphertext each time (fresh nonce)", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    const message = "same message";

    const first = await encrypt(message, key);
    const second = await encrypt(message, key);

    expect(first).not.toBe(second);
    // Both still decrypt to the same plaintext.
    expect(await decrypt(first, key)).toBe(message);
    expect(await decrypt(second, key)).toBe(message);
  });
});

describe("decryption failures", () => {
  it("rejects when decrypting with a key derived from a different wallet", async () => {
    const keyA = await keyFor(PUBLIC_KEY_A);
    const keyB = await keyFor(PUBLIC_KEY_B);

    const encrypted = await encrypt("only for wallet A", keyA);

    await expect(decrypt(encrypted, keyB)).rejects.toBeDefined();
  });

  it("rejects tampered ciphertext (GCM authentication)", async () => {
    const key = await keyFor(PUBLIC_KEY_A);
    const encrypted = await encrypt("integrity matters", key);

    // Flip a character near the end (inside the ciphertext/auth tag).
    const idx = encrypted.length - 3;
    const original = encrypted[idx];
    const swapped = original === "A" ? "B" : "A";
    const tampered = encrypted.slice(0, idx) + swapped + encrypted.slice(idx + 1);

    await expect(decrypt(tampered, key)).rejects.toBeDefined();
  });
});
