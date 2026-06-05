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
  status: PeerStatus;
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
  status: AllocationStatus;
  allocatedAt: string;
  releasedAt?: string;
}

export interface WireguardKeyRotation {
  id: string;
  peerId: string;
  oldPublicKey?: string;
  newPublicKey: string;
  reason?: string;
  actorId?: string;
  createdAt: string;
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
