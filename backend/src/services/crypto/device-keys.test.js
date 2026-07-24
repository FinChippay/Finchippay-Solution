const crypto = require('crypto');
const { encryptForRecipient, addDeviceKey, removeDeviceKey, clearDeviceKeys } = require('./device-keys');

// Helper to generate RSA key pair
function generateRSAKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('device-keys', () => {
  const recipient = 'recipient-123';
  const message = 'secret-message';

  beforeEach(() => {
    clearDeviceKeys();
  });

  test('should encrypt for multiple devices and decryptable by each', () => {
    const keyPair1 = generateRSAKeyPair();
    const keyPair2 = generateRSAKeyPair();

    addDeviceKey(recipient, { id: 'device-1', publicKey: keyPair1.publicKey });
    addDeviceKey(recipient, { id: 'device-2', publicKey: keyPair2.publicKey });

    const { wrappedCEKs, encryptedPayload } = encryptForRecipient(recipient, message);

    expect(wrappedCEKs).toHaveProperty('device-1');
    expect(wrappedCEKs).toHaveProperty('device-2');

    // Verify decryption for device 1
    const encryptedCEK1 = Buffer.from(wrappedCEKs['device-1'], 'base64');
    const cek1 = crypto.privateDecrypt(
      { key: keyPair1.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      encryptedCEK1
    );

    const { iv, tag, data } = JSON.parse(encryptedPayload);
    const decipher1 = crypto.createDecipheriv('aes-256-gcm', cek1, Buffer.from(iv, 'hex'));
    decipher1.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted1 = decipher1.update(data, 'hex', 'utf8');
    decrypted1 += decipher1.final('utf8');
    expect(decrypted1).toBe(message);

    // Verify decryption for device 2
    const encryptedCEK2 = Buffer.from(wrappedCEKs['device-2'], 'base64');
    const cek2 = crypto.privateDecrypt(
      { key: keyPair2.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      encryptedCEK2
    );

    const decipher2 = crypto.createDecipheriv('aes-256-gcm', cek2, Buffer.from(iv, 'hex'));
    decipher2.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted2 = decipher2.update(data, 'hex', 'utf8');
    decrypted2 += decipher2.final('utf8');
    expect(decrypted2).toBe(message);
  });

  test('should not allow decryption by removed device', () => {
    const keyPair1 = generateRSAKeyPair();
    addDeviceKey(recipient, { id: 'device-1', publicKey: keyPair1.publicKey });

    removeDeviceKey(recipient, 'device-1');

    expect(() => encryptForRecipient(recipient, message)).toThrow('No authorized device keys found for the recipient');
  });
});
