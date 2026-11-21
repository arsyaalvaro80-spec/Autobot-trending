import crypto from 'node:crypto';

export interface EncryptedPayload {
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
  algorithm: 'AES-256-GCM';
}

const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32);

function resolveMasterKey(overrideSecret?: string): Buffer {
  const source = overrideSecret ?? process.env.VAULT_ENCRYPTION_KEY ?? '';
  if (source.trim().length > 0) {
    return crypto.scryptSync(source.trim(), 'aurex-quant-vault-salt-v1', 32);
  }
  return EPHEMERAL_FALLBACK_KEY;
}

export function encryptCredential(plaintext: string, overrideSecret?: string): EncryptedPayload {
  const key = resolveMasterKey(overrideSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: encrypted.toString('hex'),
    algorithm: 'AES-256-GCM',
  };
}

export function decryptCredential(payload: EncryptedPayload, overrideSecret?: string): string {
  const key = resolveMasterKey(overrideSecret);
  const iv = Buffer.from(payload.ivHex, 'hex');
  const authTag = Buffer.from(payload.authTagHex, 'hex');
  const ciphertext = Buffer.from(payload.ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskApiKey(apiKey: string): string {
  const clean = apiKey.trim();
  if (clean.length <= 8) {
    return '••••' + clean.slice(-2);
  }
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}
