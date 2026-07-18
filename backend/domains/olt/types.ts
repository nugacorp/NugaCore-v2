// ====================================================================
// Tipos del dominio OLT (alta + configuración inicial recomendada).
// ====================================================================

export type PonType = 'gpon' | 'epon' | 'xgs-pon' | 'xg-pon';

export type OltProvisioningStatus =
  | 'planned'
  | 'provisioning'
  | 'online'
  | 'offline'
  | 'error';

/** Familia de CLI: agrupa modelos que comparten sintaxis de configuración. */
export type OltCliFlavor =
  | 'huawei'
  | 'zte'
  | 'vsol-bdcom'
  | 'cdata'
  | 'fiberhome'
  | 'generic';

/** Dispositivo OLT gestionado (persistido en public.olts). */
export interface OltDevice {
  id: string;
  tenantId: string;
  name: string;
  brand: string;
  model: string;
  ponType: PonType;
  /** IP de gestión en la LAN de la torre (columna olts.ip). */
  managementIp: string;
  managementVlan?: number;
  sshPort: number;
  sshUsername?: string;
  towerId?: string;
  /** MikroTik (peer WireGuard) por el que la OLT es alcanzable. */
  mikrotikRouterId?: string;
  uplinkPort?: string;
  provisioningStatus: OltProvisioningStatus;
  /** Snapshot del perfil recomendado aplicado (sin secretos). */
  configProfile: Record<string, unknown>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OltConfigSetting {
  key: string;
  value: string;
  /** Por qué se recomienda (rendimiento / estabilidad). */
  reason: string;
}

/** Recomendación de configuración inicial para una marca/modelo. */
export interface OltConfigRecommendation {
  brand: string;
  model: string;
  ponType: PonType;
  cliFlavor: OltCliFlavor;
  summary: string;
  /** Justificación priorizando rendimiento y estabilidad. */
  rationale: string[];
  settings: OltConfigSetting[];
  capacity: {
    ponPorts: number;
    onusPerPonRecommended: number;
    recommendedSplit: string;
  };
}

/** Entrada del catálogo (marca → modelos soportados por el advisor). */
export interface OltCatalogEntry {
  brand: string;
  models: string[];
  cliFlavor: OltCliFlavor;
  defaultPonType: PonType;
}

/** Parámetros de alcanzabilidad para el snippet MikroTik del script. */
export interface OltReachability {
  /** Subred WireGuard del server de la app (p. ej. 10.70.0.0/16). */
  wgSubnet?: string;
  /** IP LAN del MikroTik (gateway de la OLT). */
  mikrotikLanIp?: string;
  /** Interfaz LAN del MikroTik hacia la OLT (p. ej. bridge/ether2). */
  mikrotikLanInterface?: string;
  /** Interfaz WireGuard en el MikroTik (p. ej. wg-nuga). */
  mikrotikWgInterface?: string;
}

export interface OltScriptResult {
  /** Script CLI de arranque de la OLT (revisar antes de aplicar). */
  oltScript: string;
  /** Snippet .rsc para el MikroTik: hace la OLT alcanzable por WireGuard. */
  mikrotikSnippet: string;
  /** Usuario SSH creado por el script. */
  sshUsername: string;
  /**
   * Password generado para el usuario SSH. Se muestra UNA vez y NO se persiste
   * (no va en config_profile ni en la DB). El operador debe guardarlo.
   */
  sshPasswordOnce: string;
  warnings: string[];
}
