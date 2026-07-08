// ====================================================================
// Config snapshot — representación tipo /export a partir del snapshot
// normalizado de Inventory Sync (READ-ONLY, sin secretos).
// ====================================================================

import { createHash } from 'node:crypto';
import { RouterOsInventorySnapshot } from './types';

/** Convierte el snapshot normalizado a texto estilo export RouterOS (solo lectura). */
export const snapshotToExportText = (snapshot: RouterOsInventorySnapshot): string => {
  const lines: string[] = [
    `# NugaCore config snapshot (read-only)`,
    `# router-id: ${snapshot.routerId}`,
    `# name: ${snapshot.name}`,
    `# source: ${snapshot.source}`,
    '',
    '/system identity',
    `set name="${snapshot.name}"`,
    '',
    '/interface',
  ];

  for (const iface of snapshot.interfaces) {
    lines.push(`# interface ${iface}`);
  }

  lines.push('', '/ip route');
  for (const route of snapshot.routes) {
    lines.push(`add dst-address=${route.dstAddress} gateway=${route.gateway}`);
  }

  lines.push('', '/interface wireguard peers');
  for (const peer of snapshot.wireguardPeers) {
    lines.push(`# allowed-address=${peer}`);
  }

  return lines.join('\n');
};

export const hashExportText = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');
