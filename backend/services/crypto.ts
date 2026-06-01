import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env, isProduction } from '../config/env';
import { logger } from '../common/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let warnedAboutFallbackKey = false;

const getKey = (): Buffer => {
  if (!env.MIKROTIK_CREDENTIALS_KEY) {
    // Falling back to APP_URL or a hardcoded constant makes the key predictable,
    // which is equivalent to storing the credentials in plaintext.
    if (isProduction) {
      throw new Error(
        'MIKROTIK_CREDENTIALS_KEY must be set in production to encrypt MikroTik credentials',
      );
    }
    if (!warnedAboutFallbackKey) {
      logger.warn(
        'MIKROTIK_CREDENTIALS_KEY is not set; using a predictable fallback key. ' +
          'Do not store real credentials with this configuration.',
      );
      warnedAboutFallbackKey = true;
    }
  }

  const source = env.MIKROTIK_CREDENTIALS_KEY || env.APP_URL || 'nugacore-default-mikrotik-key';
  return createHash('sha256').update(source).digest();
};

export const encryptSecret = (plainText: string): string => {
  const iv = randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
};

export const decryptSecret = (payload: string): string => {
  const [ivB64, authTagB64, encryptedB64] = payload.split('.');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const key = getKey();

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
};
