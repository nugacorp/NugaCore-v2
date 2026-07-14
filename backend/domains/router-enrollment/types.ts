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

/**
 * Snapshot NO sensible del router usado en la generación del script. Persiste
 * dentro del enrollment para que download() pueda regenerar el .rsc tras un
 * restart del contenedor sin depender de store.MIKROTIK_ROUTERS (volátil) ni
 * activar USE_DB_MIKROTIK. NUNCA contiene secretos (passwords, claves, tokens).
 */
export interface RouterEnrollmentRouterSnapshot {
  routerName?: string;
  routerType?: string;
  model?: string;
  siteName?: string;
  managementIp?: string;
  vpnIp?: string;
  apiPort?: number;
  apiSslPort?: number;
  linkedTowerId?: string;
  notes?: string;
}

/**
 * Snapshot de WireGuard persistido en el enrollment (Fase 4.9.2 hotfix).
 * Permite que download() regenere el .rsc de plantillas que incrustan WireGuard
 * tras un restart, sin depender de WireGuard Manager en memoria.
 *
 * Los datos públicos van en claro. Los secretos (peer private key, preshared
 * key) se guardan CIFRADOS con el mecanismo existente (encryptSecret) y NUNCA
 * se exponen por API/View/logs ni se guardan en claro.
 */
export interface RouterEnrollmentWireGuardSnapshot {
  wgServerId?: string;
  wgPeerId?: string;
  serverPublicKey?: string;
  endpointHost?: string;
  endpointPort?: number;
  assignedIp?: string;
  allowedCidr?: string;
  allowedIps?: string[];
  dnsServers?: string[];
  persistentKeepalive?: number;
  hasEncryptedSecrets?: boolean;
  /** CIFRADO (encryptSecret). NUNCA exponer en View/API/logs. */
  encryptedPeerPrivateKey?: string;
  /** CIFRADO (encryptSecret). NUNCA exponer en View/API/logs. */
  encryptedPresharedKey?: string;
}

/** Vista saneada del snapshot WG: sin los campos cifrados (garantía de tipo). */
export type RouterEnrollmentWireGuardSnapshotView = Omit<
  RouterEnrollmentWireGuardSnapshot,
  'encryptedPeerPrivateKey' | 'encryptedPresharedKey'
>;

/** Snapshot SNMP persistido (comunidad cifrada para re-download). */
export interface RouterEnrollmentSnmpSnapshot {
  version?: '2c';
  /** CIFRADO (encryptSecret). NUNCA exponer en View/API/logs. */
  encryptedCommunity?: string;
  mgmtCidr?: string;
  hasEncryptedSecrets?: boolean;
}

export type RouterEnrollmentSnmpSnapshotView = Omit<
  RouterEnrollmentSnmpSnapshot,
  'encryptedCommunity'
>;

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
  /**
   * Snapshot NO sensible del router (Fase 4.9.2 hotfix). Permite regenerar el
   * .rsc en /download tras un restart sin depender del store en memoria.
   */
  routerSnapshot?: RouterEnrollmentRouterSnapshot;
  /**
   * Snapshot de WireGuard (Fase 4.9.2 hotfix). Permite regenerar el .rsc de
   * plantillas WireGuard tras un restart sin depender del WG store. Los
   * secretos viajan CIFRADOS; nunca se exponen por API.
   */
  wireguardSnapshot?: RouterEnrollmentWireGuardSnapshot;
  snmpSnapshot?: RouterEnrollmentSnmpSnapshot;
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
  /** Snapshot NO sensible del router (Fase 4.9.2 hotfix). No contiene secretos. */
  routerSnapshot?: RouterEnrollmentRouterSnapshot;
  /** Snapshot WireGuard saneado (sin campos cifrados). Solo metadata pública. */
  wireguardSnapshot?: RouterEnrollmentWireGuardSnapshotView;
  snmpSnapshot?: RouterEnrollmentSnmpSnapshotView;
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
  /** Puertos LAN (CSV o lista). El generador omite interfaces inexistentes. */
  lanInterfaces?: string | string[];
  dhcpPoolStart?: string;
  dhcpPoolEnd?: string;
  enableDhcp?: boolean;
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
  /** Comunidad SNMPv2c. SOLO SE ENTREGA en POST /start (una vez). */
  snmpCommunity?: string;
}

/** Respuesta de POST /:id/check-online. */
export interface CheckOnlineResult {
  enrollment: RouterEnrollmentView;
  isOnline: boolean;
  snapshotSource: 'live' | 'simulated' | null;
  message: string;
}
