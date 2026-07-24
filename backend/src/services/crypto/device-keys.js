const crypto = require('crypto');

// Map of recipient address to their list of active device keys
const deviceKeysMap = new Map();

// Generate a symmetric content encryption key (CEK)
function generateCEK() {
  return crypto.randomBytes(32); // 256 bits
}

// Wrap (encrypt) the CEK with a device public key
function wrapCEK(cek, deviceKey) {
  const encryptedKey = crypto.publicEncrypt(
    {
      key: deviceKey.publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    cek
  );
  return encryptedKey.toString('base64');
}

// Function to encrypt message content for multiple devices
function encryptForRecipient(recipientAddress, message) {
  const deviceKeys = deviceKeysMap.get(recipientAddress) || [];
  if (deviceKeys.length === 0) {
    throw new Error('No authorized device keys found for the recipient');
  }

  const cek = generateCEK();
  const wrappedCEKs = {};

  for (const deviceKey of deviceKeys) {
    wrappedCEKs[deviceKey.id] = wrapCEK(cek, deviceKey);
  }

  // Encrypt the payload with the CEK
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv);
  let encrypted = cipher.update(message, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    wrappedCEKs,
    encryptedPayload: JSON.stringify({
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    }),
  };
}

// Add/Remove keys
function addDeviceKey(recipientAddress, deviceKey) {
  const keys = deviceKeysMap.get(recipientAddress) || [];
  keys.push(deviceKey);
  deviceKeysMap.set(recipientAddress, keys);
}

function removeDeviceKey(recipientAddress, deviceKeyId) {
  const keys = deviceKeysMap.get(recipientAddress) || [];
  const filteredKeys = keys.filter((k) => k.id !== deviceKeyId);
  deviceKeysMap.set(recipientAddress, filteredKeys);
}

function clearDeviceKeys() {
  deviceKeysMap.clear();
}

module.exports = {
  encryptForRecipient,
  addDeviceKey,
  removeDeviceKey,
  clearDeviceKeys,
};
