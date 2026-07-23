// ====================================================================
// Tipos del dominio WireGuard Manager (Fase 4.6.1).
//
// *Record = forma interna persistida (incluye secretos CIFRADOS).
// *View   = forma saneada para API/UI (sin secretos).
// ====================================================================

export const ENCRYPTION_VERSION = 'v1-aes-256-gcm';

export type ServerStatus = 'active' | 'disabled';
export type PeerStatus = 'active' | 'revoked';
export type AllocationStatus = 'allocated' | 'released';
export type PeerType = 'equipment' | 'person';
/**
 * Ciclo de apply al host wg0 (contrato v2). Independiente de PeerStatus:
 * status='active' + apply_state='pending_apply' = peer vivo aún sin ACK de wg0.
 * 'applied' corresponde al estado "active" del plan (ACK de revisión recibido).
 */
export type ApplyState = 'pending_apply' | 'applied' | 'apply_failed';

// ── Servidor ───────────────────────────────────────────────────────────
export interface WireguardServerRecord {
  id: string;
  name: string;
  endpointHost: string;
  endpointPort: number;
  listenPort: number;
  publicKey: string;            // base64 público
  encryptedPrivateKey: string;  // cifrado
  encryptionVersion: string;
  vpnCidr: string;
  serverVpnIp: string;
  isDefault: boolean;           // servidor principal del tenant (shared wg0 en host)
  tenantId?: string;
  status: ServerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WireguardServerView {
  id: string;
  name: string;
  endpointHost: string;
  endpointPort: number;
  listenPort: number;
  publicKey: string;
  vpnCidr: string;
  serverVpnIp: string;
  isDefault: boolean;
  status: ServerStatus;
  peersCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Peer ────────────────────────────────────────────────────────────────
export interface WireguardPeerRecord {
  id: string;
  serverId: string;
  routerId?: string;
  name: string;
  publicKey: string;
  encryptedPrivateKey?: string;
  encryptedPresharedKey?: string;
  encryptionVersion: string;
  allocatedIp: string;
  allowedCidr?: string;
  tenantId?: string;
  /** equipment consume cuota max_peers; person (staff VPN) no. Default equipment. */
  peerType?: PeerType;
  status: PeerStatus;
  /** Estado del apply al host wg0 (contrato v2). Default 'applied'. */
  applyState?: ApplyState;
  lastRotatedAt?: string;
  revokedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WireguardPeerView {
  id: string;
  serverId: string;
  routerId?: string;
  name: string;
  publicKey: string;
  allocatedIp: string;
  allowedCidr?: string;
  status: PeerStatus;
  /** Sólo se expone con WIREGUARD_MULTITENANT encendido. */
  applyState?: ApplyState;
  hasSecrets: boolean;
  lastRotatedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

// ── IPAM / rotaciones ────────────────────────────────────────────────────
export interface WireguardIpAllocation {
  id: string;
  serverId: string;
  ip: string;
  peerId?: string;
  tenantId?: string;
  status: AllocationStatus;
  allocatedAt: string;
  releasedAt?: string;
}

export interface WireguardKeyRotation {
  id: string;
  peerId: string;
  tenantId?: string;
  oldPublicKey?: string;
  newPublicKey: string;
  reason?: string;
  actorId?: string;
  createdAt: string;
}

// ── Subred /24 por tenant (wg0 compartido) ────────────────────────────────
export interface WireguardTenantSubnet {
  tenantId: string;
  subnetCidr: string;   // p.ej. 10.70.1.0/24
  subnetIndex: number;  // 0..254 (0 = infra)
  maxPeers: number;
  createdAt?: string;
}

// ── IPAM atómico (RPC wg_allocate_peer / réplica en memoria) ───────────────
export interface AllocatePeerInput {
  tenantId: string;
  serverId: string;
  peerId: string;
  allocId: string;
  name: string;
  publicKey: string;
  routerId?: string;
  encryptedPrivateKey?: string;
  encryptedPresharedKey?: string;
  encryptionVersion?: string;
  allowedCidr?: string;
  peerType?: PeerType;
  createdBy?: string;
}

export interface AllocatePeerResult {
  peer: WireguardPeerRecord;
  allocation: WireguardIpAllocation;
  subnet: WireguardTenantSubnet;
}

// ── Secretos mostrados UNA sola vez ──────────────────────────────────────
export interface PeerCreatedOnce {
  peer: WireguardPeerView;
  /** Solo aquí: el llamador los incrusta en el script del router. */
  privateKey: string;
  presharedKey: string;
  serverPublicKey: string;
  serverEndpoint: string;       // host:port
  assignedIp: string;           // con /32
  allowedCidr: string;
}

export interface ServerCreatedOnce {
  server: WireguardServerView;
  /** Private key del servidor: mostrar una sola vez. */
  serverPrivateKey: string;
}
