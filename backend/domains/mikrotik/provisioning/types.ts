// ====================================================================
// Tipos del submódulo de provisioning de MikroTik (Fase 4.4).
// ====================================================================

export type ConnectionType = 'wireguard' | 'sstp' | 'direct' | 'zerotier' | 'tailscale';

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
}

/** Entrada completa para el generador de script. */
export interface ScriptGenerationInput {
  connectionType: 'wireguard' | 'sstp';
  routerName: string;
  apiUser: string;
  apiPassword: string;
  apiPort: number;
  vpnUser: string;
  vpnPassword: string;
  server: ScriptServerConfig;
}

/** Resultado del generador: el script (con secretos) + metadata sin secretos. */
export interface ScriptGenerationResult {
  script: string;
  scriptHash: string;     // sha256(script) hex — seguro de persistir
  scriptVersion: string;
  connectionType: 'wireguard' | 'sstp';
  warnings: string[];
}

/** Router en el registro de provisioning (forma saneada para la API/UI). */
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
