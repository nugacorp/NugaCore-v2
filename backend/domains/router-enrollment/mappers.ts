// ====================================================================
// Mappers Router Enrollment — fila Postgres ↔ RouterEnrollmentRecord
// (Fase 4.9.2.1).
//
// Mapea contra el esquema CANÓNICO de la tabla `router_enrollment`
// (migraciones 20260612 / 20260613000000 / 20260613120000). Los nombres
// de columna son la fuente de verdad: wg_server_id, wg_peer_id, status,
// routeros_version, template_id, template_parameters (JSONB), etc.
//
// template_parameters viaja como JSONB (objeto), no como string.
// ====================================================================

import type {
  RouterEnrollmentRecord,
  EnrollmentStatus,
  RouterEnrollmentRouterSnapshot,
  RouterEnrollmentWireGuardSnapshot,
  RouterEnrollmentSnmpSnapshot,
} from './types';
import type { TemplateParameterValues } from '../router-template-parameters/types';

export interface RouterEnrollmentRow {
  id: string;
  tenant_id?: string | null;
  router_id: string;
  wg_server_id: string;
  wg_peer_id: string;
  enrolled_by: string;
  status: EnrollmentStatus;
  routeros_version: '6' | '7';
  template_id: string;
  template_parameters: TemplateParameterValues | null;
  router_snapshot: RouterEnrollmentRouterSnapshot | null;
  wireguard_snapshot: RouterEnrollmentWireGuardSnapshot | null;
  snmp_snapshot: RouterEnrollmentSnmpSnapshot | null;
  script_hash: string | null;
  script_downloaded_at: string | null;
  check_online_attempts: number;
  last_check_at: string | null;
  online_confirmed_at: string | null;
  failure_reason: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Fila DB → record del dominio. */
export const rowToEnrollment = (r: RouterEnrollmentRow): RouterEnrollmentRecord => ({
  id: r.id,
  tenantId: r.tenant_id || 'tenant-default',
  routerId: r.router_id,
  wgServerId: r.wg_server_id,
  wgPeerId: r.wg_peer_id,
  enrolledBy: r.enrolled_by,
  status: r.status,
  routerosVersion: r.routeros_version,
  templateId: r.template_id,
  templateParameters: r.template_parameters ?? undefined,
  routerSnapshot: r.router_snapshot ?? undefined,
  wireguardSnapshot: r.wireguard_snapshot ?? undefined,
  snmpSnapshot: r.snmp_snapshot ?? undefined,
  scriptHash: r.script_hash ?? undefined,
  scriptDownloadedAt: r.script_downloaded_at ?? undefined,
  checkOnlineAttempts: r.check_online_attempts ?? 0,
  lastCheckAt: r.last_check_at ?? undefined,
  onlineConfirmedAt: r.online_confirmed_at ?? undefined,
  failureReason: r.failure_reason ?? undefined,
  revokedAt: r.revoked_at ?? undefined,
  revokedBy: r.revoked_by ?? undefined,
  createdAt: r.created_at || new Date().toISOString(),
  updatedAt: r.updated_at || new Date().toISOString(),
});

/** Record del dominio → fila DB para INSERT (set completo). */
export const enrollmentToRow = (rec: RouterEnrollmentRecord): Record<string, unknown> => ({
  id: rec.id,
  tenant_id: rec.tenantId || 'tenant-default',
  router_id: rec.routerId,
  wg_server_id: rec.wgServerId,
  wg_peer_id: rec.wgPeerId,
  enrolled_by: rec.enrolledBy,
  status: rec.status,
  routeros_version: rec.routerosVersion,
  template_id: rec.templateId,
  template_parameters: rec.templateParameters ?? null,
  router_snapshot: rec.routerSnapshot ?? {},
  wireguard_snapshot: rec.wireguardSnapshot ?? {},
  snmp_snapshot: rec.snmpSnapshot ?? {},
  script_hash: rec.scriptHash ?? null,
  script_downloaded_at: rec.scriptDownloadedAt ?? null,
  check_online_attempts: rec.checkOnlineAttempts ?? 0,
  last_check_at: rec.lastCheckAt ?? null,
  online_confirmed_at: rec.onlineConfirmedAt ?? null,
  failure_reason: rec.failureReason ?? null,
  revoked_at: rec.revokedAt ?? null,
  revoked_by: rec.revokedBy ?? null,
});

/** Patch parcial del dominio → fila DB para UPDATE (solo claves presentes). */
export const enrollmentPatchToRow = (patch: Partial<RouterEnrollmentRecord>): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.templateId !== undefined) row.template_id = patch.templateId;
  if (patch.templateParameters !== undefined) row.template_parameters = patch.templateParameters ?? null;
  if (patch.routerSnapshot !== undefined) row.router_snapshot = patch.routerSnapshot ?? {};
  if (patch.wireguardSnapshot !== undefined) row.wireguard_snapshot = patch.wireguardSnapshot ?? {};
  if (patch.snmpSnapshot !== undefined) row.snmp_snapshot = patch.snmpSnapshot ?? {};
  if (patch.scriptHash !== undefined) row.script_hash = patch.scriptHash ?? null;
  if (patch.scriptDownloadedAt !== undefined) row.script_downloaded_at = patch.scriptDownloadedAt ?? null;
  if (patch.checkOnlineAttempts !== undefined) row.check_online_attempts = patch.checkOnlineAttempts;
  if (patch.lastCheckAt !== undefined) row.last_check_at = patch.lastCheckAt ?? null;
  if (patch.onlineConfirmedAt !== undefined) row.online_confirmed_at = patch.onlineConfirmedAt ?? null;
  if (patch.failureReason !== undefined) row.failure_reason = patch.failureReason ?? null;
  if (patch.revokedAt !== undefined) row.revoked_at = patch.revokedAt ?? null;
  if (patch.revokedBy !== undefined) row.revoked_by = patch.revokedBy ?? null;
  return row;
};
