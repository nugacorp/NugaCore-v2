// ====================================================================
// Tipos del submódulo de provisioning de MikroTik (Fase 4.4).
// ====================================================================

export type ConnectionType = 'wireguard' | 'sstp' | 'direct' | 'zerotier' | 'tailscale';

// Modos de provisioning NugaCore (Fase 4.6.0).
//   wireguard_managed = PRINCIPAL (recomendado)
//   sstp_managed      = FALLBACK
//   tailscale_lab / direct_lab = laboratorio/soporte
export type ProvisioningMode = 'wireguard_managed' | 'sstp_managed' | 'tailscale_lab' | 'direct_lab';

/** Permisos del usuario API generado: solo lectura u operador (read+write). */
export type ApiMode = 'read_only' | 'operator';

export const PROVISIONING_MODES: ProvisioningMode[] = ['wireguard_managed', 'sstp_managed', 'tailscale_lab', 'direct_lab'];

/** Modo → connectionType base del registro (compatibilidad con el esquema). */
export const modeToConnectionType = (mode: ProvisioningMode): ConnectionType => {
  switch (mode) {
    case 'wireguard_managed': return 'wireguard';
    case 'sstp_managed': return 'sstp';
    case 'tailscale_lab': return 'tailscale';
    case 'direct_lab': return 'direct';
  }
};

/** Normaliza alias legacy ('wireguard'|'sstp') al modo administrado. */
export const normalizeProvisioningMode = (value: string): ProvisioningMode => {
  if (value === 'wireguard') return 'wireguard_managed';
  if (value === 'sstp') return 'sstp_managed';
  if ((PROVISIONING_MODES as string[]).includes(value)) return value as ProvisioningMode;
  return 'wireguard_managed';
};

export const isLabMode = (mode: ProvisioningMode): boolean =>
  mode === 'tailscale_lab' || mode === 'direct_lab';

export type RouterProvisioningStatus = 'pending' | 'provisioned' | 'connected' | 'error';

export const SCRIPT_VERSION = 'nugacore-1.0';
export const ENCRYPTION_VERSION = 'v1-aes-256-gcm';

/** Credencial API generada para un router (el password va cifrado). */
export interface GeneratedCredential {
  username: string;
  encryptedPassword: string;
  encryptionVersion: string;
  /** Password en claro — SOLO para incrustarlo en el script una vez; nunca se persiste ni se loguea. */
  plainPassword: string;
}

/** Token de provisioning de un solo uso (se guarda solo el hash). */
export interface GeneratedToken {
  /** Token en claro — se entrega una sola vez; nunca se persiste. */
  token: string;
  tokenHash: string;
  expiresAt: string;
}

/** Parámetros de servidor/VPN para construir el script. */
export interface ScriptServerConfig {
  vpnHost: string;            // FQDN/IP del concentrador VPN de NugaCore
  vpnCidr: string;            // red VPN autorizada para la API (p.ej. 10.10.0.0/24)
  serverManagementCidr: string; // red de administración de NugaCore (rutas)
  // WireGuard
  wgServerPublicKey?: string; // clave pública del servidor WireGuard
  wgEndpoint?: string;        // host:port del peer servidor
  wgAllowedAddress?: string;  // allowed-address del peer servidor
  wgInterfaceAddress?: string;// dirección IP del router sobre la interfaz WG
  wgKeepalive?: number;       // persistent-keepalive (segundos)

  // ── Modelo de túnel administrado (Fase 4.6.0) — preferidos sobre los anteriores ──
  vpnServerHost?: string;     // host del servidor VPN NugaCore
  vpnServerPort?: number;     // puerto del servidor VPN (WG udp / SSTP 443)
  vpnNetworkCidr?: string;    // red VPN (alias de vpnCidr)
  routerVpnIp?: string;       // IP del router dentro del túnel (con /32)
  serverVpnIp?: string;       // IP del servidor dentro del túnel
  allowedApiCidr?: string;    // CIDR autorizado para la API (default = red VPN)
  routerOsVersionHint?: string;

  // ── Peer administrado por el WireGuard Manager (Fase 4.6.1) ──────────
  // Si se proveen, el script fija la private-key del router y la preshared-key
  // (elimina el intercambio manual de claves).
  wgRouterPrivateKey?: string; // SECRETO (se incrusta una sola vez)
  wgPresharedKey?: string;     // SECRETO
}

/** Entrada completa para el generador de script. */
export interface ScriptGenerationInput {
  // Acepta los 4 modos administrados + alias legacy ('wireguard'|'sstp').
  connectionType: ProvisioningMode | 'wireguard' | 'sstp';
  routerName: string;
  apiUser: string;
  apiPassword: string;
  apiPort: number;
  vpnUser: string;
  vpnPassword: string;
  apiMode?: ApiMode;        // default: operator (managed) / read_only (lab)
  server: ScriptServerConfig;
}

/** Resultado del generador: el script (con secretos) + metadata sin secretos. */
export interface ScriptGenerationResult {
  script: string;
  scriptHash: string;     // sha256(script) hex — seguro de persistir
  scriptVersion: string;
  connectionType: string; // el modo solicitado (echo)
  mode: ProvisioningMode;  // modo normalizado
  apiMode: ApiMode;
  routerVpnIp?: string;
  warnings: string[];
}

/**
 * Router en el registro de provisioning (forma saneada para la API/UI).
 *
 * `status` se deriva de la columna canónica `provisioning_status`
 * (ver DB-1, `CANONICAL_MIKROTIK_ROUTER_COLUMNS`). `managementIp` se prefiere
 * sobre el espejo legacy `ip_address`.
 */
export interface ProvisionedRouterView {
  id: string;
  name: string;
  towerId?: string;
  routerOsVersion: string;
  connectionType: ConnectionType;
  managementIp?: string;
  vpnIp?: string;
  apiPort: number;
  apiSslPort: number;
  status: RouterProvisioningStatus;
  hasCredentials: boolean;
  username: string;
  lastSeenAt?: string;
  notes?: string;
  lastHealthCheckAt: string;
}

// ====================================================================
// DB-1 · Modelo canónico de `public.mikrotik_routers`
//
// Fuente de verdad COMPARTIDA (tests/validadores) del esquema reconciliado.
// Refleja exactamente la unión monitoreo + provisioning descrita en
// docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md. NO activa USE_DB_MIKROTIK.
// ====================================================================

/** Todas las columnas del modelo canónico (snake_case, como en la DB). */
export const CANONICAL_MIKROTIK_ROUTER_COLUMNS = [
  // Identidad y ciclo de vida
  'id', 'name', 'created_at', 'updated_at',
  // Conectividad y acceso API
  'connection_type', 'management_ip', 'ip_address', 'vpn_ip',
  'api_port', 'api_ssl_port', 'username', 'encrypted_password', 'has_credentials',
  // Estado
  'provisioning_status', 'status', 'is_online',
  // Monitoreo / health
  'cpu_usage_pct', 'memory_usage_pct', 'routeros_version',
  'last_health_check_at', 'last_seen_at',
  // Relaciones y metadatos
  'linked_tower_id', 'notes',
] as const;

export type CanonicalMikrotikRouterColumn = (typeof CANONICAL_MIKROTIK_ROUTER_COLUMNS)[number];

/**
 * Columnas que la migración de reconciliación (20260618000000) garantiza con
 * `ADD COLUMN IF NOT EXISTS` (las de provisioning). Idempotente con 20260605000000.
 */
export const RECONCILIATION_PROVISIONING_COLUMNS = [
  'connection_type', 'management_ip', 'vpn_ip', 'api_ssl_port',
  'status', 'provisioning_status', 'has_credentials', 'last_seen_at', 'notes', 'updated_at',
] as const;

/**
 * Columnas DEPRECATED (espejo): se conservan y nunca se eliminan.
 * `status` → usar `provisioning_status`; `ip_address` → preferir `management_ip`.
 */
export const DEPRECATED_MIKROTIK_ROUTER_COLUMNS = ['status', 'ip_address'] as const;
