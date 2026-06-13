// ====================================================================
// Tipos del dominio Router Enrollment (Fase 4.7).
//
// Flujo: crear router → asignar peer WG → generar script → descargar →
// importar en MikroTik → confirmar online via Worker read-only.
// ====================================================================

import type { TemplateParameterValues } from '../router-template-parameters/types';

export type EnrollmentStatus =
  | 'draft'
  | 'script_generated'
  | 'script_downloaded'
  | 'waiting_for_router'
  | 'online'
  | 'failed'
  | 'revoked';

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  draft: 'Borrador',
  script_generated: 'Script generado',
  script_downloaded: 'Script descargado',
  waiting_for_router: 'Esperando router',
  online: 'Online',
  failed: 'Fallido',
  revoked: 'Revocado',
};

/** Forma interna persistida en el repositorio. */
export interface RouterEnrollmentRecord {
  id: string;
  routerId: string;
  wgServerId: string;
  wgPeerId: string;
  enrolledBy: string;
  status: EnrollmentStatus;
  routerosVersion: '6' | '7';
  /** Plantilla real usada para generar el script. Persiste para re-descarga. */
  templateId: string;
  /**
   * Parámetros dinámicos de la plantilla (Fase 4.9.2). Persisten para
   * regenerar el .rsc en /download sin defaults. Las claves secret
   * (passwords PPPoE) se guardan aquí para regeneración pero NUNCA se
   * exponen en vista/logs/preview.
   */
  templateParameters?: TemplateParameterValues;
  scriptHash?: string;
  scriptDownloadedAt?: string;
  checkOnlineAttempts: number;
  lastCheckAt?: string;
  onlineConfirmedAt?: string;
  failureReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Vista saneada para la API / UI (sin secretos). */
export interface RouterEnrollmentView {
  id: string;
  routerId: string;
  routerName?: string;
  wgServerId: string;
  wgPeerId: string;
  enrolledBy: string;
  status: EnrollmentStatus;
  statusLabel: string;
  routerosVersion: '6' | '7';
  /** Plantilla real usada en la generación. */
  templateId: string;
  /** Nombre legible de la plantilla (derivado de templateId, no persistido). */
  templateName: string;
  /** Versión del generador (derivada de templateId, no persistida). */
  generatorVersion: string;
  /** Parámetros dinámicos usados (Fase 4.9.2), con secretos redactados. */
  templateParameters?: TemplateParameterValues;
  scriptHash?: string;
  scriptDownloadedAt?: string;
  checkOnlineAttempts: number;
  lastCheckAt?: string;
  onlineConfirmedAt?: string;
  failureReason?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Input para iniciar el enrollment (wizard paso 1-3). */
export interface StartEnrollmentInput {
  routerName: string;
  ipAddress?: string;
  apiPort?: number;
  linkedTowerId?: string;
  /** Opcional: si se omite, se usa el servidor WireGuard default del VPS. */
  wgServerId?: string;
  routerosVersion: '6' | '7';
  /**
   * Plantilla a usar. Si se omite, usa 'router_base_wireguard' (comportamiento
   * anterior). Valores válidos: ver ENROLLMENT_SUPPORTED_TEMPLATES.
   */
  templateId?: string;
  /**
   * Parámetros dinámicos de la plantilla (Fase 4.9.2). Se validan contra el
   * esquema del registry y se mapean a TemplateLibraryParams para el generador.
   */
  templateParameters?: TemplateParameterValues;
  lanBridgeName?: string;
  lanCidr?: string;
  lanGateway?: string;
  wanInterface?: string;
  notes?: string;
}

/** Respuesta de POST /start. El script se devuelve UNA sola vez, nunca se persiste. */
export interface StartEnrollmentResult {
  // ── Aliases top-level (contrato Hermes) ──────────────────────────────
  enrollmentId: string;
  peerId: string;
  assignedIp: string;
  filename: string;
  /** Vista saneada del script: sin privateKey, presharedKey, passwords. */
  scriptPreview: string;
  securityNotice: string;
  // ── Metadata de template (Fase 4.9.1) ───────────────────────────────
  templateId: string;
  templateName: string;
  generatorVersion: string;
  // ── Campos originales (backward compat) ─────────────────────────────
  enrollment: RouterEnrollmentView;
  routerId: string;
  wgPeerId: string;
  wgAssignedIp: string;
  wgServerPublicKey: string;
  /** Script completo con secretos incrustados. SOLO SE ENTREGA AQUÍ. */
  script: string;
  scriptFilename: string;
  scriptHash: string;
  securityWarning: string;
}

/** Respuesta de POST /:id/check-online. */
export interface CheckOnlineResult {
  enrollment: RouterEnrollmentView;
  isOnline: boolean;
  snapshotSource: 'live' | 'simulated' | null;
  message: string;
}
