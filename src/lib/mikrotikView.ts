// ====================================================================
// Helpers PUROS de presentación del provisioning MikroTik (Fase 4.4).
// Sin React/DOM → testeables en el entorno node.
// ====================================================================

import type {
  MikrotikConnectionType,
  MikrotikProvisioningStatus,
  ProvisioningScriptResponse,
} from '../types';

export const connectionTypeLabel = (t: MikrotikConnectionType): string => {
  switch (t) {
    case 'wireguard': return 'WireGuard (v7)';
    case 'sstp': return 'SSTP (v6/v7)';
    case 'direct': return 'Directa';
    case 'zerotier': return 'ZeroTier';
    case 'tailscale': return 'Tailscale';
    default: return t;
  }
};

export type StatusTone = 'pending' | 'provisioned' | 'connected' | 'error';

export interface StatusBadge {
  tone: StatusTone;
  label: string;
}

export const statusBadge = (status: MikrotikProvisioningStatus): StatusBadge => {
  switch (status) {
    case 'connected': return { tone: 'connected', label: 'Conectado' };
    case 'provisioned': return { tone: 'provisioned', label: 'Provisionado' };
    case 'error': return { tone: 'error', label: 'Error' };
    case 'pending':
    default: return { tone: 'pending', label: 'Pendiente' };
  }
};

/**
 * Texto exacto que se copia al portapapeles: SOLO el script. El token y los
 * resúmenes se muestran aparte y nunca se mezclan en el script copiado.
 */
export const clipboardScript = (resp: Pick<ProvisioningScriptResponse, 'script'>): string =>
  resp.script;
