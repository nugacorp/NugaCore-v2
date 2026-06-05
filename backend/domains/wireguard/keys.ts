// ====================================================================
// Generación de claves WireGuard (Fase 4.6.1).
//
// WireGuard usa Curve25519 (X25519). Node genera el par con
// crypto.generateKeyPairSync('x25519'); extraemos los 32 bytes crudos y los
// codificamos en base64 (formato de clave WireGuard, 44 chars).
//
// REGLA: estas funciones solo DEVUELVEN claves. El llamador cifra las
// privadas/preshared antes de persistir. Nunca se loguean.
// ====================================================================

import { generateKeyPairSync, randomBytes } from 'crypto';

export interface WgKeyPair {
  privateKey: string; // base64 (SECRETO)
  publicKey: string;  // base64 (público)
}

// Extrae los 32 bytes crudos del final del DER (x25519: header fijo + 32 bytes).
const rawFromDer = (der: Buffer): Buffer => der.subarray(der.length - 32);

/** Genera un par de claves WireGuard (Curve25519). */
export const generateWgKeyPair = (): WgKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  return {
    publicKey: rawFromDer(pubDer).toString('base64'),
    privateKey: rawFromDer(privDer).toString('base64'),
  };
};

/** Genera una preshared key WireGuard (32 bytes aleatorios, base64). */
export const generatePresharedKey = (): string => randomBytes(32).toString('base64');

/** ¿Tiene forma de clave WireGuard? (32 bytes base64 = 44 chars con '='). */
export const isWgKey = (value: string): boolean => /^[A-Za-z0-9+/]{43}=$/.test(value);
