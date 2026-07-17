// ====================================================================
// Generador seguro de credenciales de provisioning MikroTik (Fase 4.4).
//
// - username único por router: nugacore_<short_id>
// - password fuerte: >= 32 caracteres, aleatorio criptográfico
// - provisioning token: un solo uso, expirable (se guarda solo el hash)
// - el password se cifra con MIKROTIK_CREDENTIALS_KEY (crypto.ts)
//
// REGLA: nunca imprimir el password ni el token en logs. Estas funciones
// solo DEVUELVEN valores; el llamador decide qué persistir (cifrado/hash).
// ====================================================================

import { createHash, randomBytes, randomInt } from 'crypto';
import { encryptSecret } from '../../../services/crypto';
import { ENCRYPTION_VERSION, GeneratedCredential, GeneratedToken } from './types';

// Alfabeto seguro para passwords incrustados en scripts RouterOS (dentro de
// comillas dobles): solo alfanumérico + '-' '_' para evitar romper el script
// con caracteres como " \ $ espacio.
const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DEFAULT_PASSWORD_LENGTH = 40; // > 32 por margen
const DEFAULT_TOKEN_TTL_HOURS = 24;

/** Identificador corto, alfanumérico en minúsculas (para el username). */
export const shortId = (bytes = 4): string => randomBytes(bytes).toString('hex');

/** Username único: nugacore_<short_id>. */
export const generateApiUsername = (seed?: string): string => {
  const clean = (seed || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffix = clean ? `${clean.substring(0, 6)}${shortId(2)}` : shortId(4);
  return `nugacore_${suffix}`;
};

/** Substrings de branding que no deben aparecer ni en secretos embebidos. */
const PASSWORD_BRAND_BLOCKLIST = ['livaur', 'wisphub', 'uisp', 'sgcm', 'whmcs'];

/** Password aleatorio criptográfico, sin sesgo de módulo (randomInt). */
export const generateStrongPassword = (length = DEFAULT_PASSWORD_LENGTH): string => {
  const len = Math.max(32, length);
  for (let attempt = 0; attempt < 16; attempt++) {
    let out = '';
    for (let i = 0; i < len; i++) {
      out += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
    }
    const lower = out.toLowerCase();
    if (!PASSWORD_BRAND_BLOCKLIST.some((b) => lower.includes(b))) {
      return out;
    }
  }
  // Extremadamente improbable: devolver el último intento (el scan de branding
  // del generador ya ignora valores password="...").
  let fallback = '';
  for (let i = 0; i < len; i++) {
    fallback += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return fallback;
};

/** sha256 en hex (para token_hash / script_hash). */
export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * Genera la credencial API completa: username + password fuerte cifrado.
 * Devuelve también el password en claro SOLO para incrustarlo una vez en el
 * script; el llamador no debe persistirlo ni registrarlo.
 */
export const generateApiCredential = (seed?: string): GeneratedCredential => {
  const username = generateApiUsername(seed);
  const plainPassword = generateStrongPassword();
  const encryptedPassword = encryptSecret(plainPassword);
  return {
    username,
    encryptedPassword,
    encryptionVersion: ENCRYPTION_VERSION,
    plainPassword,
  };
};

/**
 * Genera un token de provisioning de un solo uso y expirable.
 * Devuelve el token en claro (entregar una vez) + su hash + expiración.
 */
export const generateProvisioningToken = (ttlHours = DEFAULT_TOKEN_TTL_HOURS): GeneratedToken => {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  return { token, tokenHash, expiresAt };
};
