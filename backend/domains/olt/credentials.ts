// ====================================================================
// Credenciales SSH de OLTs, cifradas en reposo (AES-256-GCM vía crypto.ts).
//
// Hasta ahora el password de la OLT no vivía en ningún lado: script-generator
// lo muestra una vez y no lo persiste. El worker necesita autenticarse, así que
// se guarda cifrado siguiendo el patrón de mikrotik_router_credentials.
//
// REGLA: el password en claro NUNCA sale por la API ni se escribe en logs.
// `getSecret` es de uso interno del futuro worker.
// ====================================================================

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { nowIso } from '../../common/time';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { decryptSecret, encryptSecret } from '../../services/crypto';
import { useDbOlt } from './repository';

const TABLE = 'olt_credentials';
export const ENCRYPTION_VERSION = 'v1-aes-256-gcm';

/** Registro completo — `encryptedPassword` nunca se expone por la API. */
export interface OltCredentialRecord {
  id: string;
  tenantId: string;
  oltId: string;
  username: string;
  encryptedPassword: string;
  encryptionVersion: string;
  isActive: boolean;
  createdAt: string;
  rotatedAt?: string;
}

/** Vista pública: confirma que hay credencial sin revelar el secreto. */
export interface OltCredentialMeta {
  oltId: string;
  username: string;
  encryptionVersion: string;
  hasPassword: boolean;
  isActive: boolean;
  createdAt: string;
  rotatedAt?: string;
}

export const toCredentialMeta = (record: OltCredentialRecord): OltCredentialMeta => ({
  oltId: record.oltId,
  username: record.username,
  encryptionVersion: record.encryptionVersion,
  hasPassword: Boolean(record.encryptedPassword),
  isActive: record.isActive,
  createdAt: record.createdAt,
  rotatedAt: record.rotatedAt,
});

interface OltCredentialsRepository {
  findActive(tenantId: string, oltId: string): Promise<OltCredentialRecord | null>;
  deactivateAll(tenantId: string, oltId: string): Promise<void>;
  insert(record: OltCredentialRecord): Promise<OltCredentialRecord>;
}

// ── Store en memoria ──────────────────────────────────────────────────
let MEM: OltCredentialRecord[] = [];
export const resetOltCredentialsStore = (): void => {
  MEM = [];
};

class StoreOltCredentialsRepository implements OltCredentialsRepository {
  async findActive(tenantId: string, oltId: string): Promise<OltCredentialRecord | null> {
    return MEM.find((c) => c.tenantId === tenantId && c.oltId === oltId && c.isActive) ?? null;
  }

  async deactivateAll(tenantId: string, oltId: string): Promise<void> {
    MEM = MEM.map((c) =>
      c.tenantId === tenantId && c.oltId === oltId
        ? { ...c, isActive: false, rotatedAt: nowIso() }
        : c,
    );
  }

  async insert(record: OltCredentialRecord): Promise<OltCredentialRecord> {
    MEM.unshift(record);
    return record;
  }
}

// ── Supabase ──────────────────────────────────────────────────────────
const rowToRecord = (row: Record<string, unknown>): OltCredentialRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id ?? 'tenant-default'),
  oltId: String(row.olt_id),
  username: String(row.username ?? ''),
  encryptedPassword: String(row.encrypted_password ?? ''),
  encryptionVersion: String(row.encryption_version ?? ENCRYPTION_VERSION),
  isActive: row.is_active !== false,
  createdAt: String(row.created_at ?? nowIso()),
  rotatedAt: row.rotated_at == null ? undefined : String(row.rotated_at),
});

class SupabaseOltCredentialsRepository implements OltCredentialsRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async findActive(tenantId: string, oltId: string): Promise<OltCredentialRecord | null> {
    const { data, error } = await this.admin
      .from(TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('olt_id', oltId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new Error(`findActiveOltCredential: ${error.message}`);
    return data ? rowToRecord(data as Record<string, unknown>) : null;
  }

  async deactivateAll(tenantId: string, oltId: string): Promise<void> {
    const { error } = await this.admin
      .from(TABLE)
      .update({ is_active: false, rotated_at: nowIso() })
      .eq('tenant_id', tenantId)
      .eq('olt_id', oltId)
      .eq('is_active', true);
    if (error) throw new Error(`deactivateOltCredentials: ${error.message}`);
  }

  async insert(record: OltCredentialRecord): Promise<OltCredentialRecord> {
    const { error } = await this.admin.from(TABLE).insert({
      id: record.id,
      tenant_id: record.tenantId,
      olt_id: record.oltId,
      username: record.username,
      encrypted_password: record.encryptedPassword,
      encryption_version: record.encryptionVersion,
      is_active: record.isActive,
      created_at: record.createdAt,
      rotated_at: record.rotatedAt ?? null,
    });
    if (error) throw new Error(`insertOltCredential: ${error.message}`);
    return record;
  }
}

let repoSingleton: OltCredentialsRepository | null = null;

const getRepo = (): OltCredentialsRepository => {
  if (repoSingleton) return repoSingleton;
  repoSingleton = useDbOlt() && isSupabaseAdminConfigured && supabaseAdmin
    ? new SupabaseOltCredentialsRepository(supabaseAdmin)
    : new StoreOltCredentialsRepository();
  return repoSingleton;
};

export class OltCredentialsService {
  /** Metadatos de la credencial activa (sin secreto). */
  async getMeta(tenantId: string, oltId: string): Promise<OltCredentialMeta | null> {
    const record = await getRepo().findActive(tenantId, oltId);
    return record ? toCredentialMeta(record) : null;
  }

  /**
   * Guarda (o rota) la credencial: desactiva la anterior y cifra la nueva.
   * Devuelve solo metadatos — el password nunca vuelve al llamador.
   */
  async set(
    tenantId: string,
    oltId: string,
    username: string,
    plainPassword: string,
  ): Promise<OltCredentialMeta> {
    const repo = getRepo();
    await repo.deactivateAll(tenantId, oltId);
    const record = await repo.insert({
      id: `oc-${randomBytes(6).toString('hex')}`,
      tenantId,
      oltId,
      username,
      encryptedPassword: encryptSecret(plainPassword),
      encryptionVersion: ENCRYPTION_VERSION,
      isActive: true,
      createdAt: nowIso(),
    });
    return toCredentialMeta(record);
  }

  /**
   * Descifra la credencial para uso del worker. NO exponer por HTTP.
   * Devuelve null si la OLT no tiene credencial activa.
   */
  async getSecret(
    tenantId: string,
    oltId: string,
  ): Promise<{ username: string; password: string } | null> {
    const record = await getRepo().findActive(tenantId, oltId);
    if (!record) return null;
    return { username: record.username, password: decryptSecret(record.encryptedPassword) };
  }
}

let serviceSingleton: OltCredentialsService | null = null;

export const getOltCredentialsService = (): OltCredentialsService => {
  if (!serviceSingleton) serviceSingleton = new OltCredentialsService();
  return serviceSingleton;
};

export const resetOltCredentialsService = (): void => {
  serviceSingleton = null;
  repoSingleton = null;
};
