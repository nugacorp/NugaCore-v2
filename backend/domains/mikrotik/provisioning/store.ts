// ====================================================================
// Store en memoria del provisioning MikroTik (Fase 4.4).
//
// Guarda SOLO metadata segura: hashes de tokens, hashes/metadata de scripts
// y auditoría de acciones. Nunca el script completo, ni passwords, ni tokens
// en claro. (Cuando USE_DB_MIKROTIK=true, esto se reemplaza por un repository
// Supabase con el esquema de 20260605000000_mikrotik_provisioning_schema.sql.)
// ====================================================================

import { MikrotikRouterRegistryItem } from '../../../state/store';
import { redactObject, redactString } from '../../../common/secret-redaction';
import { ConnectionType, ProvisionedRouterView } from './types';

export interface ProvisioningTokenRecord {
  id: string;
  routerId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
  createdBy?: string;
  createdAt: string;
}

export interface ProvisioningScriptRecord {
  id: string;
  routerId: string;
  scriptVersion: string;
  connectionType: ConnectionType;
  scriptHash: string;
  generatedBy?: string;
  generatedAt: string;
}

export interface ProvisioningAuditRecord {
  id: string;
  routerId?: string;
  action: string;
  dryRun: boolean;
  status: 'allowed' | 'blocked' | 'executed' | 'error';
  actorId?: string;
  requestPayload?: Record<string, unknown>; // SIN secretos
  resultSummary?: string;
  errorMessage?: string;
  createdAt: string;
}

import { nowIso } from '../../../common/time';
let tokenSeq = 1;
let scriptSeq = 1;
let auditSeq = 1;

export const provisioningStore = {
  TOKENS: [] as ProvisioningTokenRecord[],
  SCRIPTS: [] as ProvisioningScriptRecord[],
  AUDIT: [] as ProvisioningAuditRecord[],

  recordToken(input: { routerId: string; tokenHash: string; expiresAt: string; createdBy?: string }): ProvisioningTokenRecord {
    // Revoca tokens previos del mismo router (un token activo a la vez).
    this.TOKENS.forEach((t) => {
      if (t.routerId === input.routerId && !t.usedAt && !t.revokedAt) t.revokedAt = nowIso();
    });
    const rec: ProvisioningTokenRecord = {
      id: `mkt-tok-${tokenSeq++}`,
      routerId: input.routerId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
      createdAt: nowIso(),
    };
    this.TOKENS.unshift(rec);
    return rec;
  },

  recordScript(input: {
    routerId: string;
    scriptVersion: string;
    connectionType: ConnectionType;
    scriptHash: string;
    generatedBy?: string;
  }): ProvisioningScriptRecord {
    const rec: ProvisioningScriptRecord = {
      id: `mkt-scr-${scriptSeq++}`,
      routerId: input.routerId,
      scriptVersion: input.scriptVersion,
      connectionType: input.connectionType,
      scriptHash: input.scriptHash,
      generatedBy: input.generatedBy,
      generatedAt: nowIso(),
    };
    this.SCRIPTS.unshift(rec);
    return rec;
  },

  recordAudit(input: Omit<ProvisioningAuditRecord, 'id' | 'createdAt'>): ProvisioningAuditRecord {
    // Red de seguridad: redacta cualquier secreto que se haya colado en el
    // payload/summary/error antes de persistir la auditoría.
    const rec: ProvisioningAuditRecord = {
      id: `mkta-prov-${auditSeq++}`,
      createdAt: nowIso(),
      ...input,
      requestPayload: input.requestPayload ? redactObject(input.requestPayload) : input.requestPayload,
      resultSummary: input.resultSummary ? redactString(input.resultSummary) : input.resultSummary,
      errorMessage: input.errorMessage ? redactString(input.errorMessage) : input.errorMessage,
    };
    this.AUDIT.unshift(rec);
    return rec;
  },
};

/** Mapea un item del registro a la vista saneada (sin secretos) para API/UI. */
export const toProvisionedView = (item: MikrotikRouterRegistryItem): ProvisionedRouterView => ({
  id: item.id,
  name: item.name,
  towerId: item.linkedTowerId,
  routerOsVersion: item.routerOsVersion,
  connectionType: item.connectionType ?? 'sstp',
  managementIp: item.managementIp ?? item.ipAddress,
  vpnIp: item.vpnIp,
  apiPort: item.apiPort,
  apiSslPort: item.apiSslPort ?? 8729,
  status: item.provisioningStatus ?? 'pending',
  hasCredentials: !!item.encryptedPassword,
  username: item.username,
  lastSeenAt: item.lastSeenAt,
  notes: item.notes,
  lastHealthCheckAt: item.lastHealthCheckAt,
});
