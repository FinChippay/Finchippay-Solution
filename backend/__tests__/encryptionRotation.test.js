/* eslint-env jest */
/**
 * __tests__/encryptionRotation.test.js
 * Webhook at-rest secret encryption: key-versioned ciphertext + rotation (WS7).
 */
"use strict";

const crypto = require("crypto");
const { encryptSecret, decryptSecret } = require("../src/utils/encryption");

/** 32-byte hex key from a repeating nibble. */
const hexKey = (c) => c.repeat(32);

describe("encryption (WS7)", () => {
  const K1 = hexKey("11");
  const K2 = hexKey("22");
  const secret = "whsec_myLongRandomSecret";

  beforeEach(() => {
    process.env.WEBHOOK_ENCRYPTION_KEY = K1;
    delete process.env.WEBHOOK_ENCRYPTION_KEY_OLD;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
    delete process.env.WEBHOOK_ENCRYPTION_KEY_OLD;
  });

  test("round-trips plaintext through encrypt/decrypt", () => {
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  test("ciphertext is versioned (kid:iv:authTag:ct) with a random IV", () => {
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a.split(":")).toHaveLength(4);
    expect(a.startsWith("1:")).toBe(true);
    expect(a).not.toBe(b); // random IV ⇒ distinct ciphertexts
    const ivA = a.split(":")[1];
    const ivB = b.split(":")[1];
    expect(ivA).not.toBe(ivB);
  });

  test("decrypts legacy un-versioned 3-part bundles (pre-rotation)", () => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(K1, "hex"), iv);
    let ct = cipher.update(secret, "utf8", "hex");
    ct += cipher.final("hex");
    const legacy = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct}`;
    expect(decryptSecret(legacy)).toBe(secret);
  });

  test("supports rotation: old ciphertext still decrypts via WEBHOOK_ENCRYPTION_KEY_OLD", () => {
    const oldCiphertext = encryptSecret(secret); // encrypted with K1

    // Rotate: K2 becomes current; K1 moves to the OLD slot.
    process.env.WEBHOOK_ENCRYPTION_KEY = K2;
    process.env.WEBHOOK_ENCRYPTION_KEY_OLD = K1;

    expect(decryptSecret(oldCiphertext)).toBe(secret); // previous blob readable
    const fresh = encryptSecret(secret); // new ciphertext uses K2
    expect(decryptSecret(fresh)).toBe(secret);
  });

  test("throws if the current key is unset (fail closed)", () => {
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
    expect(() => encryptSecret(secret)).toThrow("WEBHOOK_ENCRYPTION_KEY is not set");
    expect(() => decryptSecret(encryptSecret(secret))).toThrow("WEBHOOK_ENCRYPTION_KEY is not set");
  });

  test("throws on a malformed cipher bundle", () => {
    expect(() => decryptSecret("only-one-part")).toThrow();
    expect(() => decryptSecret("a:two")).toThrow();
    // versioned format with a bogus key id
    expect(() => decryptSecret("9:0000:0000:0000")).toThrow();
  });
});
