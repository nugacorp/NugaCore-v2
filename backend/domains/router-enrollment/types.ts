// ====================================================================
// Tipos del dominio Router Enrollment (Fase 4.7).
//
// Flujo: crear router → asignar peer WG → generar script → descargar →
// importar en MikroTik → confirmar online via Worker read-only.
// ====================================================================

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
  wgServerId: string;
  routerosVersion: '6' | '7';
  lanBridgeName?: string;
  lanCidr?: string;
  lanGateway?: string;
  wanInterface?: string;
  notes?: string;
}

/** Respuesta de POST /start. El script se devuelve UNA sola vez, nunca se persiste. */
export interface StartEnrollmentResult {
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
