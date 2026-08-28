const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const key = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("WEBHOOK_ENCRYPTION_KEY is not set");
  }
  return Buffer.from(key, "hex");
}

function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decryptSecret(cipherBundle) {
  const key = getKey();
  const parts = cipherBundle.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid cipher bundle format");
  }
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

module.exports = { encryptSecret, decryptSecret };
