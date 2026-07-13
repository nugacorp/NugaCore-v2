import { createHash, randomBytes } from 'crypto';

/** Genera una comunidad SNMPv2c única por router (solo lectura). */
export function generateSnmpCommunity(routerName: string): string {
  const salt = randomBytes(4).toString('hex');
  const hash = createHash('sha256').update(`${routerName}:${salt}`).digest('hex').slice(0, 10);
  return `nc-${hash}`;
}
