const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Key IDs used in the versioned ciphertext prefix.
 *
 * Every ciphertext is persisted as `<kid>:<iv>:<authTag>:<ct>`. The kid is a
 * lightweight pointer to the env slot that produced the ciphertext, so a
 * rotation does not silently break decryptability of previously stored blobs.
 *
 * - CURRENT_KID ("1") — encrypted with the current WEBHOOK_ENCRYPTION_KEY.
 * - LEGACY_KID ("0") — a pre-rotation blob. Either an un-versioned legacy
 *   3-part bundle, or a blob written with the previous current key which has
 *   since been moved to WEBHOOK_ENCRYPTION_KEY_OLD.
 *
 * On decrypt we try the key for the advertised kid first and then the other
 * configured key, which makes both re-encrypt-in-place and passive rotation
 * (new ciphertext using the new current key while the old key is still in
 * WEBHOOK_ENCRYPTION_KEY_OLD) work without touching existing rows.
 */
const CURRENT_KID = "1";
const LEGACY_KID = "0";

/**
 * Return the configured keys keyed by kid.
 *
 * The current key is required (fail closed). The old key is optional and is
 * used solely to decrypt ciphertext written before a rotation (i.e. while the
 * previous current key was active).
 *
 * @returns {Map<string, Buffer>}
 */
function getKeys() {
  const current = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!current) {
    throw new Error("WEBHOOK_ENCRYPTION_KEY is not set");
  }
  const keys = new Map();
  keys.set(CURRENT_KID, Buffer.from(current, "hex"));
  const old = process.env.WEBHOOK_ENCRYPTION_KEY_OLD;
  if (old) {
    keys.set(LEGACY_KID, Buffer.from(old, "hex"));
  }
  return keys;
}

/** @returns {Buffer} the current encryption key */
function getKey() {
  return getKeys().get(CURRENT_KID);
}

/**
 * Encrypt `plaintext` with the current key, tagged with the current kid.
 *
 * @param {string} plaintext
 * @returns {string} `<kid>:<iv>:<authTag>:<ct>`
 */
function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${CURRENT_KID}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a versioned or legacy cipher bundle.
 *
 * Supports both the current versioned format (`<kid>:<iv>:<authTag>:<ct>`) and
 * the legacy 3-part format (`<iv>:<authTag>:<ct>`) that existed before
 * rotation support. The kid determines the primary key to try; the other
 * configured key is tried as a fallback so that rotation never loses access to
 * previously encrypted secrets (see WS7).
 *
 * @param {string} cipherBundle
 * @returns {string} the plaintext secret
 */
function decryptSecret(cipherBundle) {
  const keys = getKeys();
  const parts = cipherBundle.split(":");

  let kid;
  let ivHex;
  let authTagHex;
  let ctHex;

  if (parts.length === 4) {
    [kid, ivHex, authTagHex, ctHex] = parts;
  } else if (parts.length === 3) {
    // Legacy un-versioned bundle written before rotation support.
    kid = LEGACY_KID;
    [ivHex, authTagHex, ctHex] = parts;
  } else {
    throw new Error("Invalid cipher bundle format");
  }

  // Build an ordered candidate list: the advertised kid's key first (if we
  // have it), the current key, then any other configured key. This handles
  // legacy un-versioned bundles (no matching kid slot) as well as rotation,
  // where a bundle encrypted with the previous current key carries kid "1"
  // but only decrypts with the key now in webhook_ENCRYPTION_KEY_OLD.
  const candidates = [];
  if (keys.has(kid)) candidates.push(keys.get(kid));
  const current = keys.get(CURRENT_KID);
  if (current && !candidates.includes(current)) candidates.push(current);
  for (const key of keys.values()) {
    if (!candidates.includes(key)) candidates.push(key);
  }

  let lastErr = null;
  for (const key of candidates) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
      let decrypted = decipher.update(ctHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error(`Unable to decrypt secret with any configured key (kid=${kid})`);
}

module.exports = { encryptSecret, decryptSecret };
